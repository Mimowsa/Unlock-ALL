import nextEnv from "@next/env";
import pg from "pg";
import { hostedDatabaseUrls } from "../src/server/deployment/config.ts";
nextEnv.loadEnvConfig(process.cwd());
let db: pg.Client | undefined;
try {
  if (process.env.APP_MODE !== "demo") throw new Error();
  const { direct } = hostedDatabaseUrls(process.env);
  db = new pg.Client({
    connectionString: direct.toString(),
    connectionTimeoutMillis: 15000,
  });
  await db.connect();
  const {
    rows: [row],
  } = await db.query<{ role: string; database: string }>(
    "SELECT current_user AS role, current_database() AS database",
  );
  const quote = (v: string) => '"' + v.replaceAll('"', '""') + '"';
  await db.query(
    `ALTER ROLE ${quote(row.role)} IN DATABASE ${quote(row.database)} SET timezone TO 'UTC'`,
  );
  await db.query(
    `ALTER ROLE ${quote(row.role)} IN DATABASE ${quote(row.database)} SET search_path TO public`,
  );
  console.log(
    "Hosted demo role prepared. Reconnect/restart compute to discard old pooled sessions. No migrations or seed executed.",
  );
} catch {
  console.error(
    "Hosted database preparation refused or unavailable. Check isolated Neon demo settings; no credentials logged.",
  );
  process.exitCode = 1;
} finally {
  await db?.end();
}
