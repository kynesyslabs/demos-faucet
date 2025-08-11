import { websdk } from "@kynesyslabs/demosdk";
import dotenv from "dotenv";
import { Safeguards } from "./safeguards";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import {
  logger,
  createRateLimit,
  createSlowDown,
  validateFaucetRequest,
  securityHeaders,
  requestLogger,
  DDoSProtection,
  honeypot,
  errorHandler,
  getClientIP
} from "./security";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const ddosProtection = new DDoSProtection();

// Trust proxy headers when behind reverse proxy
// Using specific proxy count instead of 'true' to satisfy express-rate-limit security
// Set to 1 if behind single proxy (nginx), 2 if behind double proxy (cloudflare + nginx), etc.
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

app.use(securityHeaders);
app.use(requestLogger);
app.use(honeypot);
app.use(ddosProtection.middleware);

// Clean up DDoS protection data every 5 minutes
setInterval(() => ddosProtection.cleanup(), 5 * 60 * 1000);

// Rate limiting
const generalRateLimit = createRateLimit(
  15 * 60 * 1000, // 15 minutes
  100, // max requests per window
  "Too many requests from this IP"
);

const faucetRateLimit = createRateLimit(
  60 * 1000, // 1 minute
  3, // max 3 requests per minute
  "Too many faucet requests"
);

const slowDownMiddleware = createSlowDown(
  15 * 60 * 1000, // 15 minutes
  5, // delay after 5 requests
  1000 // 1 second delay
);

app.use(generalRateLimit);
app.use(slowDownMiddleware);

// Enable CORS for all routes
app.use(
  cors({
    origin: [
      "https://faucet.demos.sh", 
      "http://localhost:4442", 
      "http://localhost:8080",
      "http://localhost:3000",
      "http://localhost:3010"
    ],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
  })
);

// Parse JSON bodies with size limit
app.use(express.json({ limit: '10mb' }));

export class FaucetServer {
  private mnemonic: string;
  private publicKey: string;
  public rpcUrl: string;
  public timeInterval: number;
  public numberPerInterval: number;
  public maxAmount: number;
  public port: number;
  private safeguards: Safeguards;
  private cachedBalance: {
    balance: string; // Keep as raw balance string
    lastUpdated: number;
    addressInfo?: any;
  } | null = null;

  constructor() {
    this.mnemonic = process.env.MNEMONIC || "";
    this.publicKey = process.env.PUBLIC_KEY || ""; // TODO Derive from mnemonic
    this.rpcUrl = process.env.RPC_URL || "";
    this.timeInterval = parseInt(process.env.TIME_INTERVAL || "86400");
    this.numberPerInterval = parseInt(process.env.NUMBER_PER_INTERVAL || "1");
    this.maxAmount = parseInt(process.env.MAX_AMOUNT || "1000");
    this.port = parseInt(process.env.PORT || "3000");
    this.safeguards = new Safeguards(this);
  }

  public getMnemonic() {
    return this.mnemonic;
  }

  public setPublicKey(publicKey: string) {
    this.publicKey = publicKey;
  }

  public getPublicKey() {
    return this.publicKey;
  }

  public getRpcUrl() {
    return this.rpcUrl;
  }

  public getSafeguards() {
    return this.safeguards;
  }

  public setCachedBalance(rawBalance: string, addressInfo?: any) {
    // Clean addressInfo to remove BigInt values that cause JSON serialization issues
    const cleanAddressInfo = addressInfo ? {
      ...addressInfo,
      balance: addressInfo.balance?.toString(), // Convert BigInt to string
      nonce: addressInfo.nonce?.toString(),
      // Remove any other potential BigInt fields
    } : undefined;

    this.cachedBalance = {
      balance: rawBalance,
      lastUpdated: Date.now(),
      addressInfo: cleanAddressInfo
    };
    
    logger.info("Balance cache updated:", {
      balance: rawBalance,
      timestamp: new Date().toISOString()
    });
  }

  public getCachedBalance() {
    return this.cachedBalance;
  }
}

// SECTION Definitions

/**
 * Transfers tokens from the faucet to the specified address.
 * @param amount - The amount of tokens to transfer.
 * @param to - The address to transfer the tokens to.
 * @returns A promise that resolves to an object containing the success status and a message.
 */
async function transferTokens(
  demos: websdk.Demos,
  faucetServer: FaucetServer,
  amount: number,
  to: string
): Promise<{
  success: boolean;
  message: string;
  txHash: string;
  confirmationBlock: number;
}> {
  try {
    console.log("Transferring tokens to: " + to);
    
    // Create transaction
    const transaction = await demos.transfer(to, amount);
    console.log("Transaction created, confirming...");
    
    // Confirm transaction
    const confirmation = await demos.confirm(transaction);
    console.log("Confirmation: " + JSON.stringify(confirmation, null, 2));
    
    if (!confirmation.response.data.valid) {
      console.log("Transaction failed during confirmation");
      return {
        success: false,
        message: "Transaction failed: " + JSON.stringify(confirmation, null, 2),
        txHash: "",
        confirmationBlock: -1,
      };
    }
    
    const txHash = confirmation.response.data.transaction.hash;
    const confirmationBlock = confirmation.response.data.reference_block;
    
    // Broadcast transaction
    console.log("Broadcasting transaction...");
    const result = await demos.broadcast(confirmation);
    console.log("Broadcast result: " + JSON.stringify(result, null, 2));
    
    return {
      success: true,
      message: `Transaction successful: ${txHash}`,
      txHash: txHash,
      confirmationBlock: confirmationBlock,
    };
  } catch (error) {
    console.error("Transaction failed:", error);
    return {
      success: false,
      message: `Transaction failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      txHash: "",
      confirmationBlock: -1,
    };
  }
}

/**
 * Updates the balance cache by fetching from the network
 */
async function updateBalanceCache(faucetServer: FaucetServer, demos: websdk.Demos) {
  try {
    const publicKey = faucetServer.getPublicKey();
    if (!publicKey) {
      logger.warn("No public key available for balance update");
      return;
    }
    
    const addrInfo = await demos.getAddressInfo(publicKey);
    const rawBalance = addrInfo?.balance;
    
    if (rawBalance !== undefined) {
      faucetServer.setCachedBalance(rawBalance.toString(), addrInfo);
      logger.info("Balance cache updated successfully", { balance: rawBalance });
    } else {
      logger.warn("Failed to get balance from network");
    }
  } catch (error) {
    logger.error("Error updating balance cache:", error);
  }
}

// SECTION Server logic
/**
 * Starts the periodic balance updater
 */
function startBalanceUpdater(faucetServer: FaucetServer, demos: websdk.Demos) {
  logger.info("Starting periodic balance updater (30 second interval)");
  
  // Initial update
  updateBalanceCache(faucetServer, demos);
  
  // Set up periodic updates every 30 seconds (reduced from 5 seconds)
  setInterval(() => {
    updateBalanceCache(faucetServer, demos);
  }, 30000);
}

/**
 * Forces a balance update from the blockchain
 */
async function forceBalanceUpdate(faucetServer: FaucetServer, demos: websdk.Demos): Promise<void> {
  logger.info("Forcing balance update from blockchain");
  await updateBalanceCache(faucetServer, demos);
}

/**
 * Sets up API routes after initialization
 */
function setupRoutes(faucetServer: FaucetServer, demos: websdk.Demos) {
  // Root route
  app.get("/", (req, res) => {
    res.json({ 
      service: "Demos Faucet API",
      version: "1.0.0",
      endpoints: [
        "/api/health",
        "/api/balance",
        "/api/request",
        "/api/stats/address",
        "/api/stats/global"
      ]
    });
  });

  // API Routes
  app.get("/api/test", (req, res) => {
    logger.info("Test endpoint hit");
    res.json({ message: "Hello World", timestamp: new Date().toISOString() });
  });

  app.get("/api/balance", async (req, res) => {
    try {
      const publicKey = faucetServer.getPublicKey();
      logger.info("Getting cached balance for public key: " + publicKey);
      
      if (!publicKey) {
        logger.error("No public key available");
        return res.status(500).json({ 
          error: "Faucet wallet not initialized",
          status: 500,
          body: { balance: 0 }
        });
      }

      // Get cached balance
      const cachedBalance = faucetServer.getCachedBalance();
      
      if (!cachedBalance) {
        logger.warn("No cached balance available yet");
        return res.json({
          status: 200,
          body: {
            balance: 0,
            message: "Balance not yet available - updating...",
            publicKey: publicKey,
            cached: false
          },
        });
      }

      // Return cached balance
      return res.json({
        status: 200,
        body: {
          balance: cachedBalance.balance,
          publicKey: publicKey,
          cached: true,
          lastUpdated: cachedBalance.lastUpdated
        },
      });
    } catch (error) {
      logger.error("Error getting balance:", error);
      return res.status(500).json({ 
        error: "Failed to get balance",
        status: 500,
        body: { balance: 0 }
      });
    }
  });

  // Request tokens endpoint (moved to setupRoutes)
  app.post("/api/request", faucetRateLimit, async (req, res) => {
    try {
      const { address, amount } = req.body;
      const ip = getClientIP(req);

      // Validate input
      if (!address || !amount) {
        return res.status(400).json({
          status: 400,
          body: "Address and amount are required",
        });
      }

      // Force balance update before processing request
      await forceBalanceUpdate(faucetServer, demos);

      // Check safeguards
      const safeguards = faucetServer.getSafeguards();
      const checkResult = await safeguards.checkSafeguards(address, amount, ip);

      if (!checkResult.allowed) {
        logger.warn("Safeguard check failed", { address, amount, ip, reason: checkResult.message });
        return res.status(400).json({
          status: 400,
          body: checkResult.message,
        });
      }

      // Transfer the tokens
      let result = await transferTokens(demos, faucetServer, amount, address);

      if (result.success) {
        // Force balance update after successful transfer
        await forceBalanceUpdate(faucetServer, demos);
        
        return res.json({
          status: 200,
          body: {
            txHash: result.txHash,
            confirmationBlock: result.confirmationBlock,
            message: result.message,
          },
        });
      } else {
        return res.status(400).json({
          status: 400,
          body: result.message,
        });
      }
    } catch (error) {
      logger.error("Error processing faucet request:", error);
      return res.status(500).json({
        status: 500,
        body: "Internal server error",
      });
    }
  });

  app.get("/api/stats/address", async (req, res) => {
    try {
      const address = req.query.address as string;

      if (!address) {
        return res.status(400).json({
          status: 400,
          body: "Address parameter is required",
        });
      }

      const stats = await faucetServer.getSafeguards().getAddressStats(address);
      res.json({
        status: 200,
        body: stats,
      });
    } catch (error) {
      logger.error("Error getting address stats:", error);
      res.status(500).json({ error: "Failed to get address stats" });
    }
  });

  app.get("/api/stats/global", async (req, res) => {
    try {
      const stats = await faucetServer.getSafeguards().getGlobalStats();
      res.json({
        status: 200,
        body: stats,
      });
    } catch (error) {
      logger.error("Error getting global stats:", error);
      res.status(500).json({ error: "Failed to get global stats" });
    }
  });

  app.get("/api/health", (req, res) => {
    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      walletConnected: !!faucetServer.getPublicKey()
    });
  });

  // 404 handler
  app.use((req, res) => {
    logger.warn("404 - Route not found", { path: req.path, method: req.method });
    res.status(404).json({ error: "Not Found" });
  });

  // Error handler
  app.use(errorHandler);
}

/**
 * Starts the server.
 */
async function server() {
  app.listen(port, () => {
    logger.info(`Faucet server listening on port ${port}`);
  });
}

// SECTION Initialization logic

// Initialize the faucet server
const faucetServer = new FaucetServer();
// Initialize the demos instance
let demos = new websdk.Demos();
// Connecting to the network
await demos.connect(faucetServer.getRpcUrl());
// Connecting to the wallet
let mnemonic = faucetServer.getMnemonic();
console.log("Trying to connect with mnemonic");
let walletAddress = await demos.connectWallet(mnemonic);
console.log("Connected to the network and wallet: " + walletAddress);
faucetServer.setPublicKey(walletAddress);

// Setup routes and start balance updater
setupRoutes(faucetServer, demos);
startBalanceUpdater(faucetServer, demos);

// Starting the server
server();
