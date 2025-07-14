import * as demosdk from "@kynesyslabs/demosdk";
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
  demos: demosdk.websdk.Demos,
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
    
    // Get current nonce
    const fromAddress = faucetServer.getPublicKey();
    const nonce = await demos.getNonce(fromAddress);
    console.log(`Using nonce: ${nonce}`);
    
    // Send transaction using simplified method (like working tools)
    const txHash = await demos.send(to, amount, nonce);
    console.log(`Transaction sent with hash: ${txHash}`);
    
    return {
      success: true,
      message: `Transaction successful: ${txHash}`,
      txHash: txHash,
      confirmationBlock: -1, // Not available with send method
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

// SECTION Server logic
/**
 * Starts the periodic balance updater
 */
function startBalanceUpdater(faucetServer: FaucetServer, demos: demosdk.websdk.Demos) {
  logger.info("Starting periodic balance updater (5 second interval)");
  
  // Initial update
  updateBalanceCache(faucetServer, demos);
  
  // Set up periodic updates every 5 seconds
  setInterval(() => {
    updateBalanceCache(faucetServer, demos);
  }, 5000);
}

/**
 * Sets up API routes after initialization
 */
function setupRoutes(faucetServer: FaucetServer, demos: demosdk.websdk.Demos) {
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

      if (req.url.endsWith("/api/faucet")) {
        // TODO: Your faucet logic using @kynesyslabs/demosdk
      }

      if (req.url.endsWith("/api/balance")) {
        console.log("Getting balance for: " + faucetServer.getPublicKey());
        let addrInfo = await demos.getAddressInfo(faucetServer.getPublicKey());
        console.log("Address info: ");
        console.log(addrInfo);

        let balance = addrInfo?.balance;
        return Response.json(
          {
            status: 200,
            body: {
              balance: balance,
            },
          },
          {
            headers: {
              "Access-Control-Allow-Origin": "https://faucet.demos.sh",
              "Access-Control-Allow-Methods": "GET, POST",
              "Access-Control-Allow-Headers": "Content-Type",
            },
          }
        );
      }

      if (req.url.endsWith("/api/request")) {
        // Getting the request body
        let body = await req.json();

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

        let responseBody = {};
        if (result.success) {
          responseBody = {
            status: 200,
            body: {
              txHash: result.txHash,
              message: result.message,
            },
          };
        } else {
          responseBody = {
            status: 400,
            body: result.message,
          };
        }
        return Response.json(responseBody, {
          headers: {
            "Access-Control-Allow-Origin": "https://faucet.demos.sh",
            "Access-Control-Allow-Methods": "GET, POST",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }

      if (req.url.endsWith("/api/stats/address")) {
        const url = new URL(req.url);
        const address = url.searchParams.get("address");

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
      rpcConnected: !!demos?.rpc,
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
let demos = new demosdk.websdk.Demos();
// Connecting to the network
await demos.connect(faucetServer.getRpcUrl());
// Connecting to the wallet
let mnemonic = faucetServer.getMnemonic();
console.log("Trying to connect with mnemonic");
let walletAddress = await demos.connectWallet(mnemonic);
console.log("Connected to the network and wallet: " + walletAddress);
faucetServer.setPublicKey(walletAddress);

// Starting the server
server();
