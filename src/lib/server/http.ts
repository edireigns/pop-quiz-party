import "server-only";
import { GameError } from "@/lib/game/types";
import { normalizeCode } from "./auth";
import { classifySetupError } from "./setupErrors";

export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export function errorResponse(e: unknown) {
  if (e instanceof GameError) return json({ error: e.code, message: e.message }, e.status);
  const setup = classifySetupError(e);
  if (setup) {
    console.error(`[setup] ${setup.code}: ${setup.message}\n  cause:`, e instanceof Error ? e.message : e);
    return json({ error: setup.code, message: setup.message, help: "/api/health" }, setup.status);
  }
  console.error(e);
  return json({ error: "server_error", message: "Something went wrong. Please try again." }, 500);
}

export async function handle(fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (e) {
    return errorResponse(e);
  }
}

export function codeFrom(raw: string) {
  const code = normalizeCode(raw);
  if (!code) throw new GameError("room_not_found", "That doesn't look like a room code.", 404);
  return code;
}

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > 8_000) throw new GameError("too_large", "Request too large.", 413);
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
  } catch {}
  throw new GameError("bad_json", "Bad request.", 400);
}
