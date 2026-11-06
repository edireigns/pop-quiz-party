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
    // Votes get their own tight limit, applied before the database so rejected
    // attempts count too (a failed action rolls back the engine's own limiter).
    if (body.action === "vote") memoryLimit(`vote:${(token ?? clientIp(req)).slice(0, 24)}`, 3, 3_000);
    // Same for Who Wrote It? answers and guesses (Double Guess needs two quick taps).
    if (body.action === "writeAnswer") memoryLimit(`wwiw:${(token ?? clientIp(req)).slice(0, 24)}`, 3, 3_000);
    if (body.action === "wwiGuess") memoryLimit(`wwig:${(token ?? clientIp(req)).slice(0, 24)}`, 4, 3_000);
    if (body.action === "blitzAnswer") memoryLimit(`blitz:${(token ?? clientIp(req)).slice(0, 24)}`, 10, 3_000);
    const { state, now, result } = await withRoom(code, (s, c) => {
      const p = playerForToken(s, token);
      const r = playerAction(s, c, p.id, body);
      return { playerId: p.id, r };
    });
    const r = result.r as { correct?: boolean; attemptsLeft?: number; locked?: boolean } | undefined;
    const extra =
      body.action === "guess"
        ? { correct: r?.correct ?? null }
        : body.action === "answer"
          ? { correct: r?.correct ?? null, attemptsLeft: r?.attemptsLeft ?? null }
          : body.action === "blitzAnswer"
            ? { added: true } // never whether it was valid
            : body.action === "vote" || body.action === "writeAnswer"
            ? { locked: true } // never echo who the vote was for
            : body.action === "wwiGuess"
              ? { locked: r?.locked ?? true } // never echo who was picked, or whether it was right
              : {};
    return json({ ...extra, view: playerView(state, result.playerId, now) });
  });
}
