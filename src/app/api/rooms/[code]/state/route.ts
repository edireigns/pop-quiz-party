import { hostView, playerView, tvView } from "@/lib/game/views";
import { assertHost, loadRoom, playerForToken } from "@/lib/server/rooms";
import { clientIp, memoryLimit } from "@/lib/server/rateLimit";
import { codeFrom, handle, json } from "@/lib/server/http";

/** Role-specific view of a room. The answer is never included before a round ends. */
export async function GET(req: Request, ctx: RouteContext<"/api/rooms/[code]/state">) {
  return handle(async () => {
    const code = codeFrom((await ctx.params).code);
    const role = new URL(req.url).searchParams.get("role");
    // Per-client key: a whole party usually shares one public IP.
    const who = (req.headers.get("x-player-token") ?? req.headers.get("x-host-token") ?? role ?? "").slice(0, 16);
    memoryLimit(`state:${clientIp(req)}:${who}`, 40, 5_000);
    memoryLimit(`state-ip:${clientIp(req)}`, 600, 5_000);
    const { state, hostTokenHash, now } = await loadRoom(code);
    if (role === "host") {
      assertHost(req.headers.get("x-host-token"), hostTokenHash);
      return json(hostView(state, now));
    }
    if (role === "player") {
      const p = playerForToken(state, req.headers.get("x-player-token"));
      return json(playerView(state, p.id, now));
    }
    return json(tvView(state, now));
  });
}
