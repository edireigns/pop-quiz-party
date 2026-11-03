import "server-only";
import { db } from "./db";
import { GameError } from "@/lib/game/types";

// Two layers:
//  1. A cheap in-memory sliding window per server instance (stops floods early).
//  2. A Postgres-backed fixed window shared by every serverless instance.
const g = globalThis as unknown as { __pqpRl?: Map<string, number[]> };
const mem: Map<string, number[]> = (g.__pqpRl ??= new Map<string, number[]>());

export function memoryLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  const list = (mem.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= limit) {
    mem.set(key, list);
    throw new GameError("rate_limited", "Too many requests — try again in a moment.", 429);
  }
  list.push(now);
  mem.set(key, list);
  if (mem.size > 5000) {
    for (const [k, v] of mem) if (!v.length || now - v[v.length - 1] > 60_000) mem.delete(k);
  }
}

export async function dbLimit(key: string, limit: number, windowSec: number) {
  const [row] = await db()`select public.hit_rate_limit(${key}, ${limit}, ${windowSec}) as ok`;
  if (!row?.ok) throw new GameError("rate_limited", "Too many requests — try again in a moment.", 429);
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "local";
}
