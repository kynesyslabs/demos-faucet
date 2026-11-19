import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLimits, type SafeguardLimits } from "./config";
import { Safeguards, validateRequest } from "./safeguards";

const LIMITS: SafeguardLimits = {
  timeInterval: 86400,
  maxAmount: 100,
  numberPerInterval: 1,
  maxAmountPerIp: 300,
  numberPerIpPerInterval: 3,
  globalMaxAmountPerInterval: 500,
};

const NOW = 1_800_000_000;
const addr = (n: number) => "0x" + n.toString(16).padStart(64, "0");

let dir: string;
let sg: Safeguards;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "faucet-safeguards-"));
  sg = new Safeguards(LIMITS, join(dir, "faucet.db"));
});

afterEach(() => {
  sg.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("validation", () => {
  test("rejects malformed addresses", () => {
    for (const bad of [undefined, 42, "", "abc", addr(1).slice(2), addr(1) + "0", "0x" + "g".repeat(64)]) {
      const r = sg.reserve(bad, 10, "1.1.1.1", NOW);
      expect(r.allowed).toBe(false);
      if (!r.allowed) expect(r.reason).toBe("invalid_address");
    }
  });

  test("rejects non-integer, non-positive, string and oversized amounts", () => {
    for (const bad of [0, -1, 1.5, "10", NaN, Infinity, null, 101]) {
      const r = sg.reserve(addr(1), bad, "1.1.1.1", NOW);
      expect(r.allowed).toBe(false);
      if (!r.allowed) expect(r.reason).toBe("invalid_amount");
    }
  });

  test("lowercases the address so case variants share one allowance", () => {
    const upper = "0x" + "AB".repeat(32);
    const v = validateRequest(upper, 1, 100);
    expect(v.ok && v.address).toBe("0x" + "ab".repeat(32));

    expect(sg.reserve(upper, 10, "1.1.1.1", NOW).allowed).toBe(true);
    const again = sg.reserve(upper.toLowerCase(), 10, "2.2.2.2", NOW);
    expect(again.allowed).toBe(false);
    if (!again.allowed) expect(again.reason).toBe("address_count");
  });
});

describe("caps", () => {
  test("per-address count cap, released after the interval", () => {
    expect(sg.reserve(addr(1), 50, "1.1.1.1", NOW).allowed).toBe(true);
    const second = sg.reserve(addr(1), 10, "2.2.2.2", NOW + 10);
    expect(second.allowed).toBe(false);
    if (!second.allowed) expect(second.reason).toBe("address_count");
    expect(sg.reserve(addr(1), 10, "2.2.2.2", NOW + LIMITS.timeInterval).allowed).toBe(true);
  });

  test("per-address amount cap", () => {
    const limits = { ...LIMITS, numberPerInterval: 5 };
    const local = new Safeguards(limits, join(dir, "amount.db"));
    expect(local.reserve(addr(1), 80, "1.1.1.1", NOW).allowed).toBe(true);
    const over = local.reserve(addr(1), 30, "2.2.2.2", NOW);
    expect(over.allowed).toBe(false);
    if (!over.allowed) expect(over.reason).toBe("address_amount");
    expect(local.reserve(addr(1), 20, "2.2.2.2", NOW).allowed).toBe(true);
    local.close();
  });

  test("per-IP count cap across different addresses", () => {
    for (let i = 1; i <= 3; i++) {
      expect(sg.reserve(addr(i), 10, "9.9.9.9", NOW).allowed).toBe(true);
    }
    const fourth = sg.reserve(addr(4), 10, "9.9.9.9", NOW);
    expect(fourth.allowed).toBe(false);
    if (!fourth.allowed) expect(fourth.reason).toBe("ip_count");
    expect(sg.reserve(addr(4), 10, "8.8.8.8", NOW).allowed).toBe(true);
  });

  test("per-IP amount cap", () => {
    const limits = { ...LIMITS, maxAmountPerIp: 150, numberPerIpPerInterval: 10 };
    const local = new Safeguards(limits, join(dir, "ip-amount.db"));
    expect(local.reserve(addr(1), 100, "9.9.9.9", NOW).allowed).toBe(true);
    const over = local.reserve(addr(2), 60, "9.9.9.9", NOW);
    expect(over.allowed).toBe(false);
    if (!over.allowed) expect(over.reason).toBe("ip_amount");
    expect(local.reserve(addr(2), 50, "9.9.9.9", NOW).allowed).toBe(true);
    local.close();
  });

  test("global amount cap across addresses and IPs", () => {
    for (let i = 1; i <= 5; i++) {
      expect(sg.reserve(addr(i), 100, `10.0.0.${i}`, NOW).allowed).toBe(true);
    }
    const over = sg.reserve(addr(6), 1, "10.0.0.6", NOW);
    expect(over.allowed).toBe(false);
    if (!over.allowed) expect(over.reason).toBe("global_amount");
    expect(sg.getGlobalStats(NOW).intervalRemaining).toBe(0);
    expect(sg.reserve(addr(6), 1, "10.0.0.6", NOW + LIMITS.timeInterval).allowed).toBe(true);
  });
});

describe("release", () => {
  test("a failed transfer gives the allowance back to address, IP and global", () => {
    const r = sg.reserve(addr(1), 100, "9.9.9.9", NOW);
    expect(r.allowed).toBe(true);
    if (!r.allowed) return;
    expect(sg.getAddressStats(addr(1), NOW).remainingRequests).toBe(0);

    sg.release(r.id);

    const stats = sg.getAddressStats(addr(1), NOW);
    expect(stats.totalRequests).toBe(0);
    expect(stats.remainingAmount).toBe(LIMITS.maxAmount);
    expect(sg.getGlobalStats(NOW).intervalAmount).toBe(0);
    expect(sg.reserve(addr(1), 100, "9.9.9.9", NOW).allowed).toBe(true);
  });
});

describe("config", () => {
  test("defaults match the beta caps and bad values stop startup", () => {
    expect(loadLimits({})).toEqual({
      timeInterval: 86400,
      maxAmount: 100,
      numberPerInterval: 1,
      maxAmountPerIp: 300,
      numberPerIpPerInterval: 3,
      globalMaxAmountPerInterval: 50000,
    });
    expect(() => loadLimits({ MAX_AMOUNT: "abc" })).toThrow();
    expect(() => loadLimits({ MAX_AMOUNT: "0" })).toThrow();
    expect(() => loadLimits({ MAX_AMOUNT: "500", MAX_AMOUNT_PER_IP: "300" })).toThrow();
  });
});
