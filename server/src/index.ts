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
  private privateKey: string;
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
    this.privateKey = process.env.PRIVATE_KEY || "";
    this.publicKey = process.env.PUBLIC_KEY || ""; // TODO Derive from private key
    this.rpcUrl = process.env.RPC_URL || "";
    this.timeInterval = parseInt(process.env.TIME_INTERVAL || "86400");
    this.numberPerInterval = parseInt(process.env.NUMBER_PER_INTERVAL || "1");
    this.maxAmount = parseInt(process.env.MAX_AMOUNT || "1000");
    this.port = parseInt(process.env.PORT || "3000");
    this.safeguards = new Safeguards(this);
  }

  public getPrivateKey() {
    return this.privateKey;
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
  const fromPublicKey = faucetServer.getPublicKey();
  
  logger.info("=== STARTING TOKEN TRANSFER ===", {
    from: fromPublicKey,
    to: to,
    amount: amount,
    timestamp: new Date().toISOString()
  });

  try {
    // Check sender balance first
    logger.info("Checking sender balance before transfer...");
    const senderInfo = await demos.getAddressInfo(fromPublicKey);
    const senderBalance = Number(senderInfo?.balance || 0);
    logger.info("Sender balance check:", {
      senderAddress: fromPublicKey,
      currentBalance: senderBalance.toString(),
      requestedAmount: amount,
      sufficientFunds: senderBalance >= amount
    });

    if (senderBalance < amount) {
      logger.error("INSUFFICIENT FUNDS", {
        required: amount,
        available: senderBalance.toString(),
        shortfall: amount - senderBalance
      });
      return {
        success: false,
        message: `Insufficient funds: need ${amount}, have ${senderBalance}`,
        txHash: "",
        confirmationBlock: -1,
      };
    }

    // Check recipient address format
    logger.info("Validating recipient address format...");
    if (!/^[a-fA-F0-9]{64}$/.test(to)) {
      logger.error("Invalid recipient address format:", to);
      return {
        success: false,
        message: "Invalid recipient address format",
        txHash: "",
        confirmationBlock: -1,
      };
    }

    // Creating transaction
    logger.info("Creating transfer transaction...");
    let tx = await demos.transfer(to, amount);
    logger.info("Transaction created successfully:", {
      txType: "transfer",
      recipient: to,
      amount: amount,
      txObject: tx ? "created" : "failed"
    });

    if (!tx) {
      logger.error("Failed to create transaction");
      return {
        success: false,
        message: "Failed to create transaction",
        txHash: "",
        confirmationBlock: -1,
      };
    }

    // Confirming transaction
    logger.info("Confirming transaction with network...");
    let confirmation = await demos.confirm(tx);
    logger.info("Transaction confirmation response:", {
      valid: confirmation?.response?.data?.valid,
      referenceBlock: confirmation?.response?.data?.reference_block,
      fullResponse: JSON.stringify(confirmation, null, 2)
    });

    if (!confirmation?.response?.data?.valid) {
      logger.error("Transaction validation failed:", {
        confirmationData: confirmation?.response?.data,
        fullConfirmation: JSON.stringify(confirmation, null, 2)
      });
      return {
        success: false,
        message: "Transaction validation failed: " + JSON.stringify(confirmation?.response?.data, null, 2),
        txHash: "",
        confirmationBlock: -1,
      };
    }

    const txHash = confirmation.response.data.transaction.hash;
    const confirmationBlock = confirmation.response.data.reference_block;
    
    logger.info("Transaction validated successfully:", {
      txHash: txHash,
      confirmationBlock: confirmationBlock,
      networkState: "validated"
    });

    // Broadcasting transaction
    logger.info("Broadcasting transaction to network...");
    let result = await demos.broadcast(confirmation);
    logger.info("Broadcast result:", {
      success: result ? "broadcasted" : "failed",
      resultData: JSON.stringify(result, null, 2)
    });

    // Verify transaction was accepted
    if (result) {
      logger.info("=== TRANSFER COMPLETED SUCCESSFULLY ===", {
        txHash: txHash,
        from: fromPublicKey,
        to: to,
        amount: amount,
        confirmationBlock: confirmationBlock,
        broadcastResult: result
      });
    }

    return {
      success: true,
      message: "Transaction broadcast successfully",
      txHash: txHash,
      confirmationBlock: confirmationBlock,
    };

  } catch (error) {
    logger.error("=== TRANSFER FAILED ===", {
      error: error.message,
      stack: error.stack,
      from: fromPublicKey,
      to: to,
      amount: amount,
      timestamp: new Date().toISOString()
    });

    return {
      success: false,
      message: "Transfer failed: " + error.message,
      txHash: "",
      confirmationBlock: -1,
    };
  }
}

/**
 * Periodic balance updater
 */
async function updateBalanceCache(faucetServer: FaucetServer, demos: demosdk.websdk.Demos) {
  try {
    const publicKey = faucetServer.getPublicKey();
    if (!publicKey || !demos || !demos.rpc) {
      logger.warn("Skipping balance update - wallet or RPC not ready");
      return;
    }

    logger.debug("Updating balance cache...");
    const addrInfo = await demos.getAddressInfo(publicKey);
    
    if (addrInfo && addrInfo.balance !== undefined) {
      const rawBalance = addrInfo.balance;
      const rawBalanceString = rawBalance.toString(); // Convert BigInt to string
      faucetServer.setCachedBalance(rawBalanceString, addrInfo);
    } else {
      logger.warn("Failed to get address info for balance update");
    }
  } catch (error) {
    logger.error("Error updating balance cache:", {
      error: error.message,
      stack: error.stack
    });
  }
}

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

      // Check if cache is recent (within last 30 seconds)
      const cacheAge = Date.now() - cachedBalance.lastUpdated;
      const isStale = cacheAge > 30000;
      
      logger.info(`Returning cached balance: ${cachedBalance.balance} (cache age: ${Math.round(cacheAge/1000)}s)`);
      
      res.json({
        status: 200,
        body: {
          balance: cachedBalance.balance,
          publicKey: publicKey,
          addressInfo: cachedBalance.addressInfo,
          cached: true,
          cacheAge: Math.round(cacheAge/1000),
          isStale: isStale,
          lastUpdated: new Date(cachedBalance.lastUpdated).toISOString()
        },
      });
    } catch (error) {
      logger.error("Error getting cached balance:", {
        error: error.message,
        stack: error.stack,
        publicKey: faucetServer.getPublicKey()
      });
      res.status(500).json({ 
        error: "Failed to get balance: " + error.message,
        status: 500,
        body: { balance: 0 }
      });
    }
  });

  app.post("/api/request", faucetRateLimit, validateFaucetRequest, async (req, res) => {
    try {
      const { address, amount } = req.body;
      const ip = getClientIP(req);
      
      logger.info("Faucet request", { address, amount, ip });

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
        logger.info("Tokens transferred successfully", { 
          address, 
          amount, 
          txHash: result.txHash,
          confirmationBlock: result.confirmationBlock 
        });
        
        res.json({
          status: 200,
          body: {
            txHash: result.txHash,
            confirmationBlock: result.confirmationBlock,
            message: result.message,
          },
        });
      } else {
        logger.error("Token transfer failed", { address, amount, error: result.message });
        res.status(400).json({
          status: 400,
          body: result.message,
        });
      }
    } catch (error) {
      logger.error("Error processing faucet request:", error);
      res.status(500).json({ error: "Internal server error" });
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

async function initializeFaucet() {
  try {
    logger.info("Initializing faucet server...");
    
    // Initialize the faucet server
    const faucetServer = new FaucetServer();
    logger.info("Faucet server configuration:", {
      rpcUrl: faucetServer.getRpcUrl(),
      maxAmount: faucetServer.maxAmount,
      timeInterval: faucetServer.timeInterval,
      numberPerInterval: faucetServer.numberPerInterval,
      port: faucetServer.port
    });
    
    // Initialize the demos instance
    logger.info("Creating Demos SDK instance...");
    let demos = new demosdk.websdk.Demos();
    
    // Connecting to the network
    logger.info("Connecting to RPC network: " + faucetServer.getRpcUrl());
    await demos.connect(faucetServer.getRpcUrl());
    logger.info("Successfully connected to RPC network");
    
    // Connecting to the wallet
    let pk = faucetServer.getPrivateKey();
    if (!pk) {
      throw new Error("PRIVATE_KEY not found in environment variables");
    }
    
    logger.info("Connecting wallet with private key (length: " + pk.length + ")");
    await demos.connectWallet(pk);
    
    let publicKey = demos.keypair?.publicKey;
    if (!publicKey) {
      throw new Error("Failed to connect to the wallet - no public key generated");
    }
    
    const publicKeyHex = publicKey.toString("hex");
    logger.info("Successfully connected to wallet. Public key: " + publicKeyHex);
    faucetServer.setPublicKey(publicKeyHex);
    
    // Test the connection by fetching balance and populate initial cache
    logger.info("Testing connection by fetching initial balance...");
    try {
      let addrInfo = await demos.getAddressInfo(publicKeyHex);
      const rawBalance = addrInfo?.balance || 0;
      const rawBalanceString = rawBalance.toString(); // Convert BigInt to string
      
      logger.info("Initial wallet balance:", {
        balance: rawBalanceString,
        addressInfo: addrInfo
      });
      
      // Populate initial cache
      faucetServer.setCachedBalance(rawBalanceString, addrInfo);
    } catch (balanceError) {
      logger.warn("Could not fetch initial balance (wallet might be new):", balanceError.message);
    }
    
    return { faucetServer, demos };
  } catch (error) {
    logger.error("Failed to initialize faucet:", {
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
}

// Initialize and start
async function startServer() {
  logger.info("Starting faucet server...");
  
  // Initialize the system
  const { faucetServer, demos } = await initializeFaucet();
  
  // Setup routes with initialized instances
  setupRoutes(faucetServer, demos);
  
  // Start the periodic balance updater
  startBalanceUpdater(faucetServer, demos);
  
  // Start the server
  await server();
  
  logger.info("Faucet server started successfully");
}

// Start the application
startServer().catch((error) => {
  logger.error("Failed to start server:", error);
  process.exit(1);
});
