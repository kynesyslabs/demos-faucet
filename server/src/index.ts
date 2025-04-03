import * as demosdk from "@kynesyslabs/demosdk";
import dotenv from "dotenv";
import { Safeguards } from "./safeguards";
import express from "express";
import cors from "cors";

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
  private privateKey: string;
  private publicKey: string;
  public rpcUrl: string;
  public timeInterval: number;
  public numberPerInterval: number;
  public maxAmount: number;
  public port: number;
  private safeguards: Safeguards;

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
  // Creating a tx
  console.log("Transferring tokens to: " + to);
  let tx = await demos.transfer(to, amount);
  console.log("Confirming and broadcasting the tx");
  let confirmation = await demos.confirm(tx);
  console.log("Confirmation: " + JSON.stringify(confirmation, null, 2));
  if (!confirmation.response.data.valid) {
    console.log("Transaction failed: ");
    console.log(JSON.stringify(confirmation, null, 2));
    return {
      success: false,
      message: "Transaction failed: " + JSON.stringify(confirmation, null, 2),
      txHash: "",
      confirmationBlock: -1,
    };
  }
  const txHash = confirmation.response.data.transaction.hash;
  const confirmationBlock = confirmation.response.data.reference_block;
  console.log("Broadcasting the tx");
  let result = await demos.broadcast(confirmation);
  console.log("Result: " + JSON.stringify(result, null, 2));
  return {
    success: true,
    message: "Transaction successful: " + JSON.stringify(result, null, 2),
    txHash: txHash,
    confirmationBlock: confirmationBlock,
  };
}

// SECTION Server logic
/**
 * Starts the server.
 */
async function server() {
  const server = Bun.serve({
    port: faucetServer.port,
    async fetch(req) {
      // Handle CORS
      if (req.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }

      // Get client IP
      const ip = req.headers.get("x-forwarded-for") || "unknown";

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
        let intBalance = Number(balance);
        return Response.json(
          {
            status: 200,
            body: {
              balance: intBalance,
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
        const checkResult = await safeguards.checkSafeguards(
          body.address,
          body.amount,
          ip
        );

        if (!checkResult.allowed) {
          return Response.json({
            status: 400,
            body: checkResult.message,
          });
        }

        // Transfer the tokens
        let result = await transferTokens(
          demos,
          faucetServer,
          body.amount,
          body.address
        );

        let responseBody = {};
        if (result.success) {
          responseBody = {
            status: 200,
            body: {
              txHash: result.txHash,
              confirmationBlock: result.confirmationBlock,
              message: result.message,
            },
          };
        } else {
          responseBody = {
            status: 400,
            body: result.message,
          };
        }
        return Response.json(responseBody);
      }

      if (req.url.endsWith("/api/stats/address")) {
        const url = new URL(req.url);
        const address = url.searchParams.get("address");

        if (!address) {
          return Response.json({
            status: 400,
            body: "Address parameter is required",
          });
        }

        const stats = await faucetServer
          .getSafeguards()
          .getAddressStats(address);
        return Response.json({
          status: 200,
          body: stats,
        });
      }

      if (req.url.endsWith("/api/stats/global")) {
        const stats = await faucetServer.getSafeguards().getGlobalStats();
        return Response.json({
          status: 200,
          body: stats,
        });
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
let pk = faucetServer.getPrivateKey();
console.log("Trying to connect with private key: " + pk);
await demos.connectWallet(pk);
let publicKey = demos.keypair?.publicKey;
if (!publicKey) {
  throw new Error("Failed to connect to the wallet");
}
console.log(
  "Connected to the network and wallet: " + publicKey.toString("hex")
);
faucetServer.setPublicKey(publicKey.toString("hex"));

// Starting the server
server();
