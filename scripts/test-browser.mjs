import nextEnv from "@next/env";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import pg from "pg";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedDemo } from "../prisma/seed.ts";
nextEnv.loadEnvConfig(process.cwd());
if (
  process.env.NODE_ENV === "production" ||
  process.env.VERCEL_ENV === "production"
)
  throw new Error("Browser tests require a development database.");
const direct = process.env.TEST_DATABASE_URL || process.env.DIRECT_URL;
if (!direct) throw new Error("TEST_DATABASE_URL or DIRECT_URL is required.");
const schema = `unlock_all_e2e_${randomBytes(6).toString("hex")}`;
const admin = new pg.Client({ connectionString: direct });
await admin.connect();
const mediaDirectory = await mkdtemp(join(tmpdir(), "unlock-all-images-e2e-"));
let child;
try {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  await admin.query(`SET search_path TO "${schema}"`);
  const folders = (await readdir("prisma/migrations", { withFileTypes: true }))
    .filter((f) => f.isDirectory())
    .map((f) => f.name)
    .sort();
  for (const folder of folders)
    await admin.query(
      await readFile(`prisma/migrations/${folder}/migration.sql`, "utf8"),
    );
  const url = new URL(direct);
  url.searchParams.set("schema", schema);
  process.env.APP_MODE = "demo";
  process.env.DEMO_SEED_ENABLED = "true";
  const vault = {
    encryptionKey: randomBytes(32),
    fingerprintSecret: randomBytes(32),
    keyId: "e2e",
  };
  await seedDemo({ connectionString: url.toString(), vault });
  await admin.query(
    `UPDATE "SiteSetting" SET "demoEnabled"=true WHERE "id"='site'`,
  );
  const code = await new Promise((resolve, reject) => {
    child = spawn(
      process.execPath,
      [
        "node_modules/@playwright/test/cli.js",
        "test",
        ...process.argv.slice(2),
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          UNLOCK_ALL_E2E: "true",
          APP_MODE: "demo",
          DEMO_CHECKOUT_ENABLED: "true",
          DATABASE_URL: url.toString(),
          DIRECT_URL: url.toString(),
          NEXTAUTH_URL: "http://127.0.0.1:3100",
          NEXTAUTH_SECRET: randomBytes(48).toString("hex"),
          AUTH_RESET_DELIVERY: "none",
          EMAIL_DELIVERY: "none",
          PAYPAL_CHECKOUT_ENABLED: "false",
          PAYPAL_CLIENT_ID: "",
          PAYPAL_CLIENT_SECRET: "",
          RESEND_API_KEY: "",
          EMAIL_TEST_RECIPIENT: "",
          PRODUCT_IMAGES_DIR: mediaDirectory,
          PRODUCT_IMAGE_STORAGE: "local",
          BLOB_READ_WRITE_TOKEN: "",
          BACKGROUND_JOBS_ENABLED: "false",
          CRON_SECRET: "",
          ACTIVATION_KEY_KEY_ID: vault.keyId,
          ACTIVATION_KEY_ENCRYPTION_KEY: vault.encryptionKey.toString("hex"),
          ACTIVATION_KEY_FINGERPRINT_SECRET:
            vault.fingerprintSecret.toString("hex"),
        },
      },
    );
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  process.exitCode = Number(code);
} finally {
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
  await rm(mediaDirectory, { recursive: true, force: true });
}
