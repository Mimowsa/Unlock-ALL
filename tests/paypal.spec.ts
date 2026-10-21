import { expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { test, loginProfile, browserDatabase, origin } from "./browser-helpers";
import { activateMerchant } from "../src/server/paypal/merchants.ts";
import {
  preparePayPalCheckout,
  reconcilePayPal,
} from "../src/server/paypal/service.ts";
import { keyVaultConfig, sealKey } from "../src/server/security/key-vault.ts";
import type { PayPalAPI } from "../src/server/paypal/api.ts";
async function setup(page: import("@playwright/test").Page) {
  const email = await loginProfile(page),
    db = browserDatabase(),
    user = await db.user.findUniqueOrThrow({ where: { email } }),
    base = await db.product.findUniqueOrThrow({ where: { slug: "unlock-pc" } }),
    slug = `paypal-${randomUUID()}`;
  const product = await db.product.create({
    data: {
      slug,
      priceCents: 1290,
      isDemo: true,
      status: "PUBLISHED",
      categoryId: base.categoryId,
      platformId: base.platformId,
      gameId: base.gameId,
      downloadUrl: "/downloads/demo/unlock-all-demo.txt",
      translations: {
        create: [
          {
            locale: "FR",
            slug,
            name: "Pack PayPal Sandbox",
            description: "Démo",
            shortDescription: "Démo",
          },
          {
            locale: "EN",
            slug,
            name: "PayPal Sandbox pack",
            description: "Demo",
            shortDescription: "Demo",
          },
        ],
      },
    },
  });
  const vault = keyVaultConfig();
  for (let i = 0; i < 2; i++)
    await db.activationKey.create({
      data: {
        productId: product.id,
        ...sealKey(`DEMO-PAYPAL-${randomUUID()}`, vault),
      },
    });
  const merchant = await activateMerchant(
    db,
    {
      clientId: "test-client-" + randomUUID(),
      secret: "test-secret-" + randomUUID(),
    },
    "TESTMERCHANT",
    "Sandbox browser account",
    vault,
  );
  let remote: any;
  let captured = 0;
  let checkoutId = "";
  const api = (): PayPalAPI => ({
    async request(path, method = "GET", body: any) {
      if (method === "POST" && path === "/v2/checkout/orders") {
        checkoutId = body.purchase_units[0].custom_id;
        remote = {
          id: "PP" + randomUUID().replaceAll("-", ""),
          intent: "CAPTURE",
          status: "CREATED",
          purchase_units: body.purchase_units,
          links: [
            {
              rel: "payer-action",
              href: "https://www.sandbox.paypal.com/checkoutnow?token=TEST",
            },
          ],
        };
      } else if (path.endsWith("/capture")) {
        captured++;
        remote.status = "COMPLETED";
        remote.purchase_units[0].payments = {
          captures: [
            {
              id: "CAP" + randomUUID().replaceAll("-", ""),
              status: "COMPLETED",
              final_capture: true,
              amount: { ...remote.purchase_units[0].amount },
            },
          ],
        };
        return { id: remote.id, status: "COMPLETED" };
      } else if (path.includes("/payments/captures/"))
        return { ...remote.purchase_units[0].payments.captures[0] };
      return structuredClone(remote);
    },
  });
  const options = {
    env: {
      ...process.env,
      APP_MODE: "demo",
      PAYPAL_ENV: "sandbox",
      PAYPAL_CHECKOUT_ENABLED: "true",
      EMAIL_DELIVERY: "none",
    },
    vault,
    api,
  };
  await page.request.post("/api/cart", {
    headers: { Origin: origin },
    data: { operation: "add", productId: product.id, quantity: 1 },
  });
  return {
    db,
    user,
    product,
    merchant,
    options,
    approve() {
      remote.status = "APPROVED";
    },
    get captured() {
      return captured;
    },
    get checkoutId() {
      return checkoutId;
    },
  };
}

test("PayPal endpoints reject guests, forged prices, foreign owners and unsigned callbacks", async ({
  page,
  browser,
}) => {
  expect(
    (
      await page.request.post("/api/paypal/checkouts", {
        headers: { Origin: origin },
        data: {},
      })
    ).status(),
  ).toBe(401);
  const f = await setup(page);
  try {
    const cart = await (await page.request.get("/api/cart")).json(),
      input = {
        idempotencyKey: randomUUID(),
        cartRevision: cart.revision,
        cartFingerprint: cart.fingerprint,
        discord: "paypal.demo",
        locale: "FR",
        consent: true,
      };
    expect(
      (
        await page.request.post("/api/paypal/checkouts", {
          headers: { Origin: "https://external.invalid" },
          data: input,
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await page.request.post("/api/paypal/checkouts", {
          headers: { Origin: origin },
          data: { ...input, amount: 1 },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await page.request.post("/api/paypal/checkouts", {
          headers: { Origin: origin },
          data: input,
        })
      ).status(),
    ).toBe(403);
    const payment = await preparePayPalCheckout(
      f.db,
      f.user.id,
      input,
      f.options,
    );
    const own = await page.request.get(`/api/paypal/checkouts/${payment.id}`);
    expect(own.ok()).toBe(true);
    expect(own.headers()["cache-control"]).toContain("no-store");
    expect(JSON.stringify(await own.json())).not.toMatch(
      /clientId|secret|credentialsCiphertext|snapshot/,
    );
    const context = await browser.newContext(),
      other = await context.newPage();
    try {
      await loginProfile(other);
      expect(
        (
          await other.request.get(`/api/paypal/checkouts/${payment.id}`)
        ).status(),
      ).toBe(404);
      expect(
        (
          await other.request.post("/api/admin/paypal", {
            headers: { Origin: origin },
            data: { id: payment.id },
          })
        ).status(),
      ).toBe(403);
    } finally {
      await context.close();
    }
    expect(
      (
        await page.request.post(`/api/paypal/webhooks/${f.merchant.id}`, {
          data: {},
        })
      ).status(),
    ).toBe(503);
    expect(f.captured).toBe(0);
  } finally {
    await f.db.$disconnect();
  }
});

test("reference instructions replace approval redirects and one reported payment delivers keys exactly once", async ({
  page,
}) => {
  const f = await setup(page);
  let paid = false,
    checkoutId = "";
  try {
    await f.db.payPalMerchant.update({
      where: { id: f.merchant.id },
      data: {
        transferRecipient: "merchant-sandbox@example.test",
        reportingEnabled: true,
      },
    });
    const options = {
      ...f.options,
      flow: "REFERENCE" as const,
      api: (): PayPalAPI => ({
        async request(path) {
          expect(path).toBe("/v1/reporting/transactions");
          const row = await f.db.payPalCheckout.findUniqueOrThrow({
            where: { id: checkoutId },
          });
          return {
            account_number: "TESTMERCHANT",
            last_refreshed_datetime: new Date().toISOString(),
            page: 1,
            total_pages: 1,
            total_items: paid ? 1 : 0,
            transaction_details: paid
              ? [
                  {
                    transaction_info: {
                      transaction_id: "TX12345678901234567",
                      transaction_event_code: "T0000",
                      transaction_status: "S",
                      transaction_initiation_date: row.createdAt.toISOString(),
                      transaction_amount: {
                        currency_code: "EUR",
                        value: "12.90",
                      },
                      transaction_note: row.transferReference,
                    },
                  },
                ]
              : [],
          };
        },
      }),
    };
    await page.route("**/api/paypal/config", (route) =>
      route.fulfill({
        json: { enabled: true, method: "REFERENCE", environment: "sandbox" },
      }),
    );
    await page.route("**/api/paypal/checkouts", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const checkout = await preparePayPalCheckout(
        f.db,
        f.user.id,
        route.request().postDataJSON(),
        options,
      );
      checkoutId = checkout.id;
      await route.fulfill({ json: { checkout } });
    });
    await page.route("**/api/paypal/checkouts/*", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await route.fulfill({
        json: {
          checkout: await reconcilePayPal(f.db, f.user.id, checkoutId, options),
        },
      });
    });
    await page.goto("/fr/commande");
    await page
      .getByRole("textbox", { name: "Nom d’utilisateur Discord" })
      .fill("paypal.demo");
    await page.getByRole("checkbox").check();
    await page
      .getByRole("button", {
        name: "Payer par référence · Sandbox",
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(/\/fr\/commande\/paypal\//);
    await expect(
      page.getByRole("heading", { name: "Envoyer votre paiement de test" }),
    ).toBeVisible();
    await expect(
      page.getByText("merchant-sandbox@example.test", { exact: true }),
    ).toBeVisible();
    await expect(page.locator("code")).toHaveText(/^UA-M-[A-F0-9]{24}$/);
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await page.setViewportSize({ width: 320, height: 900 });
    await page.locator("code").scrollIntoViewIfNeeded();
    await expect(page.locator("code")).toBeInViewport();
    await page.screenshot({
      path: "/private/tmp/unlock-paypal-reference-mobile.png",
    });
    expect(
      await f.db.keyAssignment.count({ where: { productId: f.product.id } }),
    ).toBe(0);
    expect(await f.db.keyReservation.count({ where: { checkoutId } })).toBe(1);
    expect(
      await f.db.order.count({ where: { paypalCheckoutId: checkoutId } }),
    ).toBe(0);
    paid = true;
    await f.db.payPalCheckout.update({
      where: { id: checkoutId },
      data: { lastCheckedAt: null },
    });
    await page
      .getByRole("button", { name: "Vérifier le paiement de test" })
      .click();
    await expect(page).toHaveURL(/\/fr\/confirmation\//);
    await expect(page.locator(".key-row")).toHaveCount(1);
    await page.reload();
    await expect(page.locator(".key-row")).toHaveCount(1);
    expect(
      await f.db.order.count({ where: { paypalCheckoutId: checkoutId } }),
    ).toBe(1);
    expect(f.captured).toBe(0);
  } finally {
    await f.db.$disconnect();
  }
});

test("pending Sandbox attempts can be resumed and administrators see account references without secrets", async ({
  page,
  browser,
}) => {
  const f = await setup(page);
  try {
    const cart = await (await page.request.get("/api/cart")).json();
    const payment = await preparePayPalCheckout(
      f.db,
      f.user.id,
      {
        idempotencyKey: randomUUID(),
        cartRevision: cart.revision,
        cartFingerprint: cart.fingerprint,
        discord: "paypal.demo",
        locale: "FR",
        consent: true,
      },
      f.options,
    );
    await page.goto("/fr/compte/commandes");
    await expect(
      page.getByRole("link", { name: /Voir les instructions de paiement/ }),
    ).toBeVisible();
    const context = await browser.newContext(),
      admin = await context.newPage();
    try {
      await loginProfile(admin, true);
      const response = await admin.request.get("/api/admin/paypal");
      expect(response.ok()).toBe(true);
      const body = await response.json();
      expect(JSON.stringify(body)).not.toMatch(
        /credentialsCiphertext|clientId|test-secret/,
      );
      expect(body.payments.some((p: any) => p.id === payment.id)).toBe(true);
      await admin.goto("/fr/admin/paiements");
      await expect(
        admin.getByRole("heading", { name: "Paiements PayPal", exact: true }),
      ).toBeVisible();
      await expect(
        admin.getByText("Sandbox browser account").first(),
      ).toBeVisible();
      await admin.setViewportSize({ width: 320, height: 900 });
      expect(
        await admin.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await admin.screenshot({
        path: "/private/tmp/unlock-paypal-admin-mobile.png",
        fullPage: true,
      });
    } finally {
      await context.close();
    }
  } finally {
    await f.db.$disconnect();
  }
});
