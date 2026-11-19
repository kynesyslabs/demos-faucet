export interface SafeguardLimits {
  /** Window length in seconds shared by every cap below. */
  timeInterval: number;
  /** Per request and per address per window, in whole DEM. */
  maxAmount: number;
  numberPerInterval: number;
  maxAmountPerIp: number;
  numberPerIpPerInterval: number;
  globalMaxAmountPerInterval: number;
}

export interface FaucetConfig extends SafeguardLimits {
  mnemonic: string;
  rpcUrl: string;
  port: number;
  dbPath: string;
  trustProxyHops: number;
  transferTimeoutMs: number;
  maxPendingTransfers: number;
  corsOrigins: string[];
}

type Env = Record<string, string | undefined>;

// DEM on the beta mainnet has no market value, so the faucet is the only
// source of supply; a missing or malformed limit must stop the process
// instead of silently falling back to something looser.
function readInt(env: Env, name: string, fallback: number, min: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${name} must be a non-negative integer, got "${raw}"`);
  }
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < min) {
    throw new Error(`${name} must be an integer >= ${min}, got "${raw}"`);
  }
  return value;
}

const DEFAULT_CORS_ORIGINS = [
  "https://faucet.demos.sh",
  "http://localhost:4442",
  "http://localhost:8080",
  "http://localhost:3000",
  "http://localhost:3010",
];

export function loadLimits(env: Env = process.env): SafeguardLimits {
  const limits: SafeguardLimits = {
    timeInterval: readInt(env, "TIME_INTERVAL", 86400, 1),
    maxAmount: readInt(env, "MAX_AMOUNT", 100, 1),
    numberPerInterval: readInt(env, "NUMBER_PER_INTERVAL", 1, 1),
    maxAmountPerIp: readInt(env, "MAX_AMOUNT_PER_IP", 300, 1),
    numberPerIpPerInterval: readInt(env, "NUMBER_PER_IP_PER_INTERVAL", 3, 1),
    globalMaxAmountPerInterval: readInt(env, "GLOBAL_MAX_AMOUNT_PER_INTERVAL", 50000, 1),
  };
  // A single request is bounded by MAX_AMOUNT; a looser per-IP or global
  // cap below it would make every request fail with a confusing reason.
  if (limits.maxAmountPerIp < limits.maxAmount) {
    throw new Error("MAX_AMOUNT_PER_IP must be >= MAX_AMOUNT");
  }
  if (limits.globalMaxAmountPerInterval < limits.maxAmount) {
    throw new Error("GLOBAL_MAX_AMOUNT_PER_INTERVAL must be >= MAX_AMOUNT");
  }
  return limits;
}

export function loadConfig(env: Env = process.env): FaucetConfig {
  const corsOrigins = (env.CORS_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return {
    ...loadLimits(env),
    mnemonic: env.MNEMONIC ?? "",
    rpcUrl: env.RPC_URL ?? "",
    port: readInt(env, "PORT", 3000, 1),
    dbPath: env.FAUCET_DB_PATH?.trim() || "faucet.db",
    trustProxyHops: readInt(env, "TRUST_PROXY_HOPS", 1, 0),
    transferTimeoutMs: readInt(env, "TRANSFER_TIMEOUT_MS", 60000, 1000),
    maxPendingTransfers: readInt(env, "MAX_PENDING_TRANSFERS", 10, 1),
    corsOrigins: corsOrigins.length > 0 ? corsOrigins : DEFAULT_CORS_ORIGINS,
  };
}
