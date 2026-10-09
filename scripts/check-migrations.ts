/**
 * Refuses to start when the database is behind the migration files.
 *
 * Without this the first query against a new column fails deep inside a route
 * with a raw Postgres error ("column ... does not exist"), which says nothing
 * about the actual cause: you pulled code and did not migrate.
 *
 * Runs as `predev` and from the doctor. Read-only — it never migrates for you,
 * because silently changing someone's schema on `npm run dev` is worse than
 * the error it would prevent.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

type Journal = { entries: { idx: number; tag: string }[] };

const journal: Journal = JSON.parse(readFileSync(join(process.cwd(), "drizzle/meta/_journal.json"), "utf8"));
const url = process.env.DATABASE_URL;

if (!url) {
  console.error("\n  DATABASE_URL is not set. Copy .env.example to .env first.\n");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  const rows = await sql<{ count: string }[]>`
    select count(*)::text as count
    from information_schema.tables
    where table_schema = 'drizzle' and table_name = '__drizzle_migrations'
  `;
  const applied =
    rows[0]?.count === "0"
      ? 0
      : Number((await sql<{ count: string }[]>`select count(*)::text as count from drizzle.__drizzle_migrations`)[0].count);

  const pending = journal.entries.length - applied;
  if (pending > 0) {
    const names = journal.entries.slice(applied).map((e) => e.tag);
    console.error(
      [
        "",
        `  Database is ${pending} migration${pending > 1 ? "s" : ""} behind.`,
        "",
        ...names.map((n) => `    · ${n}`),
        "",
        "  Run:  npm run db:migrate",
        "",
        "  (Starting anyway would fail later with a raw Postgres error about a missing column.)",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
} catch (err) {
  // A database that is unreachable is a different problem; say so rather than
  // blocking dev with a misleading migration message.
  console.error(`\n  Could not check migrations: ${(err as Error).message}`);
  console.error("  Is Postgres running and DATABASE_URL correct?\n");
  process.exit(1);
} finally {
  await sql.end();
}
