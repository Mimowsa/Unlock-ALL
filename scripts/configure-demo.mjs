import nextEnv from "@next/env";
import { readFile, writeFile, chmod } from "node:fs/promises";
import { createDatabaseClient } from "../src/server/db/factory.ts";
nextEnv.loadEnvConfig(process.cwd());
let db;
try {
  const enabled = !process.argv.includes("--disable");
  if (
    process.env.APP_MODE !== "demo" ||
    process.env.VERCEL ||
    process.env.NODE_ENV === "production"
  )
    throw new Error("local-only");
  const databaseUrl = new URL(process.env.DIRECT_URL);
  const origin = new URL(process.env.NEXTAUTH_URL);
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(databaseUrl.hostname) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
  )
    throw new Error("local-only");
  const source = await readFile(".env", "utf8");
  const line = `DEMO_CHECKOUT_ENABLED=${enabled ? "true" : "false"}`;
  const next = /^DEMO_CHECKOUT_ENABLED=.*$/m.test(source)
    ? source.replace(/^DEMO_CHECKOUT_ENABLED=.*$/m, line)
    : source + "\n" + line + "\n";
  db = createDatabaseClient(process.env.DIRECT_URL);
  await db.$queryRaw`SELECT 1`;
  await writeFile(".env", next, { mode: 0o600 });
  await chmod(".env", 0o600);
  await db.$transaction(async (tx) => {
    await tx.siteSetting.upsert({
      where: { id: "site" },
      create: { id: "site", demoEnabled: enabled },
      update: { demoEnabled: enabled },
    });
    await tx.auditLog.create({
      data: {
        action: enabled ? "demo.local.enable" : "demo.local.disable",
        entityType: "SiteSetting",
        entityId: "site",
      },
    });
  });
  console.log(
    `Local demo checkout ${enabled ? "enabled" : "disabled"}. Restart the development server if needed. No real payment configured.`,
  );
} catch {
  console.error(
    "Demo configuration unavailable. This command requires a local development database and APP_MODE=demo. No configuration or secrets logged.",
  );
  process.exitCode = 1;
} finally {
  await db?.$disconnect();
}
