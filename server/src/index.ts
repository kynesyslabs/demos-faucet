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
  public port: number;

  constructor() {
    this.privateKey = process.env.PRIVATE_KEY || "";
    this.publicKey = process.env.PUBLIC_KEY || ""; // TODO Derive from private key
    this.rpcUrl = process.env.RPC_URL || "";
    this.timeInterval = parseInt(process.env.TIME_INTERVAL || "86400");
    this.numberPerInterval = parseInt(process.env.NUMBER_PER_INTERVAL || "1");
    this.maxAmount = parseInt(process.env.MAX_AMOUNT || "1000");
    this.port = parseInt(process.env.PORT || "3000");
  }

  public getPrivateKey() {
    return this.privateKey;
  }

  public getPublicKey() {
    return this.publicKey;
  }

  public getRpcUrl() {
    return this.rpcUrl;
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
): Promise<{ success: boolean; message: string; txHash: string }> {
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
    };
  }
  const txHash = confirmation.response.data.transaction.hash;
  console.log("Broadcasting the tx");
  let result = await demos.broadcast(confirmation);
  console.log("Result: " + JSON.stringify(result, null, 2));
  return {
    success: true,
    message: "Transaction successful: " + JSON.stringify(result, null, 2),
    txHash: txHash,
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

      // Your API endpoints here

      // Basic test endpoint
      if (req.url.endsWith("/api/test")) {
        return new Response("Hello World", { status: 200 });
      }

      if (req.url.endsWith("/api/faucet")) {
        // TODO: Your faucet logic using @kynesyslabs/demosdk
      }

      if (req.url.endsWith("/api/balance")) {
        // TODO: Your balance logic using @kynesyslabs/demosdk
      }

      if (req.url.endsWith("/api/request")) {
        // Getting the request body
        let body = await req.json();
        // TODO Safeguards and ENV variables dependant logic
        // Transferring the tokens
        let result = await transferTokens(
          demos,
          faucetServer,
          body.amount,
          body.address
        );
        // Returning the result (txHash or message if failed)
        return new Response(result.txHash ? result.txHash : result.message, {
          status: result.success ? 200 : 400,
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

// Starting the server
server();
