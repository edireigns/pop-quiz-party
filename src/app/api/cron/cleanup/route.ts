import { cleanupExpired } from "@/lib/server/rooms";
import { handle, json } from "@/lib/server/http";
import { timingSafeEqual } from "node:crypto";

/** Called daily by Vercel Cron (see vercel.json). Deletes rooms 24h after their game ended. */
export async function GET(req: Request) {
  return handle(async () => {
    const secret = process.env.CRON_SECRET ?? "";
    const got = Buffer.from(req.headers.get("authorization") ?? "");
    const want = Buffer.from(`Bearer ${secret}`);
    if (!secret || got.length !== want.length || !timingSafeEqual(got, want)) {
      return json({ error: "unauthorized" }, 401);
    }
    const deleted = await cleanupExpired();
    return json({ deleted });
  });
}
