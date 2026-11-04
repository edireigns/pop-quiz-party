import { db } from "@/lib/server/db";
import { clientIp, memoryLimit } from "@/lib/server/rateLimit";
import { classifySetupError } from "@/lib/server/setupErrors";
import { supabaseRealtimeEnabled } from "@/lib/server/realtime";

/**
 * Setup check: open /api/health in a browser to see what's missing.
 * Reports only yes/no for secrets — never their values.
 */
export async function GET(req: Request) {
  try {
    memoryLimit(`health:${clientIp(req)}`, 20, 60_000);
  } catch {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  const onVercel = Boolean(process.env.VERCEL);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const dbUrl = process.env.DATABASE_URL ?? "";
  let dbHost: string | null = null;
  let dbPort: string | null = null;
  try {
    const u = new URL(dbUrl);
    dbHost = u.hostname;
    dbPort = u.port || "5432";
  } catch {}

  const checks: Record<string, { ok: boolean; detail: string }> = {};
  const warnings: string[] = [];

  checks.databaseUrl = dbUrl
    ? { ok: true, detail: `set (host ${dbHost ?? "?"}, port ${dbPort ?? "?"})` }
    : { ok: false, detail: "DATABASE_URL is not set. Copy .env.example to .env.local (or add it in Vercel) and restart." };

  if (dbUrl) {
    try {
      const sql = db();
      const [row] = await sql`
        select to_regclass('public.rooms') is not null as rooms,
               to_regclass('public.rate_limits') is not null as rate_limits,
               to_regprocedure('public.hit_rate_limit(text,integer,integer)') is not null as rate_fn,
               to_regprocedure('public.cleanup_expired_rooms()') is not null as cleanup_fn,
               current_setting('server_version') as version`;
      checks.databaseConnection = { ok: true, detail: `connected (Postgres ${row.version})` };
      const migrated = row.rooms && row.rate_limits && row.rate_fn && row.cleanup_fn;
      checks.migration = migrated
        ? { ok: true, detail: "tables and functions present" }
        : { ok: false, detail: "Tables missing. Run `npm run db:migrate` or paste supabase/migrations/0001_init.sql into the Supabase SQL Editor." };
    } catch (e) {
      const p = classifySetupError(e);
      checks.databaseConnection = { ok: false, detail: p?.message ?? `failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  checks.siteUrl = siteUrl
    ? { ok: !(onVercel && /localhost|127\.0\.0\.1/.test(siteUrl)), detail: siteUrl }
    : { ok: !onVercel, detail: "not set — QR codes use the address the TV page was opened from" };
  if (onVercel && /localhost/.test(siteUrl)) warnings.push("NEXT_PUBLIC_SITE_URL points at localhost on Vercel. Set it to your public URL and redeploy.");

  const realtime = supabaseRealtimeEnabled() && Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  checks.realtime = realtime
    ? { ok: true, detail: "Supabase Realtime configured" }
    : {
        ok: !onVercel,
        detail: onVercel
          ? "Supabase keys missing — the game still works by polling every ~2.5s, but set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY for instant updates."
          : "not configured — using the built-in local live-update channel (fine for local play)",
      };

  checks.cronSecret = { ok: !onVercel || Boolean(process.env.CRON_SECRET), detail: process.env.CRON_SECRET ? "set" : "not set (needed on Vercel for the cleanup cron)" };

  if (onVercel && dbHost && /^db\.[a-z0-9]+\.supabase\.co$/.test(dbHost))
    warnings.push("DATABASE_URL uses Supabase's direct host, which is IPv6-only. Use the Transaction pooler string (…pooler.supabase.com:6543).");

  const ok = Object.values(checks).every((c) => c.ok);
  const body = { ok, environment: onVercel ? "vercel" : process.env.NODE_ENV, node: process.version, checks, warnings };
  return new Response(JSON.stringify(body, null, 2), {
    status: ok ? 200 : 503,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
