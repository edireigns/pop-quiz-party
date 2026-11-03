"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeRoom } from "./realtime";

export type RoomStatus =
  | "loading"
  | "live"
  | "reconnecting"
  | "notFound"
  | "unauthorized"
  | "removed"
  | "error";

interface MinimalView {
  seq: number;
  serverNow: number;
  channel: string;
  gameNumber: number;
  phase: string;
  paused: boolean;
  round: null | { timer: { deadline: number }; ended: boolean };
  loserPick: null | { deadline: number };
  dare: null | { autoSpinAt: number; status: string };
}

export interface ApiError {
  error: string;
  message: string;
  status: number;
}

/**
 * Keeps a role-specific view of a room in sync:
 * realtime pings -> refetch, plus polling, deadline wake-ups and reconnects.
 */
export function useRoom<V extends MinimalView>(
  code: string,
  role: "tv" | "host" | "player",
  headers: Record<string, string> | null,
  opts: { pollMs?: number; minGapMs?: number } = {},
) {
  const [view, setView] = useState<V | null>(null);
  const [status, setStatus] = useState<RoomStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const viewRef = useRef<V | null>(null);
  const offsetRef = useRef(0);
  const inflight = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const failures = useRef(0);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const lastFetch = useRef(0);
  const pingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headersKey = headers ? JSON.stringify(headers) : null;

  const apply = useCallback((v: V, sentAt?: number) => {
    const cur = viewRef.current;
    if (cur && v.gameNumber === cur.gameNumber && v.seq < cur.seq) return; // stale response
    const recvAt = Date.now();
    const mid = sentAt ? (sentAt + recvAt) / 2 : recvAt;
    offsetRef.current = v.serverNow - mid;
    viewRef.current = v;
    setView(v);
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (headersKey === null) return;
    if (inflight.current) {
      again.current = true;
      return inflight.current;
    }
    const run = async () => {
      const sentAt = Date.now();
      lastFetch.current = sentAt;
      try {
        const res = await fetch(`/api/rooms/${code}/state?role=${role}`, {
          headers: JSON.parse(headersKey),
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          failures.current = 0;
          apply(data as V, sentAt);
          setStatus("live");
          setErrorMessage(null);
        } else if (res.status === 404) {
          setStatus("notFound");
          setErrorMessage(data.message ?? null);
        } else if (data.error === "removed") {
          setStatus("removed");
          setErrorMessage(data.message ?? null);
        } else if (res.status === 401 || res.status === 403) {
          setStatus("unauthorized");
          setErrorMessage(data.message ?? null);
        } else {
          throw new Error(data.message ?? `HTTP ${res.status}`);
        }
      } catch {
        failures.current += 1;
        setStatus((s) => (s === "loading" && failures.current < 2 ? s : "reconnecting"));
      }
    };
    inflight.current = run().finally(() => {
      inflight.current = null;
      if (again.current) {
        again.current = false;
        void refreshRef.current();
      }
    });
    return inflight.current;
  }, [apply, code, role, headersKey]);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  // initial load + polling (backs off while failing)
  useEffect(() => {
    if (headersKey === null) return;
    void refresh();
    const base = opts.pollMs ?? 2500;
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      const delay = failures.current ? Math.min(10_000, base * 2 ** Math.min(failures.current, 3)) : base;
      t = setTimeout(async () => {
        if (document.visibilityState === "visible" || role === "tv") await refresh();
        loop();
      }, delay);
    };
    loop();
    const onVis = () => document.visibilityState === "visible" && void refresh();
    const onOnline = () => void refresh();
    const onOffline = () => setStatus("reconnecting");
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [refresh, headersKey, opts.pollMs, role]);

  // realtime pings — throttled so a burst of guesses from 15 phones doesn't
  // turn into hundreds of refetches (everyone at a party shares one IP).
  const channel = view?.channel;
  const minGap = opts.minGapMs ?? 600;
  useEffect(() => {
    if (!channel) return;
    const onPing = () => {
      if (pingTimer.current) return;
      const wait = Math.max(0, lastFetch.current + minGap - Date.now());
      pingTimer.current = setTimeout(() => {
        pingTimer.current = null;
        void refreshRef.current();
      }, wait);
    };
    const unsub = subscribeRoom(
      code,
      channel,
      (seq) => {
        const cur = viewRef.current;
        if (!cur || seq !== cur.seq) onPing();
      },
      (ok) => ok && onPing(),
    );
    return () => {
      unsub();
      if (pingTimer.current) clearTimeout(pingTimer.current);
      pingTimer.current = null;
    };
  }, [channel, code, minGap]);

  // wake up exactly when a server deadline passes
  useEffect(() => {
    if (!view) return;
    const deadlines: number[] = [];
    if (view.phase === "round" && view.round && !view.paused && !view.round.ended) deadlines.push(view.round.timer.deadline);
    if (view.phase === "loserPick" && view.loserPick) deadlines.push(view.loserPick.deadline);
    if (view.phase === "dare" && view.dare?.status === "waiting") deadlines.push(view.dare.autoSpinAt);
    if (!deadlines.length) return;
    const serverNow = Date.now() + offsetRef.current;
    const wait = Math.max(0, Math.min(...deadlines) - serverNow) + 350;
    const t = setTimeout(() => void refresh(), wait);
    return () => clearTimeout(t);
  }, [view, refresh]);

  /** POST an action; applies the returned view. Throws ApiError on failure. */
  const act = useCallback(
    async <R = unknown>(path: "host" | "play" | "join", body: Record<string, unknown>, extraHeaders?: Record<string, string>): Promise<R> => {
      const sentAt = Date.now();
      const res = await fetch(`/api/rooms/${code}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(headersKey ? JSON.parse(headersKey) : {}), ...extraHeaders },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === "removed") setStatus("removed");
        throw { error: data.error ?? "error", message: data.message ?? "Something went wrong.", status: res.status } as ApiError;
      }
      const v = (data.view ?? data) as V;
      if (v && typeof v === "object" && "seq" in v) {
        apply(v, sentAt);
        setStatus("live");
      }
      return data as R;
    },
    [apply, code, headersKey],
  );

  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

  return { view, status, errorMessage, refresh, act, serverNow, setView: apply };
}

/** Re-render periodically; returns the current time from `clock` (client time by default). */
export function useTicker(intervalMs = 250, clock: () => number = Date.now) {
  const [now, setNow] = useState(() => clock());
  useEffect(() => {
    const t = setInterval(() => setNow(clock()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, clock]);
  return now;
}
