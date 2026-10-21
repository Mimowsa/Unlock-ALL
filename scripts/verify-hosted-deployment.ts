import nextEnv from "@next/env";
import pg from "pg";
import sharp from "sharp";
import {
  deploymentIssues,
  hostedDatabaseUrls,
} from "../src/server/deployment/config.ts";
import { createDatabaseClient } from "../src/server/db/factory.ts";
import { keyVaultConfig, openKey } from "../src/server/security/key-vault.ts";
import { openMerchant } from "../src/server/paypal/crypto.ts";
import {
  storeProductImage,
  readProductImage,
  deleteProductImage,
} from "../src/server/media/product-images.ts";
import { readdir } from "node:fs/promises";
nextEnv.loadEnvConfig(process.cwd());
let raw: pg.Client | undefined,
  db: ReturnType<typeof createDatabaseClient> | undefined,
  image: string | undefined;
try {
  if (deploymentIssues().length) throw new Error();
  const { pooled } = hostedDatabaseUrls(process.env);
  raw = new pg.Client({
    connectionString: pooled.toString(),
    connectionTimeoutMillis: 15000,
  });
  await raw.connect();
  const {
    rows: [settings],
  } = await raw.query(
    "SELECT current_setting('TimeZone') AS zone, current_schemas(false) AS schemas",
  );
  if (
    !["UTC", "Etc/UTC"].includes(settings.zone) ||
    !settings.schemas.includes("public")
  )
    throw new Error();
  const expected = (await readdir("prisma/migrations", { withFileTypes: true }))
    .filter((f) => f.isDirectory())
    .map((f) => f.name);
  const { rows } = await raw.query(
    'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
  );
  if (expected.some((name) => !rows.some((r) => r.migration_name === name)))
    throw new Error();
  db = createDatabaseClient(pooled.toString());
  const vault = keyVaultConfig();
  const key = await db.activationKey.findFirst();
  if (key) openKey(key, vault);
  if (process.env.PAYPAL_CHECKOUT_ENABLED === "true") {
    const setting = await db.payPalSetting.findUnique({
      where: { id: "site" },
      include: { activeMerchant: true },
    });
    if (!setting?.activeMerchant.webhookId) throw new Error();
    openMerchant(setting.activeMerchant, vault);
  }
  const input = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#742bd9" },
  })
    .png()
    .toBuffer();
  image = await storeProductImage(input);
  if (!(await readProductImage(image.split("/").at(-1)!))?.length)
    throw new Error();
  await deleteProductImage(image);
  image = undefined;
  console.log(
    JSON.stringify({
      neonConnected: true,
      pooledClockUTC: true,
      migrationsApplied: true,
      encryptionReadable: !!key,
      privateBlobRoundTrip: true,
      webhookReceptionTested: false,
      schedulerInvocationsTested: false,
      noPaymentCaptured: true,
    }),
  );
} catch {
  console.error(
    "Hosted verification incomplete. Check configuration, migrations, pooled UTC role settings, encryption keys and private Blob access. No credentials logged.",
  );
  process.exitCode = 1;
} finally {
  if (image) await deleteProductImage(image).catch(() => {});
  await db?.$disconnect();
  await raw?.end();
}
