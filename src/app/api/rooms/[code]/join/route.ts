import { addPlayer } from "@/lib/game/engine";
import { playerView } from "@/lib/game/views";
import { GameError } from "@/lib/game/types";
import { validateNickname } from "@/lib/moderation";
import { hashToken, newToken } from "@/lib/server/auth";
import { clientIp, dbLimit, memoryLimit } from "@/lib/server/rateLimit";
import { withRoom } from "@/lib/server/rooms";
import { codeFrom, handle, json, readBody } from "@/lib/server/http";

/**
 * Join a room with a nickname. If the caller already holds a valid player
 * token for this room, they are reconnected instead (score and progress kept).
 */
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/join">) {
  return handle(async () => {
    const code = codeFrom((await ctx.params).code);
    const ip = clientIp(req);
    memoryLimit(`join:${ip}`, 40, 60_000);
    const body = await readBody(req);
    const existing = req.headers.get("x-player-token");
    if (existing) {
      const h = hashToken(existing);
      const { state, now, result } = await withRoom(code, (s) => s.players.find((p) => p.tokenHash === h && !p.removed) ?? null);
      if (result) return json({ token: existing, view: playerView(state, result.id, now) });
    }
    await dbLimit(`join:${ip}`, 60, 600);
    await dbLimit(`join-room:${code}`, 100, 600);
    const token = newToken();
    const { state, result, now } = await withRoom(code, (s, c) => {
      const nick = validateNickname(body.nickname, s.settings.content);
      if (!nick.ok) throw new GameError("bad_nickname", nick.error);
      return addPlayer(s, { nickname: nick.value, tokenHash: hashToken(token) }, c);
    });
    return json({ token, view: playerView(state, result.id, now) }, 201);
  });
}
