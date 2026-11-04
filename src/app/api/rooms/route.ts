import { clientIp, dbLimit, memoryLimit } from "@/lib/server/rateLimit";
import { createRoom, cleanupExpired } from "@/lib/server/rooms";
import { handle, json } from "@/lib/server/http";

/** Create a new room. Returns the room code and the secret host token (shown once). */
export async function POST(req: Request) {
  return handle(async () => {
    const ip = clientIp(req);
    memoryLimit(`create:${ip}`, 5, 60_000);
    await dbLimit(`create:${ip}`, 60, 3600);
    const room = await createRoom();
    // Opportunistic cleanup in case the cron job isn't configured.
    if (Math.random() < 0.1) void cleanupExpired().catch(() => {});
    return json({ code: room.code, hostToken: room.hostToken }, 201);
  });
}
