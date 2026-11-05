import "server-only";
import { db } from "./db";
import { hashToken, newRoomCode, newToken, tokenMatches } from "./auth";
import { broadcastSync } from "./realtime";
import { createGame, tick, upgradeState } from "@/lib/game/engine";
import { serverCtx } from "@/lib/game/ctx";
import { type Ctx, GameError, type GameState } from "@/lib/game/types";

interface RoomRow {
  id: string;
  code: string;
  host_token_hash: string;
  state: GameState;
}

export async function createRoom(): Promise<{ code: string; hostToken: string; roomId: string }> {
  const hostToken = newToken();
  const sql = db();
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = newRoomCode();
    const roomId = crypto.randomUUID();
    const state = createGame({ roomId, code, now: Date.now() });
    const rows = await sql`
      insert into public.rooms (id, code, host_token_hash, state, phase)
      values (${roomId}, ${code}, ${hashToken(hostToken)}, ${sql.json(state as never)}, 'lobby')
      on conflict (code) do nothing
      returning id`;
    if (rows.length) return { code, hostToken, roomId };
  }
  throw new GameError("busy", "Couldn't create a room. Try again.", 503);
}

// Rooms count as deleted 24h after their game ended, even before the cleanup job runs.
async function readRoom(code: string): Promise<RoomRow> {
  const rows = await db()<RoomRow[]>`select id, code, host_token_hash, state from public.rooms where code = ${code} and (ended_at is null or ended_at > now() - interval '24 hours')`;
  if (!rows.length) throw new GameError("room_not_found", "We couldn't find that room code.", 404);
  return rows[0];
}

/**
 * Run `fn` against the room's state inside a row lock, persist, then ping
 * subscribers. Time-based transitions (timer expiry etc.) are applied first.
 */
export async function withRoom<T>(
  code: string,
  fn: (state: GameState, ctx: Ctx, row: { id: string; hostTokenHash: string }) => T,
): Promise<{ state: GameState; result: T; now: number }> {
  const sql = db();
  let seqBefore = 0;
  const out = await sql.begin(async (tx) => {
    const rows = await tx<RoomRow[]>`
      select id, code, host_token_hash, state from public.rooms where code = ${code} and (ended_at is null or ended_at > now() - interval '24 hours') for update`;
    if (!rows.length) throw new GameError("room_not_found", "We couldn't find that room code.", 404);
    const row = rows[0];
    const state = upgradeState(row.state);
    seqBefore = state.seq;
    const ctx = serverCtx();
    tick(state, ctx);
    const result = fn(state, ctx, { id: row.id, hostTokenHash: row.host_token_hash });
    if (state.seq !== seqBefore) {
      await tx`
        update public.rooms
        set state = ${tx.json(state as never)},
            phase = ${state.phase},
            updated_at = now(),
            ended_at = ${state.endedAt ? new Date(state.endedAt) : null}
        where id = ${row.id}`;
    }
    return { state, result, now: ctx.now };
  });
  if (out.state.seq !== seqBefore) await broadcastSync(out.state.roomId, out.state.seq);
  return out;
}

/** Read the state, applying any due time-based transitions. */
export async function loadRoom(code: string): Promise<{ state: GameState; hostTokenHash: string; now: number }> {
  const row = await readRoom(code);
  row.state = upgradeState(row.state);
  const probe = structuredClone(row.state);
  const ctx = serverCtx();
  if (tick(probe, ctx)) {
    const { state, now } = await withRoom(code, () => null);
    return { state, hostTokenHash: row.host_token_hash, now };
  }
  return { state: row.state, hostTokenHash: row.host_token_hash, now: ctx.now };
}

export function assertHost(token: string | null, hostTokenHash: string) {
  if (!tokenMatches(token, hostTokenHash))
    throw new GameError("bad_host_token", "This host link is invalid. Use the private host link you saved.", 403);
}

/** Find the player for a token, or throw. */
export function playerForToken(state: GameState, token: string | null) {
  if (!token) throw new GameError("not_joined", "Join the game first.", 401);
  const h = hashToken(token);
  const p = state.players.find((x) => x.tokenHash === h);
  if (!p) throw new GameError("not_joined", "Join the game first.", 401);
  if (p.removed) throw new GameError("removed", "The host removed you from this game.", 403);
  return p;
}

export async function cleanupExpired(): Promise<number> {
  const [row] = await db()`select public.cleanup_expired_rooms() as n`;
  return Number(row?.n ?? 0);
}
