import nextEnv from "@next/env";
import { readFile, writeFile, chmod } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createDatabaseClient } from "../src/server/db/factory.ts";
import { sandboxCredentials } from "../src/server/paypal/config.ts";
import { paypalAPI, PayPalFailure } from "../src/server/paypal/api.ts";
import { keyVaultConfig } from "../src/server/security/key-vault.ts";
import { activateMerchant } from "../src/server/paypal/merchants.ts";
import { hostedDatabaseUrls } from "../src/server/deployment/config.ts";
nextEnv.loadEnvConfig(process.cwd());
let db: ReturnType<typeof createDatabaseClient> | undefined;
try {
  const hosted = process.argv.includes("--hosted-sandbox");
  const origin = new URL(process.env.NEXTAUTH_URL || "http://127.0.0.1:3000"),
    database = new URL(process.env.DIRECT_URL!);
  if (hosted) {
    hostedDatabaseUrls(process.env);
    if (
      origin.protocol !== "https:" ||
      origin.username ||
      origin.password ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash ||
      process.env.APP_MODE !== "demo"
    )
      throw new Error("Hosted Sandbox only");
  } else if (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL ||
    !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(database.hostname)
  )
    throw new Error("Local only");
  const credentials = sandboxCredentials(),
    api = paypalAPI(credentials),
    stamp = createHash("sha256")
      .update(credentials.clientId)
      .digest("hex")
      .slice(0, 32);
  const raw = (await api.request(
    "/v2/checkout/orders",
    "POST",
    {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: "configuration",
          amount: { currency_code: "EUR", value: "0.01" },
        },
      ],
    },
    `configuration-${stamp}`,
  )) as {
    id?: string;
    purchase_units?: { payee?: { merchant_id?: string } }[];
  };
  const merchantId = raw.purchase_units?.[0]?.payee?.merchant_id;
  if (!raw.id || !merchantId || !/^[A-Za-z0-9]{5,100}$/.test(merchantId))
    throw new Error("Merchant identity unavailable");
  db = createDatabaseClient(process.env.DIRECT_URL!);
  const account = await activateMerchant(
    db,
    credentials,
    merchantId,
    process.argv.find((a) => a.startsWith("--label="))?.slice(8) ||
      `Sandbox ${new Date().toISOString().slice(0, 10)}`,
    keyVaultConfig(),
    process.env.PAYPAL_WEBHOOK_ID,
  );
  if (!hosted) {
    let source = await readFile(".env", "utf8");
    const line = "PAYPAL_CHECKOUT_ENABLED=true";
    source = /^PAYPAL_CHECKOUT_ENABLED=.*$/m.test(source)
      ? source.replace(/^PAYPAL_CHECKOUT_ENABLED=.*$/m, line)
      : source + "\n" + line + "\n";
    await writeFile(".env", source, { mode: 0o600 });
    await chmod(".env", 0o600);
  }
  console.log(
    JSON.stringify({
      sandboxConnected: true,
      activeAccount: account.label,
      activeAccountId: account.id,
      webhookPath: `/api/paypal/webhooks/${account.id}`,
      credentialsEncrypted: true,
      webhookConfigured: !!process.env.PAYPAL_WEBHOOK_ID,
      noPaymentCaptured: true,
      ...(hosted
        ? {
            nextStep:
              "Set PAYPAL_CHECKOUT_ENABLED=true on Vercel after configuring the signed webhook, then redeploy.",
          }
        : {}),
    }),
  );
} catch (e) {
  console.error(
    e instanceof PayPalFailure
      ? e.code
      : "PayPal configuration unavailable. Check Sandbox settings, target and migrations. No credentials logged.",
  );
  process.exitCode = 1;
} finally {
  await db?.$disconnect();
}
