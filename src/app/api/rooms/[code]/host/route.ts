import { hostView } from "@/lib/game/views";
import { hostAction } from "@/lib/server/actions";
import { assertHost, withRoom } from "@/lib/server/rooms";
import { clientIp, memoryLimit } from "@/lib/server/rateLimit";
import { codeFrom, handle, json, readBody } from "@/lib/server/http";

/** Host actions, authorised by the secret host token. */
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/host">) {
  return handle(async () => {
    const code = codeFrom((await ctx.params).code);
    memoryLimit(`host:${clientIp(req)}`, 30, 5_000);
    const body = await readBody(req);
    const token = req.headers.get("x-host-token");
    const { state, now } = await withRoom(code, (s, c, row) => {
      assertHost(token, row.hostTokenHash);
      return hostAction(s, c, body);
    });
    return json(hostView(state, now));
  });
}
