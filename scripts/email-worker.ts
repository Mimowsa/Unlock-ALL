import nextEnv from "@next/env";
import { createDatabaseClient } from "../src/server/db/factory.ts";
import { runEmailJobs } from "../src/server/email/worker.ts";
import { emailConfig } from "../src/server/email/config.ts";
nextEnv.loadEnvConfig(process.cwd());
const watch = process.argv.includes("--watch");
let stopped = false;
process.on("SIGINT", () => {
  stopped = true;
});
process.on("SIGTERM", () => {
  stopped = true;
});
if (!process.env.DIRECT_URL || !emailConfig())
  throw new Error("Configure test email delivery before starting the worker.");
const db = createDatabaseClient(process.env.DIRECT_URL);
try {
  do {
    try {
      const result = await runEmailJobs(db, { limit: 5 });
      if (!watch || result.processed) console.log(JSON.stringify(result));
    } catch {
      console.error("Email processing unavailable. Pending jobs are retained.");
      if (!watch) process.exitCode = 1;
    }
    if (watch && !stopped)
      await new Promise((resolve) => setTimeout(resolve, 10000));
  } while (watch && !stopped);
} finally {
  await db.$disconnect();
}
