import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function tokenMatches(token: string | null | undefined, hash: string): boolean {
  if (!token || typeof token !== "string" || token.length > 200) return false;
  const a = Buffer.from(hashToken(token), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

// Room codes: 5 letters, no I/O to avoid confusion with 1/0.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export function newRoomCode(): string {
  const bytes = randomBytes(5);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export function normalizeCode(raw: string): string | null {
  const code = String(raw ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  return /^[A-Z]{5}$/.test(code) ? code : null;
}
