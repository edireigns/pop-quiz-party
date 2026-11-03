import { localBus } from "@/lib/server/realtime";
import { loadRoom } from "@/lib/server/rooms";
import { codeFrom, handle } from "@/lib/server/http";

/**
 * Server-Sent Events fallback used when Supabase Realtime isn't configured
 * (local development / tests with a single server process). Emits only
 * sequence numbers — never game data.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/rooms/[code]/events">) {
  return handle(async () => {
    const code = codeFrom((await ctx.params).code);
    const { state } = await loadRoom(code);
    const roomId = state.roomId;
    const enc = new TextEncoder();
    let cleanup = () => {};
    const stream = new ReadableStream({
      start(controller) {
        const send = (seq: number) => {
          try {
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ seq })}\n\n`));
          } catch {
            cleanup();
          }
        };
        const hb = setInterval(() => {
          try {
            controller.enqueue(enc.encode(`: hb\n\n`));
          } catch {
            cleanup();
          }
        }, 15_000);
        localBus.on(roomId, send);
        cleanup = () => {
          clearInterval(hb);
          localBus.off(roomId, send);
        };
        req.signal.addEventListener("abort", () => {
          cleanup();
          try {
            controller.close();
          } catch {}
        });
        send(state.seq);
      },
      cancel() {
        cleanup();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  });
}
