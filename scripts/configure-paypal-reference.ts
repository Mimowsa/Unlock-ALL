import nextEnv from "@next/env";
import { createHash } from "node:crypto";
import { z } from "zod";
import { sandboxCredentials } from "../src/server/paypal/config.ts";
import { paypalAPI, PayPalFailure } from "../src/server/paypal/api.ts";
import { transactionReport } from "../src/server/paypal/reporting.ts";
import { activateMerchant } from "../src/server/paypal/merchants.ts";
import { keyVaultConfig } from "../src/server/security/key-vault.ts";
import { createDatabaseClient } from "../src/server/db/factory.ts";
import { hostedDatabaseUrls } from "../src/server/deployment/config.ts";
nextEnv.loadEnvConfig(process.cwd());
let db: ReturnType<typeof createDatabaseClient> | undefined;
try {
  const hosted = process.argv.includes("--hosted-sandbox");
  const database = new URL(process.env.DIRECT_URL!);
  if (hosted) hostedDatabaseUrls(process.env);
  else if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname))
    throw new Error();
  const credentials = sandboxCredentials(),
    api = paypalAPI(credentials);
  const stamp = createHash("sha256")
    .update(credentials.clientId)
    .digest("hex")
    .slice(0, 32);
  const profile = (await api.request(
    "/v2/checkout/orders",
    "POST",
    {
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: "reference-configuration",
          amount: { currency_code: "EUR", value: "0.01" },
        },
      ],
    },
    `reference-profile-${stamp}`,
  )) as {
    purchase_units?: {
      payee?: { merchant_id?: string; email_address?: string };
    }[];
  };
  const payee = profile.purchase_units?.[0]?.payee;
  const recipient = z.email().parse(payee?.email_address).toLowerCase();
  if (!payee?.merchant_id) throw new Error();
  await transactionReport(
    api,
    payee.merchant_id,
    new Date(Date.now() - 86400000),
    new Date(),
  );
  db = createDatabaseClient(process.env.DIRECT_URL!);
  const merchant = await activateMerchant(
    db,
    credentials,
    payee.merchant_id,
    hosted ? "Maquette hébergée" : "Sandbox local",
    keyVaultConfig(),
    process.env.PAYPAL_WEBHOOK_ID,
  );
  await db.payPalMerchant.update({
    where: { id: merchant.id },
    data: { transferRecipient: recipient, reportingEnabled: true },
  });
  await db.auditLog.create({
    data: {
      action: "paypal.reference.configure",
      entityType: "PayPalMerchant",
      entityId: merchant.id,
      details: { environment: "sandbox", reportingVerified: true },
    },
  });
  console.log(
    JSON.stringify({
      referencePaymentsConfigured: true,
      recipientVerified: true,
      transactionSearchAuthorized: true,
      noPaymentCaptured: true,
    }),
  );
} catch (e) {
  console.error(
    e instanceof PayPalFailure
      ? e.code
      : "Reference setup unavailable. Check migrations, merchant profile and Sandbox settings. No credentials logged.",
  );
  process.exitCode = 1;
} finally {
  await db?.$disconnect();
}
