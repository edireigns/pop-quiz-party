import { playerView } from "@/lib/game/views";
import { playerAction } from "@/lib/server/actions";
import { playerForToken, withRoom } from "@/lib/server/rooms";
import { clientIp, memoryLimit } from "@/lib/server/rateLimit";
import { codeFrom, handle, json, readBody } from "@/lib/server/http";

/** Player actions (guess, hint, power-ups, reactions...), authorised by the player token. */
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/play">) {
  return handle(async () => {
    const code = codeFrom((await ctx.params).code);
    const token = req.headers.get("x-player-token");
    memoryLimit(`play:${clientIp(req)}:${(token ?? "").slice(0, 12)}`, 25, 2_000);
    const body = await readBody(req);
    const { state, now, result } = await withRoom(code, (s, c) => {
      const p = playerForToken(s, token);
      const r = playerAction(s, c, p.id, body);
      return { playerId: p.id, r };
    });
    const extra = body.action === "guess" ? { correct: (result.r as { correct?: boolean } | undefined)?.correct ?? null } : {};
    return json({ ...extra, view: playerView(state, result.playerId, now) });
  });
}
