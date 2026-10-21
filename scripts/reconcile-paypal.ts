import nextEnv from "@next/env";
import { createDatabaseClient } from "../src/server/db/factory.ts";
import { reconcilePayPalBatch } from "../src/server/paypal/worker.ts";
import { runEmailJobs } from "../src/server/email/worker.ts";
nextEnv.loadEnvConfig(process.cwd());
if (
  process.env.PAYPAL_ENV !== "sandbox" ||
  process.env.APP_MODE !== "demo" ||
  !process.env.DIRECT_URL
)
  throw new Error("Sandbox configuration required");
const db = createDatabaseClient(process.env.DIRECT_URL),
  watch = process.argv.includes("--watch");
let stopped = false;
process.on("SIGINT", () => {
  stopped = true;
});
process.on("SIGTERM", () => {
  stopped = true;
});
try {
  do {
    try {
      const result = await reconcilePayPalBatch(db);
      if (!watch || result.processed) console.log(JSON.stringify(result));
      await runEmailJobs(db);
    } catch {
      console.error(
        "Sandbox reconciliation unavailable. Payment records are retained.",
      );
      if (!watch) process.exitCode = 1;
    }
    if (watch && !stopped) await new Promise((r) => setTimeout(r, 10000));
  } while (watch && !stopped);
} finally {
  await db.$disconnect();
}
