import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { getClientIP, ipRateKey, normalizeIp } from "./clientIp";
import { SerialQueue } from "./transferQueue";

describe("normalizeIp / ipRateKey", () => {
  test("unwraps IPv4-mapped IPv6", () => {
    expect(normalizeIp("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(ipRateKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  test("buckets IPv6 by /64", () => {
    expect(ipRateKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(ipRateKey("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64");
    expect(ipRateKey("2001:DB8:0001:0002:ffff::9")).toBe("2001:db8:1:2::/64");
    expect(ipRateKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(ipRateKey("::1")).toBe("0:0:0:0::/64");
    expect(ipRateKey("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
  });

  test("leaves IPv4 and unknown values alone", () => {
    expect(ipRateKey("198.51.100.1")).toBe("198.51.100.1");
    expect(ipRateKey("")).toBe("unknown");
  });
});

describe("getClientIP behind one trusted proxy", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = express();
    app.set("trust proxy", 1);
    app.get("/ip", (req, res) => {
      res.json({ ip: getClientIP(req) });
    });
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
  });

  const ipFor = async (headers: Record<string, string>) =>
    ((await (await fetch(`${base}/ip`, { headers })).json()) as { ip: string }).ip;

  test("uses the address the proxy appended, not a forged leftmost entry", async () => {
    expect(await ipFor({ "X-Forwarded-For": "1.2.3.4, 203.0.113.9" })).toBe("203.0.113.9");
  });

  test("single entry is the proxy-observed client", async () => {
    expect(await ipFor({ "X-Forwarded-For": "203.0.113.9" })).toBe("203.0.113.9");
  });

  test("ignores X-Real-IP", async () => {
    const ip = await ipFor({ "X-Real-IP": "1.2.3.4" });
    expect(ip).not.toBe("1.2.3.4");
    expect(ip).toBe("127.0.0.1");
  });
});

describe("SerialQueue", () => {
  test("runs one task at a time and survives a failing task", async () => {
    const q = new SerialQueue();
    let running = 0;
    let maxRunning = 0;
    const order: number[] = [];
    const task = (n: number, fail = false) => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 5));
      order.push(n);
      running--;
      if (fail) throw new Error("boom");
      return n;
    };

    const results = await Promise.allSettled([
      q.run(task(1)),
      q.run(task(2, true)),
      q.run(task(3)),
    ]);
    expect(maxRunning).toBe(1);
    expect(order).toEqual([1, 2, 3]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    expect(q.pending).toBe(0);
  });
});
