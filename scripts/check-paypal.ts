import nextEnv from "@next/env";
import { createHash } from "node:crypto";
import { verifyOrder } from "../src/server/paypal/verify.ts";
import { sandboxCredentials } from "../src/server/paypal/config.ts";
import { paypalAPI, PayPalFailure } from "../src/server/paypal/api.ts";
nextEnv.loadEnvConfig(process.cwd());
try {
  const api = paypalAPI(sandboxCredentials());
  const data = (await api.request(
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
    "unlock-all-sandbox-configuration-v1",
  )) as {
    id?: string;
    purchase_units?: { payee?: { merchant_id?: string } }[];
  };
  const merchantId = data.purchase_units?.[0]?.payee?.merchant_id;
  if (!merchantId) throw new Error("Merchant identity unavailable");
  const stamp = createHash("sha256")
      .update(sandboxCredentials().clientId)
      .digest("hex")
      .slice(0, 24),
    id = `integration-${stamp}`,
    origin = process.env.NEXTAUTH_URL || "http://127.0.0.1:3000";
  const checkout = verifyOrder(
    await api.request(
      "/v2/checkout/orders",
      "POST",
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: "default",
            custom_id: id,
            invoice_id: id,
            payee: { merchant_id: merchantId },
            amount: { currency_code: "EUR", value: "0.01" },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: "UNLOCK-ALL Sandbox",
              shipping_preference: "NO_SHIPPING",
              user_action: "PAY_NOW",
              return_url: new URL("/fr/compte/commandes", origin).href,
              cancel_url: new URL("/fr/panier", origin).href,
            },
          },
        },
      },
      `integration-${stamp}`,
    ),
    { id, paypalOrderId: null, amountCents: 1n, merchant: { merchantId } },
  );
  console.log(
    JSON.stringify({
      redirectCheckoutReady: !!checkout.links?.some(
        (l) => l.rel === "payer-action" || l.rel === "approve",
      ),
      sandboxConnected: !!data.id,
      merchantIdentityAvailable: !!data.purchase_units?.[0]?.payee?.merchant_id,
    }),
  );
} catch (e) {
  console.error(
    e instanceof PayPalFailure
      ? e.code
      : "PayPal Sandbox configuration unavailable. No credentials logged.",
  );
  process.exitCode = 1;
}
