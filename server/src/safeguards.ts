import { Database } from "bun:sqlite";
import { FaucetServer } from "./index";

interface RequestRecord {
  address: string;
  amount: number;
  ip: string;
  timestamp: number;
}

export class Safeguards {
  private db: Database;
  private faucetServer: FaucetServer;

  constructor(faucetServer: FaucetServer) {
    this.faucetServer = faucetServer;
    this.db = new Database("faucet.db");
    this.initDatabase();
  }

  private initDatabase() {
    // Create requests table if it doesn't exist
    this.db.run(`
      CREATE TABLE IF NOT EXISTS requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        address TEXT NOT NULL,
        amount INTEGER NOT NULL,
        ip TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `);

    // Create index for faster queries
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_address_timestamp 
      ON requests(address, timestamp)
    `);
  }

  public async checkSafeguards(
    address: string,
    amount: number,
    ip: string
  ): Promise<{
    allowed: boolean;
    message: string;
  }> {
    const now = Math.floor(Date.now() / 1000);
    const timeInterval = this.faucetServer.timeInterval;
    const numberPerInterval = this.faucetServer.numberPerInterval;
    const maxAmount = this.faucetServer.maxAmount;

    // Check if amount exceeds max allowed
    if (amount > maxAmount) {
      return {
        allowed: false,
        message: `Requested amount ${amount} exceeds maximum allowed amount of ${maxAmount} DEMOS`,
      };
    }

    // Get recent requests for this address
    const recentRequests = this.db
      .query(
        `
      SELECT SUM(amount) as total_amount, COUNT(*) as request_count
      FROM requests
      WHERE address = ? AND timestamp > ?
    `
      )
      .all(address, now - timeInterval) as {
      total_amount: number;
      request_count: number;
    }[];

    const stats = recentRequests[0] || { total_amount: 0, request_count: 0 };

    // Check number of requests per interval
    if (stats.request_count >= numberPerInterval) {
      return {
        allowed: false,
        message: `Address ${address} has reached the maximum number of requests (${numberPerInterval}) for this time interval`,
      };
    }

    // Check total amount per interval
    if (stats.total_amount + amount > maxAmount) {
      return {
        allowed: false,
        message: `Address ${address} would exceed the maximum amount limit of ${maxAmount} DEMOS for this time interval`,
      };
    }

    // Record the request
    this.db.run(
      `
      INSERT INTO requests (address, amount, ip, timestamp)
      VALUES (?, ?, ?, ?)
    `,
      [address, amount, ip, now]
    );

    return {
      allowed: true,
      message: "Request allowed",
    };
  }

  public async getAddressStats(address: string): Promise<{
    totalRequests: number;
    totalAmount: number;
    lastRequest: number | null;
    remainingRequests: number;
    remainingAmount: number;
    timeUntilReset: number;
  }> {
    const now = Math.floor(Date.now() / 1000);
    const timeInterval = this.faucetServer.timeInterval;
    const numberPerInterval = this.faucetServer.numberPerInterval;
    const maxAmount = this.faucetServer.maxAmount;

    const stats = this.db
      .query(
        `
      SELECT 
        COUNT(*) as total_requests,
        SUM(amount) as total_amount,
        MAX(timestamp) as last_request
      FROM requests
      WHERE address = ? AND timestamp > ?
    `
      )
      .all(address, now - timeInterval) as {
      total_requests: number;
      total_amount: number;
      last_request: number | null;
    }[];

    const currentStats = stats[0] || {
      total_requests: 0,
      total_amount: 0,
      last_request: null,
    };

    // Calculate time until reset
    const timeUntilReset = currentStats.last_request
      ? timeInterval - (now - currentStats.last_request)
      : 0;

    return {
      totalRequests: currentStats.total_requests || 0,
      totalAmount: currentStats.total_amount || 0,
      lastRequest: currentStats.last_request || null,
      remainingRequests: Math.max(
        0,
        numberPerInterval - (currentStats.total_requests || 0)
      ),
      remainingAmount: Math.max(
        0,
        maxAmount - (currentStats.total_amount || 0)
      ),
      timeUntilReset: Math.max(0, timeUntilReset),
    };
  }

  public async getGlobalStats(): Promise<{
    totalRequests: number;
    totalAmount: number;
    uniqueAddresses: number;
    requestsPerHour: number;
    topAddresses: Array<{
      address: string;
      totalAmount: number;
      requestCount: number;
    }>;
  }> {
    const now = Math.floor(Date.now() / 1000);
    const oneHourAgo = now - 3600;

    // Get total stats
    const totalStats = this.db
      .query(
        `
      SELECT 
        COUNT(*) as total_requests,
        SUM(amount) as total_amount,
        COUNT(DISTINCT address) as unique_addresses
      FROM requests
    `
      )
      .all() as {
      total_requests: number;
      total_amount: number;
      unique_addresses: number;
    }[];

    // Get hourly requests
    const hourlyStats = this.db
      .query(
        `
      SELECT COUNT(*) as hourly_requests
      FROM requests
      WHERE timestamp > ?
    `
      )
      .all(oneHourAgo) as { hourly_requests: number }[];

    // Get top addresses
    const topAddresses = this.db
      .query(
        `
      SELECT 
        address,
        SUM(amount) as total_amount,
        COUNT(*) as request_count
      FROM requests
      GROUP BY address
      ORDER BY total_amount DESC
      LIMIT 10
    `
      )
      .all() as Array<{
      address: string;
      total_amount: number;
      request_count: number;
    }>;

    return {
      totalRequests: totalStats[0]?.total_requests || 0,
      totalAmount: totalStats[0]?.total_amount || 0,
      uniqueAddresses: totalStats[0]?.unique_addresses || 0,
      requestsPerHour: hourlyStats[0]?.hourly_requests || 0,
      topAddresses: topAddresses.map((addr) => ({
        address: addr.address,
        totalAmount: addr.total_amount,
        requestCount: addr.request_count,
      })),
    };
  }
}
