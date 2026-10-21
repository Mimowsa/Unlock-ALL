import "server-only";
import { createDatabaseClient } from "./factory";

const globalDatabase = globalThis as unknown as {
  unlockAllDatabase?: ReturnType<typeof createDatabaseClient>;
};
export function getDatabase() {
  if (globalDatabase.unlockAllDatabase) return globalDatabase.unlockAllDatabase;
  const url = process.env.DATABASE_URL;
  if (!url)
    throw new Error("DATABASE_URL is required for database operations.");
  const client = createDatabaseClient(url);
  globalDatabase.unlockAllDatabase = client;
  return client;
}
