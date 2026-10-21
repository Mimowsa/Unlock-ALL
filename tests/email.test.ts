import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { emailConfig, allowedRecipient } from "../src/server/email/config.ts";
import { emailTemplate } from "../src/server/email/templates.ts";
import { sealPayload, openPayload } from "../src/server/email/payload.ts";
import { sendResend, DeliveryFailure } from "../src/server/email/resend.ts";
const vault = {
  encryptionKey: randomBytes(32),
  fingerprintSecret: randomBytes(32),
  keyId: "test",
};
const env = {
  APP_MODE: "demo",
  EMAIL_DELIVERY: "resend-test",
  RESEND_API_KEY: "re_FAKE_KEY_FOR_TESTS_123456789",
  EMAIL_TEST_RECIPIENT: "owner@example.com",
  NEXTAUTH_URL: "http://127.0.0.1:3000",
};
for (const locale of ["FR", "EN"] as const)
  for (const kind of [
    "WELCOME",
    "ORDER_CONFIRMATION",
    "KEY_DELIVERY",
    "PASSWORD_RESET",
  ] as const)
    test(`${locale} ${kind} template has escaped content, plaintext fallback and the correct keys`, () => {
      const result = emailTemplate({
        kind,
        locale,
        name: "<script>alert(1)</script>",
        url: "https://example.com/account?one=1&two=2",
        reference: "UA-DEMO-123",
        totalCents: 4980n,
        items: [
          {
            name: "<img src=x>",
            quantity: 2,
            unitPriceCents: 2490,
            keys:
              kind === "KEY_DELIVERY" ? ["DEMO-KEY-001", "DEMO-KEY-002"] : [],
          },
        ],
      });
      assert.ok(result.html.includes(`lang="${locale.toLowerCase()}"`));
      assert.ok(!result.html.includes("<script>"));
      assert.ok(!result.html.includes("<img src=x>"));
      assert.ok(result.html.includes("&lt;script&gt;"));
      assert.ok(result.html.includes("one=1&amp;two=2"));
      assert.ok(result.text.includes("https://example.com/"));
      assert.ok(!/https?:\/\/[^"\s]+\.(png|jpg)/.test(result.html));
      if (kind === "KEY_DELIVERY") {
        assert.equal((result.text.match(/DEMO-KEY-/g) ?? []).length, 2);
      } else assert.ok(!result.text.includes("DEMO-KEY-"));
    });
test("email configuration requires an explicit demo mode and never changes the intended recipient", () => {
  const config = emailConfig(env);
  assert.ok(config);
  assert.equal(config.from, "UNLOCK-ALL <onboarding@resend.dev>");
  assert.equal(allowedRecipient(config, "owner@example.com"), true);
  assert.equal(allowedRecipient(config, "someone@example.com"), false);
  for (const changed of [
    { APP_MODE: "commercial" },
    { EMAIL_DELIVERY: "none" },
    { RESEND_API_KEY: "" },
    { EMAIL_TEST_RECIPIENT: "bad" },
    { NEXTAUTH_URL: "http://remote.example.com" },
    { NEXTAUTH_URL: "https://user:pass@example.com/" },
  ])
    assert.equal(emailConfig({ ...env, ...changed }), null);
});
test("encrypted provider payload is bound to its job and cannot be read with another key", () => {
  const payload = {
    from: "UNLOCK-ALL <onboarding@resend.dev>",
    to: ["owner@example.com"],
    subject: "Private",
    html: "DEMO-PRIVATE-KEY",
    text: "reset#private-token",
  };
  const sealed = sealPayload("job-1", payload, vault);
  assert.ok(!JSON.stringify(sealed).includes("private-token"));
  assert.deepEqual(openPayload("job-1", sealed, vault), payload);
  assert.throws(() => openPayload("job-2", sealed, vault));
  assert.throws(() =>
    openPayload("job-1", sealed, { ...vault, encryptionKey: randomBytes(32) }),
  );
});
test("Resend transport sends one frozen body and idempotency key; errors never expose provider message contents", async () => {
  const original = globalThis.fetch,
    config = emailConfig(env)!;
  const payload = {
    from: config.from,
    to: [config.testRecipient],
    subject: "Test",
    html: "<p>Test</p>",
    text: "Test",
  };
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "https://api.resend.com/emails");
      assert.equal(
        (init?.headers as Record<string, string>)["Idempotency-Key"],
        "stable-key",
      );
      assert.equal(init?.body, JSON.stringify(payload));
      return Response.json({ id: "provider-id-1" });
    };
    assert.equal(
      await sendResend(payload, "stable-key", config),
      "provider-id-1",
    );
    for (const [status, retryable] of [
      [403, false],
      [429, true],
      [409, true],
      [503, true],
    ] as const) {
      globalThis.fetch = async () =>
        Response.json({ message: "SECRET_PROVIDER_DETAIL" }, { status });
      await assert.rejects(
        sendResend(payload, "stable-key", config),
        (error) =>
          error instanceof DeliveryFailure &&
          error.retryable === retryable &&
          !error.message.includes("SECRET"),
      );
    }
    globalThis.fetch = async () => {
      throw new Error("SECRET_NETWORK_DETAIL");
    };
    await assert.rejects(
      sendResend(payload, "stable-key", config),
      (error) =>
        error instanceof DeliveryFailure &&
        error.code === "PROVIDER_NETWORK" &&
        !error.message.includes("SECRET"),
    );
  } finally {
    globalThis.fetch = original;
  }
});
