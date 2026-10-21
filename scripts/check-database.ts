import nextEnv from "@next/env";
import { createDatabaseClient } from "../src/server/db/factory.ts";
nextEnv.loadEnvConfig(process.cwd());
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
const db = createDatabaseClient(process.env.DATABASE_URL);
try {
  await db.$queryRaw`SELECT 1`;
  const [products, profiles, availableKeys, assignedKeys, configuration] =
    await Promise.all([
      db.product.count(),
      db.user.count(),
      db.activationKey.count({ where: { disabledAt: null, assignment: null } }),
      db.keyAssignment.count(),
      db.siteSetting.findUnique({
        where: { id: "site" },
        select: { demoEnabled: true },
      }),
    ]);
  console.log(
    JSON.stringify(
      {
        connected: true,
        products,
        profiles,
        availableKeys,
        assignedKeys,
        serverDemoEnabled: configuration?.demoEnabled ?? false,
      },
      null,
      2,
    ),
  );
} catch {
  console.error(
    "Database check failed. Verify the connection and apply the migrations.",
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
