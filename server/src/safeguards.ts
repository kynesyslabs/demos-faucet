import { Database } from "bun:sqlite";
import type { SafeguardLimits } from "./config";

export type DenyReason =
  | "invalid_address"
  | "invalid_amount"
  | "address_count"
  | "address_amount"
  | "ip_count"
  | "ip_amount"
  | "global_amount";

export type ValidationResult =
  | { ok: true; address: string; amount: number }
  | { ok: false; reason: DenyReason; message: string };

export type Reservation =
  | { allowed: true; id: number; address: string; amount: number }
  | { allowed: false; reason: DenyReason; message: string };

const ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/;

/** Lowercased address, or null when it is not 0x + 64 hex. */
export function normalizeAddress(address: unknown): string | null {
  if (typeof address !== "string") return null;
  const trimmed = address.trim();
  return ADDRESS_RE.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function validateRequest(
  address: unknown,
  amount: unknown,
  maxAmount: number,
): ValidationResult {
  const normalized = normalizeAddress(address);
  if (!normalized) {
    return {
      ok: false,
      reason: "invalid_address",
      message: "Address must be 0x followed by 64 hex characters",
    };
  }
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) {
    return {
      ok: false,
      reason: "invalid_amount",
      message: "Amount must be a positive whole number of DEM",
    };
  }
  if (amount > maxAmount) {
    return {
      ok: false,
      reason: "invalid_amount",
      message: `Requested amount ${amount} exceeds maximum allowed amount of ${maxAmount} DEM`,
    };
  }
  return { ok: true, address: normalized, amount };
}

interface WindowTotals {
  count: number;
  amount: number;
}

export class Safeguards {
  private db: Database;
  private limits: SafeguardLimits;

  constructor(limits: SafeguardLimits, dbPath: string = "faucet.db") {
    this.limits = limits;
    this.db = new Database(dbPath, { create: true });
    // A second process on the same file waits for the write lock instead of
    // failing the request outright.
    this.db.run("PRAGMA busy_timeout = 5000");
    this.initDatabase();
  }

  private initDatabase() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        address TEXT NOT NULL,
        amount INTEGER NOT NULL,
        ip TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `);
    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_address_timestamp ON requests(address, timestamp)`,
    );
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_ip_timestamp ON requests(ip, timestamp)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_timestamp ON requests(timestamp)`);
  }

  private totals(where: string, params: (string | number)[]): WindowTotals {
    const row = this.db
      .query(
        `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM requests WHERE ${where}`,
      )
      .get(...params) as WindowTotals | null;
    return { count: row?.count ?? 0, amount: row?.amount ?? 0 };
  }

  /**
   * Validates the request, checks every cap and records it in one
   * synchronous transaction, so concurrent requests cannot both pass a check
   * before either is counted. The caller must `release` the reservation if
   * the transfer does not happen.
   */
  public reserve(
    address: unknown,
    amount: unknown,
    ip: string,
    now: number = Math.floor(Date.now() / 1000),
  ): Reservation {
    const valid = validateRequest(address, amount, this.limits.maxAmount);
    if (!valid.ok) return { allowed: false, reason: valid.reason, message: valid.message };

    const since = now - this.limits.timeInterval;

    let outcome: Reservation | undefined;
    const check = this.db.transaction(() => {
      outcome = this.checkAndInsert(valid.address, valid.amount, ip, now, since);
    });

    // IMMEDIATE takes the write lock up front, which also keeps a second
    // process on the same database file from interleaving its checks.
    check.immediate();
    return outcome!;
  }

  private checkAndInsert(
    address: string,
    amount: number,
    ip: string,
    now: number,
    since: number,
  ): Reservation {
    const l = this.limits;
    const byAddress = this.totals("address = ? AND timestamp > ?", [address, since]);
    if (byAddress.count >= l.numberPerInterval) {
      return {
        allowed: false,
        reason: "address_count",
        message: `Address has reached the maximum number of requests (${l.numberPerInterval}) for this time interval`,
      };
    }
    if (byAddress.amount + amount > l.maxAmount) {
      return {
        allowed: false,
        reason: "address_amount",
        message: `Address would exceed the maximum amount limit of ${l.maxAmount} DEM for this time interval`,
      };
    }

    const byIp = this.totals("ip = ? AND timestamp > ?", [ip, since]);
    if (byIp.count >= l.numberPerIpPerInterval) {
      return {
        allowed: false,
        reason: "ip_count",
        message: `Your network has reached the maximum number of requests (${l.numberPerIpPerInterval}) for this time interval`,
      };
    }
    if (byIp.amount + amount > l.maxAmountPerIp) {
      return {
        allowed: false,
        reason: "ip_amount",
        message: `Your network would exceed the maximum amount limit of ${l.maxAmountPerIp} DEM for this time interval`,
      };
    }

    const global = this.totals("timestamp > ?", [since]);
    if (global.amount + amount > l.globalMaxAmountPerInterval) {
      return {
        allowed: false,
        reason: "global_amount",
        message: "The faucet has reached its distribution limit for this time interval, try again later",
      };
    }

    const inserted = this.db
      .query(
        `INSERT INTO requests (address, amount, ip, timestamp) VALUES (?, ?, ?, ?) RETURNING id`,
      )
      .get(address, amount, ip, now) as { id: number };
    return { allowed: true, id: inserted.id, address, amount };
  }

  /** Gives the allowance back when the transfer was not sent. */
  public release(id: number): void {
    this.db.query(`DELETE FROM requests WHERE id = ?`).run(id);
  }

  public getAddressStats(
    address: string,
    now: number = Math.floor(Date.now() / 1000),
  ): {
    totalRequests: number;
    totalAmount: number;
    lastRequest: number | null;
    remainingRequests: number;
    remainingAmount: number;
    timeUntilReset: number;
  } {
    const { timeInterval, numberPerInterval, maxAmount } = this.limits;
    const row = this.db
      .query(
        `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount,
                MIN(timestamp) AS first_request, MAX(timestamp) AS last_request
         FROM requests WHERE address = ? AND timestamp > ?`,
      )
      .get(address, now - timeInterval) as {
      count: number;
      amount: number;
      first_request: number | null;
      last_request: number | null;
    } | null;

    const count = row?.count ?? 0;
    const amount = row?.amount ?? 0;
    // The window slides, so the first allowance comes back when the oldest
    // request in it expires.
    const timeUntilReset = row?.first_request
      ? Math.max(0, timeInterval - (now - row.first_request))
      : 0;

    return {
      totalRequests: count,
      totalAmount: amount,
      lastRequest: row?.last_request ?? null,
      remainingRequests: Math.max(0, numberPerInterval - count),
      remainingAmount: Math.max(0, maxAmount - amount),
      timeUntilReset,
    };
  }

  public getGlobalStats(now: number = Math.floor(Date.now() / 1000)): {
    totalRequests: number;
    totalAmount: number;
    uniqueAddresses: number;
    requestsPerHour: number;
    intervalAmount: number;
    intervalRemaining: number;
    topAddresses: Array<{ address: string; totalAmount: number; requestCount: number }>;
  } {
    const total = this.db
      .query(
        `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount,
                COUNT(DISTINCT address) AS unique_addresses
         FROM requests`,
      )
      .get() as { count: number; amount: number; unique_addresses: number } | null;

    const hourly = this.totals("timestamp > ?", [now - 3600]);
    const interval = this.totals("timestamp > ?", [now - this.limits.timeInterval]);

    const top = this.db
      .query(
        `SELECT address, SUM(amount) AS total_amount, COUNT(*) AS request_count
         FROM requests GROUP BY address ORDER BY total_amount DESC LIMIT 10`,
      )
      .all() as Array<{ address: string; total_amount: number; request_count: number }>;

    return {
      totalRequests: total?.count ?? 0,
      totalAmount: total?.amount ?? 0,
      uniqueAddresses: total?.unique_addresses ?? 0,
      requestsPerHour: hourly.count,
      intervalAmount: interval.amount,
      intervalRemaining: Math.max(0, this.limits.globalMaxAmountPerInterval - interval.amount),
      topAddresses: top.map((a) => ({
        address: a.address,
        totalAmount: a.total_amount,
        requestCount: a.request_count,
      })),
    };
  }

  public close(): void {
    this.db.close();
  }
}
