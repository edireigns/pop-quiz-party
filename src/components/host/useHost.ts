"use client";

import { useEffect, useState } from "react";
import type { HostView } from "@/lib/game/views";
import { resolveHostToken } from "@/lib/client/storage";
import { useRoom, type ApiError } from "@/lib/client/useRoom";

export function useHost(code: string) {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    // Token comes from the URL fragment (never sent to the server in URLs) or storage.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading browser-only state after mount
    setToken(resolveHostToken(code));
  }, [code]);
  const headers = token ? { "x-host-token": token } : null;
  const room = useRoom<HostView>(code, "host", headers, { pollMs: 2000, minGapMs: 900 });
  const [toast, setToast] = useState<{ msg: string; tone: "info" | "error" } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  async function run(body: Record<string, unknown>, success?: string) {
    try {
      await room.act("host", body);
      if (success) setToast({ msg: success, tone: "info" });
      return true;
    } catch (e) {
      setToast({ msg: (e as ApiError).message, tone: "error" });
      return false;
    }
  }

  return { ...room, token, run, toast };
}
