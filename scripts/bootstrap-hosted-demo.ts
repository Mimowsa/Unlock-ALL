import nextEnv from "@next/env";
import { hostedDatabaseUrls } from "../src/server/deployment/config.ts";
import { seedDemo } from "../prisma/seed.ts";
import { createDatabaseClient } from "../src/server/db/factory.ts";
nextEnv.loadEnvConfig(process.cwd());
let db: ReturnType<typeof createDatabaseClient> | undefined;
try {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL ||
    process.env.APP_MODE !== "demo" ||
    process.env.DEMO_SEED_ENABLED !== "true"
  )
    throw new Error();
  const { direct } = hostedDatabaseUrls(process.env);
  await seedDemo({ connectionString: direct.toString() });
  db = createDatabaseClient(direct.toString());
  await db.siteSetting.update({
    where: { id: "site" },
    data: { demoEnabled: true },
  });
  console.log(
    "Hosted demo catalogue initialized. Existing edits and assigned keys preserved. Runtime checkout flags remain unchanged.",
  );
} catch {
  console.error(
    "Hosted demo bootstrap refused or unavailable. Run locally with isolated Neon demo settings and migrations applied. No secrets logged.",
  );
  process.exitCode = 1;
} finally {
  await db?.$disconnect();
}
