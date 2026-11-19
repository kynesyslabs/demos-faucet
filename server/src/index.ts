import { websdk, denomination } from "@kynesyslabs/demosdk";
import dotenv from "dotenv";
import express, { type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import { loadConfig, type FaucetConfig } from "./config";
import { Safeguards, normalizeAddress } from "./safeguards";
import { SerialQueue } from "./transferQueue";
import {
  logger,
  createRateLimit,
  createSlowDown,
  securityHeaders,
  requestLogger,
  DDoSProtection,
  honeypot,
  errorHandler,
  getClientIP,
  clientRateKey,
} from "./security";

dotenv.config();

const config: FaucetConfig = loadConfig();
const app = express();
const ddosProtection = new DDoSProtection();

// Hop count, not `true`: with `true` Express takes the leftmost
// X-Forwarded-For entry, which the client controls. Each trusted hop must be
// a proxy that appends the peer address it saw.
app.set("trust proxy", config.trustProxyHops);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
  }),
);

app.use(securityHeaders);
app.use(requestLogger);
app.use(honeypot);
app.use(ddosProtection.middleware);

setInterval(() => ddosProtection.cleanup(), 5 * 60 * 1000);

const generalRateLimit = createRateLimit(
  15 * 60 * 1000,
  100,
  "Too many requests from this IP",
);

const faucetRateLimit = createRateLimit(60 * 1000, 3, "Too many faucet requests");

const slowDownMiddleware = createSlowDown(15 * 60 * 1000, 5, 1000);

app.use(generalRateLimit);
app.use(slowDownMiddleware);

app.use(
  cors({
    origin: config.corsOrigins,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.use(express.json({ limit: "10kb" }));

interface FaucetState {
  address: string;
  balance: { os: bigint; lastUpdated: number } | null;
}

type TransferOutcome =
  | { kind: "included"; txHash: string; blockNumber?: number }
  | { kind: "failed"; txHash: string; blockNumber?: number }
  | { kind: "pending"; txHash: string; lastSeenState: string }
  | { kind: "not_sent"; error: string };

/**
 * Sends `amountDem` whole DEM and waits for a terminal on-chain state.
 *
 * Only a `BroadcastTimeoutError` can leave a transaction in flight: errors
 * from signing, confirm and a fail-fast broadcast all happen before the node
 * accepted anything, and status polling never throws.
 */
async function sendTransfer(
  demos: websdk.Demos,
  to: string,
  amountDem: number,
): Promise<TransferOutcome> {
  const outcome = await attemptTransfer(demos, to, amountDem);
  // The local nonce counter has run ahead of the chain when the reserved
  // nonce was not used, so the next send must reseed it from the node. After
  // a timeout the tx may still land, and keeping the counter avoids reusing
  // its nonce.
  if (outcome.kind === "not_sent" || outcome.kind === "failed") {
    demos.resetNonce();
  }
  return outcome;
}

async function attemptTransfer(
  demos: websdk.Demos,
  to: string,
  amountDem: number,
): Promise<TransferOutcome> {
  try {
    const result = await demos.transferAndWait(to, denomination.demToOs(amountDem), {
      failFastOnBroadcastError: true,
      timeoutMs: config.transferTimeoutMs,
    });
    const { state, blockNumber } = result.status;
    return state === "included"
      ? { kind: "included", txHash: result.hash, blockNumber }
      : { kind: "failed", txHash: result.hash, blockNumber };
  } catch (error) {
    if (error instanceof websdk.BroadcastTimeoutError) {
      return { kind: "pending", txHash: error.txHash, lastSeenState: error.lastSeenState };
    }
    return { kind: "not_sent", error: error instanceof Error ? error.message : String(error) };
  }
}

async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelay: number = 5000,
  operationName: string = "operation",
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.warn(`${operationName} failed on attempt ${attempt}/${maxAttempts}:`, lastError.message);
      if (attempt < maxAttempts) {
        const delay = baseDelay * Math.pow(1.5, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError!;
}

async function fetchBalanceOs(demos: websdk.Demos, address: string): Promise<bigint | null> {
  const info = await retryWithBackoff(
    () => demos.getAddressInfo(address),
    3,
    5000,
    "getAddressInfo",
  );
  return info ? info.balance : null;
}

async function updateBalanceCache(state: FaucetState, demos: websdk.Demos) {
  try {
    const os = await fetchBalanceOs(demos, state.address);
    if (os === null) {
      logger.warn("Faucet address unknown to the node; balance not updated");
      return;
    }
    state.balance = { os, lastUpdated: Date.now() };
    logger.info("Balance cache updated", { balance: denomination.formatDem(os) });
  } catch (error) {
    logger.error("Error updating balance cache:", error);
  }
}

const BALANCE_CACHE_MS = 30000;

function startBalanceUpdater(state: FaucetState, demos: websdk.Demos) {
  updateBalanceCache(state, demos);
  setInterval(() => updateBalanceCache(state, demos), BALANCE_CACHE_MS);
}

function balanceBody(os: bigint) {
  // DEM as a decimal string formatted from the OS bigint, so the UI never sees
  // a float that lost precision.
  return { balance: denomination.osToDem(os), balanceOs: os.toString(), unit: "DEM" };
}

function setupRoutes(
  state: FaucetState,
  demos: websdk.Demos,
  safeguards: Safeguards,
  transferQueue: SerialQueue,
) {
  app.get("/", (_req: Request, res: Response) => {
    res.json({
      service: "Demos Faucet API",
      version: "1.1.0",
      endpoints: [
        "/api/health",
        "/api/balance",
        "/api/request",
        "/api/stats/address",
        "/api/stats/global",
      ],
    });
  });

  app.get("/api/test", (_req: Request, res: Response) => {
    res.json({ message: "Hello World", timestamp: new Date().toISOString() });
  });

  app.get("/api/balance", async (_req: Request, res: Response) => {
    // Every open page polls this; serving the updater's recent value keeps
    // page views from turning into node RPC load.
    if (state.balance && Date.now() - state.balance.lastUpdated < BALANCE_CACHE_MS) {
      return res.json({
        status: 200,
        body: { ...balanceBody(state.balance.os), publicKey: state.address, cached: true },
      });
    }
    try {
      const os = await fetchBalanceOs(demos, state.address);
      if (os === null) {
        return res.status(500).json({
          status: 500,
          body: { balance: "0.0", message: "Failed to retrieve balance from network", publicKey: state.address },
        });
      }
      state.balance = { os, lastUpdated: Date.now() };
      return res.json({
        status: 200,
        body: { ...balanceBody(os), publicKey: state.address, cached: false },
      });
    } catch (error) {
      logger.error("Network error getting balance:", error);
      return res.status(500).json({
        status: 500,
        body: { balance: "0.0", message: "Network error retrieving balance", publicKey: state.address },
      });
    }
  });

  app.post("/api/request", faucetRateLimit, async (req: Request, res: Response) => {
    try {
      return await handleFaucetRequest(req, res);
    } catch (error) {
      // Express 4 does not catch rejected async handlers; without this a
      // database error would leave the request hanging.
      logger.error("Error processing faucet request:", error);
      if (!res.headersSent) {
        res.status(500).json({ status: 500, body: "Internal server error" });
      }
    }
  });

  async function handleFaucetRequest(req: Request, res: Response) {
    const { address, amount } = req.body ?? {};
    const ip = getClientIP(req);

    // Refusing before reserving keeps a backlog from holding allowances
    // for transfers that would wait minutes in the queue.
    if (transferQueue.pending >= config.maxPendingTransfers) {
      return res.status(503).json({ status: 503, body: "The faucet is busy, please retry in a minute" });
    }

    const reservation = safeguards.reserve(address, amount, clientRateKey(req));
    if (!reservation.allowed) {
      const invalid = reservation.reason === "invalid_address" || reservation.reason === "invalid_amount";
      logger.warn("Faucet request refused", { address, amount, ip, reason: reservation.reason });
      return res.status(invalid ? 400 : 429).json({
        status: invalid ? 400 : 429,
        reason: reservation.reason,
        body: reservation.message,
      });
    }

    let outcome: TransferOutcome;
    try {
      outcome = await transferQueue.run(() =>
        sendTransfer(demos, reservation.address, reservation.amount),
      );
    } catch (error) {
      outcome = { kind: "not_sent", error: error instanceof Error ? error.message : String(error) };
    }

    if (outcome.kind === "not_sent" || outcome.kind === "failed") {
      safeguards.release(reservation.id);
    }
    if (outcome.kind !== "not_sent") {
      void updateBalanceCache(state, demos);
    }

    switch (outcome.kind) {
      case "included":
        logger.info("Faucet transfer included", { to: reservation.address, amount: reservation.amount, ip, txHash: outcome.txHash });
        return res.json({
          status: 200,
          body: {
            txHash: outcome.txHash,
            txStatus: "included",
            blockNumber: outcome.blockNumber ?? null,
            confirmationBlock: outcome.blockNumber ?? -1,
            amount: reservation.amount,
            message: `Sent ${reservation.amount} DEM`,
          },
        });
      case "pending":
        // The transaction may still land, so the allowance stays used.
        logger.warn("Faucet transfer not final before timeout", { to: reservation.address, txHash: outcome.txHash, lastSeenState: outcome.lastSeenState });
        return res.status(202).json({
          status: 202,
          body: {
            txHash: outcome.txHash,
            txStatus: "pending",
            blockNumber: null,
            confirmationBlock: -1,
            amount: reservation.amount,
            message: "Transaction broadcast, not yet confirmed",
          },
        });
      case "failed":
        logger.error("Faucet transfer failed on chain", { to: reservation.address, txHash: outcome.txHash });
        return res.status(502).json({
          status: 502,
          reason: "transfer_failed",
          txHash: outcome.txHash,
          txStatus: "failed",
          body: "The transfer failed on chain, your allowance was not used",
        });
      case "not_sent":
        logger.error("Faucet transfer not sent", { to: reservation.address, error: outcome.error });
        return res.status(502).json({
          status: 502,
          reason: "transfer_not_sent",
          body: "The transfer could not be sent, your allowance was not used; please retry later",
        });
    }
  }

  app.get("/api/stats/address", (req: Request, res: Response) => {
    const address = normalizeAddress(req.query.address);
    if (!address) {
      return res.status(400).json({ status: 400, body: "address must be 0x followed by 64 hex characters" });
    }
    try {
      res.json({ status: 200, body: safeguards.getAddressStats(address) });
    } catch (error) {
      logger.error("Error getting address stats:", error);
      res.status(500).json({ error: "Failed to get address stats" });
    }
  });

  app.get("/api/stats/global", (_req: Request, res: Response) => {
    try {
      res.json({ status: 200, body: safeguards.getGlobalStats() });
    } catch (error) {
      logger.error("Error getting global stats:", error);
      res.status(500).json({ error: "Failed to get global stats" });
    }
  });

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      walletConnected: !!state.address,
      pendingTransfers: transferQueue.pending,
    });
  });

  app.use((req: Request, res: Response) => {
    logger.warn("404 - Route not found", { path: req.path, method: req.method });
    res.status(404).json({ error: "Not Found" });
  });

  app.use(errorHandler);
}

async function main() {
  if (!config.rpcUrl) throw new Error("RPC_URL is required");
  if (!config.mnemonic) throw new Error("MNEMONIC is required");

  const safeguards = new Safeguards(config, config.dbPath);
  const demos = new websdk.Demos();
  await demos.connect(config.rpcUrl);
  const address = await demos.connectWallet(config.mnemonic);
  // getAddressNonce lags inclusion, so re-reading it right after an included
  // transfer can hand the next transfer the same nonce; a local counter
  // sequences consecutive faucet sends instead.
  demos.enableAutoNonce();
  logger.info(`Connected to ${config.rpcUrl} as ${address}`);
  logger.info("Faucet limits", {
    timeInterval: config.timeInterval,
    maxAmount: config.maxAmount,
    numberPerInterval: config.numberPerInterval,
    maxAmountPerIp: config.maxAmountPerIp,
    numberPerIpPerInterval: config.numberPerIpPerInterval,
    globalMaxAmountPerInterval: config.globalMaxAmountPerInterval,
    trustProxyHops: config.trustProxyHops,
  });

  const state: FaucetState = { address, balance: null };
  setupRoutes(state, demos, safeguards, new SerialQueue());
  startBalanceUpdater(state, demos);

  app.listen(config.port, () => {
    logger.info(`Faucet server listening on port ${config.port}`);
  });
}

await main();
