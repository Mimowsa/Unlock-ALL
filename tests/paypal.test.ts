import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  approvalUrl,
  decimalAmount,
  paypalEnabled,
} from "../src/server/paypal/config.ts";
import { sealMerchant, openMerchant } from "../src/server/paypal/crypto.ts";
import { verifyOrder, verifiedCapture } from "../src/server/paypal/verify.ts";
import { paypalAPI, PayPalFailure } from "../src/server/paypal/api.ts";
const vault = {
  encryptionKey: randomBytes(32),
  fingerprintSecret: randomBytes(32),
  keyId: "test",
};
test("PayPal is opt-in, Sandbox-only and amounts never use floating point", () => {
  assert.equal(
    paypalEnabled({
      APP_MODE: "demo",
      PAYPAL_ENV: "sandbox",
      PAYPAL_CHECKOUT_ENABLED: "true",
    }),
    true,
  );
  for (const env of [
    {
      APP_MODE: "commercial",
      PAYPAL_ENV: "sandbox",
      PAYPAL_CHECKOUT_ENABLED: "true",
    },
    { APP_MODE: "demo", PAYPAL_ENV: "live", PAYPAL_CHECKOUT_ENABLED: "true" },
    { APP_MODE: "demo", PAYPAL_ENV: "sandbox" },
  ])
    assert.equal(paypalEnabled(env), false);
  assert.equal(decimalAmount(1290n), "12.90");
  assert.equal(decimalAmount(1n), "0.01");
  assert.equal(decimalAmount(99999999999n), "999999999.99");
});
test("approval redirects accept only the PayPal Sandbox checkout host", () => {
  assert.equal(
    new URL(approvalUrl("https://www.sandbox.paypal.com/checkoutnow?token=abc"))
      .hostname,
    "www.sandbox.paypal.com",
  );
  for (const url of [
    "https://www.paypal.com/checkoutnow",
    "https://www.sandbox.paypal.com.attacker.invalid/checkoutnow",
    "javascript:alert(1)",
    "http://www.sandbox.paypal.com/checkoutnow",
    "https://attacker@www.sandbox.paypal.com/checkoutnow",
  ])
    assert.throws(() => approvalUrl(url));
});
test("archived merchant secrets are encrypted and bound to one account version", () => {
  const credentials = {
      clientId: "public-client-id",
      secret: "PRIVATE-PAYPAL-SECRET",
    },
    sealed = sealMerchant("one", credentials, vault),
    row = { id: "one", ...sealed };
  assert.ok(!sealed.credentialsCiphertext.includes(credentials.secret));
  assert.deepEqual(openMerchant(row, vault), credentials);
  assert.throws(() => openMerchant({ ...row, id: "other" }, vault));
  assert.throws(() =>
    openMerchant(row, { ...vault, encryptionKey: randomBytes(32) }),
  );
});
test("only a full completed capture of the exact expected order can authorize delivery", () => {
  const expected = {
      id: "local",
      amountCents: 1290n,
      paypalOrderId: "REMOTE",
      merchant: { merchantId: "MERCHANT" },
    },
    raw = {
      id: "REMOTE",
      intent: "CAPTURE",
      status: "COMPLETED",
      purchase_units: [
        {
          custom_id: "local",
          payee: { merchant_id: "MERCHANT" },
          amount: { currency_code: "EUR", value: "12.90" },
          payments: {
            captures: [
              {
                id: "CAPTURE",
                status: "COMPLETED",
                final_capture: true,
                amount: { currency_code: "EUR", value: "12.90" },
              },
            ],
          },
        },
      ],
    };
  assert.equal(
    verifiedCapture(verifyOrder(raw, expected), 1290n)?.id,
    "CAPTURE",
  );
  const altered = structuredClone(raw);
  altered.purchase_units[0].payments.captures[0].amount.value = "0.01";
  assert.throws(() => verifiedCapture(verifyOrder(altered, expected), 1290n));
  const pending = structuredClone(raw);
  pending.status = "APPROVED";
  assert.equal(verifiedCapture(verifyOrder(pending, expected), 1290n), null);
});
test("PayPal transport uses only Sandbox and stable request IDs without exposing provider details", async () => {
  const original = globalThis.fetch,
    clientId = "transport-" + randomBytes(12).toString("hex"),
    api = paypalAPI({ clientId, secret: "private-secret" });
  let calls = 0;
  try {
    globalThis.fetch = async (url, init) => {
      calls++;
      assert.ok(String(url).startsWith("https://api-m.sandbox.paypal.com/"));
      if (String(url).endsWith("/token"))
        return Response.json({
          access_token: "TOKEN-NEVER-LOGGED",
          expires_in: 300,
        });
      assert.equal(
        (init?.headers as Record<string, string>)["PayPal-Request-Id"],
        "fixed-create",
      );
      assert.equal(init?.redirect, "error");
      return Response.json({ id: "REMOTE" });
    };
    assert.deepEqual(
      await api.request(
        "/v2/checkout/orders",
        "POST",
        { intent: "CAPTURE" },
        "fixed-create",
      ),
      { id: "REMOTE" },
    );
    assert.equal(calls, 2);
    await assert.rejects(
      api.request("/v2/../../evil"),
      (e) => e instanceof PayPalFailure && e.code === "PAYPAL_PATH",
    );
    globalThis.fetch = async () =>
      Response.json(
        { details: "PRIVATE_ACCOUNT_INFORMATION" },
        { status: 422 },
      );
    await assert.rejects(
      api.request("/v2/checkout/orders", "POST", {}, "fixed-create"),
      (e) =>
        e instanceof PayPalFailure &&
        !e.message.includes("PRIVATE") &&
        !e.retryable,
    );
  } finally {
    globalThis.fetch = original;
  }
});

import {
  matchTransfer,
  transactionReport,
} from "../src/server/paypal/reporting.ts";
const expectedTransfer = {
  reference: "UA-M-" + "A".repeat(24),
  amountCents: 1290n,
  createdAt: new Date("2026-10-21T10:00:00Z"),
  payUntil: new Date("2026-10-21T10:30:00Z"),
};
function reportTransaction() {
  return {
    transaction_id: "ABC12345678901234",
    transaction_event_code: "T0000",
    transaction_status: "S",
    transaction_initiation_date: "2026-10-21T10:01:00Z",
    transaction_amount: { currency_code: "EUR", value: "12.90" },
    transaction_note: expectedTransfer.reference,
  };
}
test("reference payments require the exact note, positive gross amount, EUR and a completed general payment", () => {
  assert.equal(
    matchTransfer([reportTransaction()], expectedTransfer).kind,
    "match",
  );
  assert.equal(
    matchTransfer(
      [{ ...reportTransaction(), transaction_note: "wrong" }],
      expectedTransfer,
    ).kind,
    "missing",
  );
  for (const patch of [
    { transaction_amount: { currency_code: "EUR", value: "-12.90" } },
    { transaction_amount: { currency_code: "USD", value: "12.90" } },
    { transaction_status: "V" },
    { transaction_event_code: "T0006" },
    { transaction_initiation_date: "2026-10-21T11:00:00Z" },
  ])
    assert.equal(
      matchTransfer([{ ...reportTransaction(), ...patch }], expectedTransfer)
        .kind,
      "review",
    );
  assert.equal(
    matchTransfer(
      [{ ...reportTransaction(), transaction_status: "P" }],
      expectedTransfer,
    ).kind,
    "pending",
  );
});
test("multiple payments and conflicting duplicate rows require review", () => {
  const t = reportTransaction();
  assert.equal(matchTransfer([t, t], expectedTransfer).kind, "match");
  assert.equal(
    matchTransfer(
      [t, { ...t, transaction_id: "OTHER1234567890123" }],
      expectedTransfer,
    ).kind,
    "review",
  );
  assert.equal(
    matchTransfer([t, { ...t, transaction_status: "P" }], expectedTransfer)
      .kind,
    "review",
  );
});
test("reporting reads every page from the original authenticated merchant before returning evidence", async () => {
  let calls = 0;
  const api = {
    async request(
      path: string,
      _method?: string,
      _body?: unknown,
      _id?: string,
      query?: Readonly<Record<string, string>>,
    ) {
      calls++;
      assert.equal(path, "/v1/reporting/transactions");
      assert.equal(query?.page, String(calls));
      return {
        account_number: "MERCHANT",
        last_refreshed_datetime: "2026-10-21T11:00:00Z",
        page: calls,
        total_pages: 2,
        total_items: 2,
        transaction_details: [
          {
            transaction_info: {
              ...reportTransaction(),
              transaction_id: "TX" + calls,
            },
          },
        ],
      };
    },
  };
  const r = await transactionReport(
    api,
    "MERCHANT",
    expectedTransfer.createdAt,
    new Date("2026-10-21T11:00:00Z"),
  );
  assert.equal(calls, 2);
  assert.equal(r.transactions.length, 2);
});
for (const fault of ["account", "pagination", "count"])
  test(`reporting rejects invalid ${fault} instead of authorizing delivery`, async () => {
    const api = {
      async request() {
        return {
          account_number: fault === "account" ? "FOREIGN" : "MERCHANT",
          last_refreshed_datetime: "2026-10-21T11:00:00Z",
          page: 1,
          total_pages: fault === "pagination" ? 10 : 1,
          total_items: fault === "count" ? 2 : 1,
          transaction_details: [{ transaction_info: reportTransaction() }],
        };
      },
    };
    await assert.rejects(
      transactionReport(
        api,
        "MERCHANT",
        expectedTransfer.createdAt,
        new Date("2026-10-21T11:00:00Z"),
      ),
    );
  });
