import * as demosdk from "@kynesyslabs/demosdk";
import dotenv from "dotenv";
import { Safeguards } from "./safeguards";
import express from "express";
import cors from "cors"

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Enable CORS for all routes
app.use(
  cors({
    origin: ["https://faucet.demos.sh", "http://localhost:4442"], // Add your frontend domains
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);

// Parse JSON bodies
app.use(express.json());

export class FaucetServer {
  private mnemonic: string;
  private publicKey: string;
  public rpcUrl: string;
  public timeInterval: number;
  public numberPerInterval: number;
  public maxAmount: number;
  public port: number;
  private safeguards: Safeguards;

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

// SECTION Validation helpers

/**
 * Validates a Demos address format
 */
function isValidAddress(address: unknown): address is string {
  if (typeof address !== 'string') return false;
  // Basic validation: check if it's a non-empty string
  // Adjust regex based on actual Demos address format
  return /^[a-zA-Z0-9]{40,66}$/.test(address);
}

/**
 * Extracts real client IP from X-Forwarded-For header
 * Assumes nginx sets X-Forwarded-For properly
 */
function getClientIP(req: Request): string {
  const xForwardedFor = req.headers.get("x-forwarded-for");
  if (xForwardedFor) {
    // X-Forwarded-For format: "client, proxy1, proxy2"
    // Take the leftmost (original client) IP
    const ips = xForwardedFor.split(',').map(ip => ip.trim());
    return ips[0] || "unknown";
  }
  return "unknown";
}

// SECTION Server logic
/**
 * Starts the server.
 */
async function server() {
  const server = Bun.serve({
    port: faucetServer.port,
    async fetch(req) {
      // Handle CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": "https://faucet.demos.sh",
            "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }

      // Get real client IP (protected against spoofing)
      const ip = getClientIP(req);

      // Your API endpoints here
      if (req.url.endsWith("/api/test")) {
        console.log("Test endpoint hit");
        return new Response("Hello World", {
          status: 200,
          headers: {
            "Access-Control-Allow-Origin": "https://faucet.demos.sh",
            "Access-Control-Allow-Methods": "GET, POST",
            "Access-Control-Allow-Headers": "Content-Type",
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
        // Only allow POST requests
        if (req.method !== "POST") {
          return Response.json(
            { status: 405, body: "Method not allowed" },
            { status: 405 }
          );
        }

        // Parse and validate request body
        let body: any;
        try {
          body = await req.json();
        } catch (error) {
          return Response.json(
            { status: 400, body: "Invalid JSON in request body" },
            { status: 400 }
          );
        }

        // Validate address format
        if (!isValidAddress(body?.address)) {
          return Response.json(
            { status: 400, body: "Invalid or missing address" },
            { status: 400 }
          );
        }

        // Check safeguards and get server-determined amount
        const safeguards = faucetServer.getSafeguards();
        const checkResult = await safeguards.checkAndRecordRequest(
          body.address,
          ip,
          demos
        );

        if (!checkResult.allowed) {
          return Response.json(
            { status: 429, body: checkResult.message },
            {
              status: 429,
              headers: {
                "Access-Control-Allow-Origin": "https://faucet.demos.sh",
                "Access-Control-Allow-Methods": "GET, POST",
                "Access-Control-Allow-Headers": "Content-Type",
                "Retry-After": "21600", // 6 hours in seconds
              },
            }
          );
        }

        // Server determines amount (not client)
        const amount = checkResult.amount!;

        // Transfer the tokens
        let result = await transferTokens(
          demos,
          faucetServer,
          amount,
          body.address
        );

        let responseBody = {};
        let status = 200;
        if (result.success) {
          responseBody = {
            status: 200,
            body: {
              txHash: result.txHash,
              message: result.message,
              amount: amount,
            },
          };
        } else {
          responseBody = {
            status: 500,
            body: "Transaction failed. Please try again later.",
          };
          status = 500;
        }
        return Response.json(responseBody, {
          status: status,
          headers: {
            "Access-Control-Allow-Origin": "https://faucet.demos.sh",
            "Access-Control-Allow-Methods": "GET, POST",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }

      if (req.url.endsWith("/api/stats/address")) {
        // Only allow GET requests
        if (req.method !== "GET") {
          return Response.json(
            { status: 405, body: "Method not allowed" },
            { status: 405 }
          );
        }

        const url = new URL(req.url);
        const address = url.searchParams.get("address");

        if (!address) {
          return Response.json(
            { status: 400, body: "Address parameter is required" },
            { status: 400 }
          );
        }

        // Validate address format
        if (!isValidAddress(address)) {
          return Response.json(
            { status: 400, body: "Invalid address format" },
            { status: 400 }
          );
        }

        const stats = await faucetServer
          .getSafeguards()
          .getAddressStats(address);
        return Response.json(
          { status: 200, body: stats },
          {
            status: 200,
            headers: {
              "Access-Control-Allow-Origin": "https://faucet.demos.sh",
              "Access-Control-Allow-Methods": "GET",
              "Access-Control-Allow-Headers": "Content-Type",
            },
          }
        );
      }

      if (req.url.endsWith("/api/stats/global")) {
        // Only allow GET requests
        if (req.method !== "GET") {
          return Response.json(
            { status: 405, body: "Method not allowed" },
            { status: 405 }
          );
        }

        const stats = await faucetServer.getSafeguards().getGlobalStats();
        return Response.json(
          { status: 200, body: stats },
          {
            status: 200,
            headers: {
              "Access-Control-Allow-Origin": "https://faucet.demos.sh",
              "Access-Control-Allow-Methods": "GET",
              "Access-Control-Allow-Headers": "Content-Type",
            },
          }
        );
      }

      if (req.url.endsWith("/api/history")) {
        // TODO: Your history logic using @kynesyslabs/demosdk
      }

      if (req.url.endsWith("/api/status")) {
        // TODO: Your status logic using @kynesyslabs/demosdk
      }

      return new Response("Not Found", { status: 404 });
    },
  });
  console.log(`Listening on http://localhost:${server.port}`);
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
