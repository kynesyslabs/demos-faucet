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

  public async checkAndRecordRequest(
    address: string,
    ip: string,
    demos?: any
  ): Promise<{
    allowed: boolean;
    message: string;
    amount?: number;
  }> {
    const now = Math.floor(Date.now() / 1000);
    const timeInterval = this.faucetServer.timeInterval;
    const numberPerInterval = this.faucetServer.numberPerInterval;
    let maxAmount = this.faucetServer.maxAmount;

    // Check for Demos identity and increase limit if present
    if (demos) {
      try {
        const addressInfo = await demos.getAddressInfo(address);
        // Check if address has an identity (could be string, array, or object)
        const hasIdentity = addressInfo?.identity &&
          (typeof addressInfo.identity === 'string' ? addressInfo.identity.length > 0 :
           Array.isArray(addressInfo.identity) ? addressInfo.identity.length > 0 :
           typeof addressInfo.identity === 'object' ? Object.keys(addressInfo.identity).length > 0 :
           Boolean(addressInfo.identity));

        if (hasIdentity) {
          maxAmount = 100; // Increase to 100 DEM for addresses with identity
          console.log(`Address ${address} has identity, increased limit to ${maxAmount} DEM`);
        } else {
          console.log(`Address ${address} has no identity, using base limit of ${maxAmount} DEM`);
        }
      } catch (error) {
        console.error(`Error checking identity for ${address}:`, error);
        // If error checking identity, use base maxAmount
      }
    }

    // Server determines the amount to send (not client)
    let amount = maxAmount;

    // Use SQLite transaction to prevent race conditions
    // BEGIN EXCLUSIVE ensures no other transaction can read or write
    try {
      this.db.run("BEGIN EXCLUSIVE TRANSACTION");

      // Get recent requests for this address within the transaction
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

      // Handle NULL from SUM() when no rows match
      const stats = {
        total_amount: recentRequests[0]?.total_amount || 0,
        request_count: recentRequests[0]?.request_count || 0
      };

      // Check number of requests per interval
      if (stats.request_count >= numberPerInterval) {
        this.db.run("ROLLBACK");
        return {
          allowed: false,
          message: `Address has reached the maximum number of requests (${numberPerInterval}) for this time interval. Please try again later.`,
        };
      }

      // Check total amount per interval and adjust if needed
      const remainingAllowance = maxAmount - stats.total_amount;
      if (amount > remainingAllowance) {
        if (remainingAllowance <= 0) {
          this.db.run("ROLLBACK");
          return {
            allowed: false,
            message: `Address has reached the maximum amount limit (${maxAmount}) for this time interval. Please try again later.`,
          };
        }
        // Reduce amount to remaining allowance
        console.log(`[Safeguards] Reducing request amount from ${amount} to ${remainingAllowance} for address ${address} (total: ${stats.total_amount}/${maxAmount})`);
        amount = remainingAllowance;
      }

      // Record the request atomically
      this.db.run(
        `
        INSERT INTO requests (address, amount, ip, timestamp)
        VALUES (?, ?, ?, ?)
      `,
        [address, amount, ip, now]
      );

      // Commit the transaction
      this.db.run("COMMIT");

      return {
        allowed: true,
        message: "Request allowed",
        amount: amount,
      };
    } catch (error) {
      // Rollback on any error
      try {
        this.db.run("ROLLBACK");
      } catch (rollbackError) {
        console.error("Error rolling back transaction:", rollbackError);
      }
      console.error("Error in checkAndRecordRequest:", error);
      return {
        allowed: false,
        message: "An error occurred processing your request. Please try again.",
      };
    }
  }

  /**
   * Phase 1: Check if a request would be allowed without recording it
   * This allows us to validate before attempting the token transfer
   */
  public async checkIfAllowed(
    address: string,
    ip: string,
    demos?: any
  ): Promise<{
    allowed: boolean;
    message: string;
    amount?: number;
  }> {
    const now = Math.floor(Date.now() / 1000);
    const timeInterval = this.faucetServer.timeInterval;
    const numberPerInterval = this.faucetServer.numberPerInterval;
    let maxAmount = this.faucetServer.maxAmount;

    // Check for Demos identity and increase limit if present
    if (demos) {
      try {
        const addressInfo = await demos.getAddressInfo(address);
        // Check if address has an identity (could be string, array, or object)
        const hasIdentity = addressInfo?.identity &&
          (typeof addressInfo.identity === 'string' ? addressInfo.identity.length > 0 :
           Array.isArray(addressInfo.identity) ? addressInfo.identity.length > 0 :
           typeof addressInfo.identity === 'object' ? Object.keys(addressInfo.identity).length > 0 :
           Boolean(addressInfo.identity));

        if (hasIdentity) {
          maxAmount = 100; // Increase to 100 DEM for addresses with identity
          console.log(`Address ${address} has identity, increased limit to ${maxAmount} DEM`);
        } else {
          console.log(`Address ${address} has no identity, using base limit of ${maxAmount} DEM`);
        }
      } catch (error) {
        console.error(`Error checking identity for ${address}:`, error);
        // If error checking identity, use base maxAmount
      }
    }

    // Server determines the amount to send (not client)
    let amount = maxAmount;

    // Use SQLite transaction to check current state
    try {
      this.db.run("BEGIN EXCLUSIVE TRANSACTION");

      // Get recent requests for this address within the transaction
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

      // Handle NULL from SUM() when no rows match
      const stats = {
        total_amount: recentRequests[0]?.total_amount || 0,
        request_count: recentRequests[0]?.request_count || 0
      };

      this.db.run("ROLLBACK"); // Don't record anything yet

      // Check number of requests per interval
      if (stats.request_count >= numberPerInterval) {
        return {
          allowed: false,
          message: `Address has reached the maximum number of requests (${numberPerInterval}) for this time interval. Please try again later.`,
        };
      }

      // Check total amount per interval and adjust if needed
      const remainingAllowance = maxAmount - stats.total_amount;
      if (amount > remainingAllowance) {
        if (remainingAllowance <= 0) {
          return {
            allowed: false,
            message: `Address has reached the maximum amount limit (${maxAmount}) for this time interval. Please try again later.`,
          };
        }
        // Reduce amount to remaining allowance
        console.log(`[Safeguards] Would reduce request amount from ${amount} to ${remainingAllowance} for address ${address} (total: ${stats.total_amount}/${maxAmount})`);
        amount = remainingAllowance;
      }

      return {
        allowed: true,
        message: "Request allowed",
        amount: amount,
      };
    } catch (error) {
      // Rollback on any error
      try {
        this.db.run("ROLLBACK");
      } catch (rollbackError) {
        console.error("Error rolling back transaction:", rollbackError);
      }
      console.error("Error in checkIfAllowed:", error);
      return {
        allowed: false,
        message: "An error occurred processing your request. Please try again.",
      };
    }
  }

  /**
   * Phase 2: Record a successful request after token transfer completes
   * This ensures quota is only consumed when tokens are actually delivered
   */
  public async recordSuccessfulRequest(
    address: string,
    ip: string,
    amount: number
  ): Promise<void> {
    const now = Math.floor(Date.now() / 1000);

    try {
      this.db.run(
        `
        INSERT INTO requests (address, amount, ip, timestamp)
        VALUES (?, ?, ?, ?)
      `,
        [address, amount, ip, now]
      );
      console.log(`[Safeguards] Recorded successful request for ${address}: ${amount} DEM`);
    } catch (error) {
      // Log error but don't throw - user already got tokens
      // This can be reconciled from transaction logs if needed
      console.error("Error recording successful request (user already received tokens):", error);
    }
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

    // Handle NULL from aggregate functions when no rows match
    const currentStats = {
      total_requests: stats[0]?.total_requests || 0,
      total_amount: stats[0]?.total_amount || 0,
      last_request: stats[0]?.last_request || null,
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
