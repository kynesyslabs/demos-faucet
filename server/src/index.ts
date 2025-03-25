import * as demosdk from "@kynesyslabs/demosdk";
import dotenv from "dotenv";

dotenv.config();

class FaucetServer {
  private privateKey: string;
  private publicKey: string;
  public rpcUrl: string;
  public timeInterval: number;
  public numberPerInterval: number;
  public maxAmount: number;

  constructor() {
    this.privateKey = process.env.PRIVATE_KEY || "";
    this.publicKey = process.env.PUBLIC_KEY || ""; // TODO Derive from private key
    this.rpcUrl = process.env.RPC_URL || "";
    this.timeInterval = parseInt(process.env.TIME_INTERVAL || "86400");
    this.numberPerInterval = parseInt(process.env.NUMBER_PER_INTERVAL || "1");
    this.maxAmount = parseInt(process.env.MAX_AMOUNT || "1000");
  }
}

const server = Bun.serve({
  port: 3000,
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

    // Your API endpoints here
    if (req.url.endsWith("/api/faucet")) {
      // TODO: Your faucet logic using @kynesyslabs/demosdk
    }

    if (req.url.endsWith("/api/balance")) {
      // TODO: Your balance logic using @kynesyslabs/demosdk
    }

    if (req.url.endsWith("/api/request")) {
      // TODO: Your request logic using @kynesyslabs/demosdk
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
