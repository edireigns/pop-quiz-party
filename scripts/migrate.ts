// Applies supabase/migrations/*.sql to DATABASE_URL (idempotent).
// Usage: npm run db:migrate
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { loadEnv } from "./env";

loadEnv();

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url) || /sslmode=/.test(url);
  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {}, ...(local ? {} : { ssl: "require" as const }) });
  console.log(`Migrating ${url.replace(/:\/\/([^:@/]+)(:[^@]*)?@/, "://$1:***@")}`);
  const dir = path.join(process.cwd(), "supabase", "migrations");
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await sql.unsafe(fs.readFileSync(path.join(dir, file), "utf8"));
    console.log(`applied ${file}`);
  }
  await sql.end();
}

main().catch((e) => {
  const code = (e as { code?: string }).code;
  const hints: Record<string, string> = {
    ECONNREFUSED: "Nothing is listening at that address — is Postgres running?",
    ENOTFOUND: "Host not found — check the host name. For Supabase use the Transaction pooler string.",
    "28P01": "Wrong password in DATABASE_URL.",
    "3D000": "That database doesn't exist yet — create it first (e.g. `createdb popquiz`).",
  };
  console.error(`Migration failed: ${(e as Error).message}${code && hints[code] ? `\n→ ${hints[code]}` : ""}`);
  process.exit(1);
});
