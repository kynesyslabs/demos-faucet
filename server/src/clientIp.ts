import { isIPv4, isIPv6 } from "node:net";
import type { Request } from "express";

/**
 * The client address as Express resolved it under the app's `trust proxy`
 * hop count. X-Forwarded-For is never read directly here: its leftmost entry
 * is whatever the client sent, so trusting it would let anyone pick the IP
 * the per-IP caps are counted against.
 */
export function getClientIP(req: Request): string {
  const raw = req.ip || req.socket?.remoteAddress || "";
  return normalizeIp(raw);
}

/** Key the per-IP caps and abuse counters are bucketed by. */
export function clientRateKey(req: Request): string {
  return ipRateKey(getClientIP(req));
}

export function normalizeIp(ip: string): string {
  const value = ip.trim();
  if (value === "") return "unknown";
  // Dual-stack sockets report IPv4 peers as ::ffff:a.b.c.d; without this the
  // same client would be counted under two different keys.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(value);
  if (mapped && isIPv4(mapped[1])) return mapped[1];
  return value;
}

/**
 * IPv6 hosts usually get a whole /64, so counting single IPv6 addresses would
 * let one client rotate through 2^64 identities; IPv6 is bucketed by /64.
 */
export function ipRateKey(ip: string): string {
  const value = normalizeIp(ip);
  if (isIPv4(value)) return value;
  const noZone = value.split("%")[0];
  if (!isIPv6(noZone)) return value;
  return `${ipv6Groups(noZone).slice(0, 4).join(":")}::/64`;
}

function ipv6Groups(ip: string): string[] {
  let s = ip.toLowerCase();
  // An embedded IPv4 tail only covers the last 32 bits; replace it with two
  // placeholder groups so the group count stays 8.
  if (s.includes(".")) {
    s = s.slice(0, s.lastIndexOf(":") + 1) + "0:0";
  }
  let groups: string[];
  if (s.includes("::")) {
    const [head, tail] = s.split("::");
    const headParts = head ? head.split(":") : [];
    const tailParts = tail ? tail.split(":") : [];
    const fill = 8 - headParts.length - tailParts.length;
    groups = [...headParts, ...Array<string>(fill).fill("0"), ...tailParts];
  } else {
    groups = s.split(":");
  }
  return groups.map((g) => parseInt(g, 16).toString(16));
}
