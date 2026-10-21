import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.ts";

export function createDatabaseClient(connectionString: string) {
  const url = new URL(connectionString);
  if (!["postgresql:", "postgres:"].includes(url.protocol))
    throw new Error("A PostgreSQL DATABASE_URL is required.");
  const schema = url.searchParams.get("schema") ?? "public";
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(schema))
    throw new Error("Invalid PostgreSQL schema name.");
  url.searchParams.delete("schema");
  // The adapter serializes UTC timestamps without an offset. A UTC session
  // keeps Prisma timestamps and SQL now() on the same absolute clock.
  const neonPool =
    url.hostname.endsWith(".neon.tech") &&
    url.hostname.split(".")[0].endsWith("-pooler");
  if (neonPool) {
    if (schema !== "public" || url.searchParams.has("options"))
      throw new Error(
        "Neon transaction pooling requires public schema and role-level UTC settings.",
      );
    // Pooled connections cannot rely on per-session settings. The deployment
    // preparation command sets UTC/search_path on the database role instead.
  } else
    url.searchParams.set("options", `-c search_path=${schema} -c timezone=UTC`);
  const adapter = new PrismaPg(
    {
      connectionString: url.toString(),
      max: 5,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
    },
    { schema },
  );
  return new PrismaClient({ adapter });
}
