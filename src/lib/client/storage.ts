"use client";

// Small, failure-tolerant wrappers around localStorage (private mode etc.).
function get(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function set(key: string, value: string | null) {
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {}
}

export const hostTokenKey = (code: string) => `pqp:host:${code}`;
export const playerTokenKey = (code: string) => `pqp:player:${code}`;

export function getHostToken(code: string) {
  return get(hostTokenKey(code));
}
export function setHostToken(code: string, token: string) {
  set(hostTokenKey(code), token);
}
export function getPlayerToken(code: string) {
  return get(playerTokenKey(code));
}
export function setPlayerToken(code: string, token: string | null) {
  set(playerTokenKey(code), token);
}
export function getPref(key: string) {
  return get(`pqp:pref:${key}`);
}
export function setPref(key: string, value: string) {
  set(`pqp:pref:${key}`, value);
}

/** Read the host token from the URL fragment (#k=...) or storage. */
export function resolveHostToken(code: string): string | null {
  const hash = typeof window !== "undefined" ? window.location.hash : "";
  const m = /[#&]k=([A-Za-z0-9_-]{20,})/.exec(hash);
  if (m) {
    setHostToken(code, m[1]);
    return m[1];
  }
  return getHostToken(code);
}

/**
 * Public base URL for QR codes and join links. Uses NEXT_PUBLIC_SITE_URL, except
 * when that points at localhost — phones can't reach "localhost", so we use the
 * address this page was actually opened from (e.g. http://192.168.1.20:3000).
 */
export function siteUrl(): string {
  const env = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  const here = typeof window !== "undefined" ? window.location.origin : "";
  if (env && !/^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(env)) return env;
  return here || env;
}
