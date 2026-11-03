import "server-only";
import { EventEmitter } from "node:events";

// "State changed" pings. Payloads never contain game data — clients refetch
// their own role-specific view over HTTPS, so nothing secret goes over the wire.

const g = globalThis as unknown as { __pqpBus?: EventEmitter };
export const localBus = (g.__pqpBus ??= (() => {
  const e = new EventEmitter();
  e.setMaxListeners(1000);
  return e;
})());

export function channelName(roomId: string) {
  return `room-${roomId}`;
}

export function supabaseRealtimeEnabled() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function broadcastSync(roomId: string, seq: number) {
  localBus.emit(roomId, seq);
  if (!supabaseRealtimeEnabled()) return;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ topic: channelName(roomId), event: "sync", payload: { seq } }] }),
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    // Clients also poll, so a dropped ping only delays an update by a moment.
  }
}
