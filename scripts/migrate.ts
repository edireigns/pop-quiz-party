// Applies supabase/migrations/*.sql to DATABASE_URL (idempotent).
// Usage: npm run db:migrate
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
  const dir = path.join(process.cwd(), "supabase", "migrations");
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await sql.unsafe(fs.readFileSync(path.join(dir, file), "utf8"));
    console.log(`applied ${file}`);
  }
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
