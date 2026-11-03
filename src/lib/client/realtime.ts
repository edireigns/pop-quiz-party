"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

function supabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  client ??= createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { params: { eventsPerSecond: 20 } },
  });
  return client;
}

/**
 * Subscribe to "state changed" pings for a room. Uses Supabase Realtime
 * broadcast in production and falls back to Server-Sent Events locally.
 * Returns an unsubscribe function.
 */
export function subscribeRoom(
  code: string,
  channelName: string,
  onPing: (seq: number) => void,
  onStatus: (ok: boolean) => void,
): () => void {
  const sb = supabase();
  if (sb) {
    const ch = sb
      .channel(channelName, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "sync" }, (msg) => {
        const seq = Number((msg.payload as { seq?: number })?.seq ?? 0);
        onPing(seq);
      })
      .subscribe((status) => onStatus(status === "SUBSCRIBED"));
    return () => {
      void sb.removeChannel(ch);
    };
  }
  const es = new EventSource(`/api/rooms/${code}/events`);
  es.onopen = () => onStatus(true);
  es.onerror = () => onStatus(false);
  es.onmessage = (e) => {
    try {
      onPing(Number(JSON.parse(e.data).seq ?? 0));
    } catch {}
  };
  return () => es.close();
}
