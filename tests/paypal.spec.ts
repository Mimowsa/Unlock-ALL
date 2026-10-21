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

test("Sandbox checkout redirects for approval and returns to one persistent key delivery", async ({
  page,
}) => {
  const f = await setup(page);
  try {
    await page.route("**/api/paypal/config", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ enabled: true, environment: "sandbox" }),
      }),
    );
    await page.route("**/api/paypal/checkouts", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const checkout = await preparePayPalCheckout(
        f.db,
        f.user.id,
        route.request().postDataJSON(),
        f.options,
      );
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ checkout }),
      });
    });
    await page.route("**/api/paypal/checkouts/*", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const checkout = await reconcilePayPal(
        f.db,
        f.user.id,
        f.checkoutId,
        f.options,
      );
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ checkout }),
      });
    });
    await page.route(
      "https://www.sandbox.paypal.com/checkoutnow?token=TEST",
      (route) =>
        route.fulfill({
          contentType: "text/html",
          body: `<h1>PayPal Sandbox — test</h1><a href="${origin}/fr/commande/paypal/${f.checkoutId}">Approuver le paiement fictif</a>`,
        }),
    );
    await page.goto("/fr/commande");
    await page
      .getByRole("textbox", { name: "Nom d’utilisateur Discord" })
      .fill("paypal.demo");
    await page.getByRole("checkbox").check();
    await page.setViewportSize({ width: 320, height: 900 });
    await expect(
      page.getByRole("button", {
        name: "Tester avec PayPal Sandbox",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "/private/tmp/unlock-paypal-checkout-mobile.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Tester avec PayPal Sandbox", exact: true })
      .click();
    await expect(page).toHaveURL(/www\.sandbox\.paypal\.com/);
    expect(
      await f.db.keyAssignment.count({ where: { productId: f.product.id } }),
    ).toBe(0);
    expect(
      await f.db.keyReservation.count({ where: { checkoutId: f.checkoutId } }),
    ).toBe(1);
    f.approve();
    await page
      .getByRole("link", { name: "Approuver le paiement fictif" })
      .click();
    await expect(page).toHaveURL(/\/fr\/confirmation\//);
    await expect(page.locator(".key-row")).toHaveCount(1);
    await expect(
      page.getByText("Paiement de test vérifié avec PayPal Sandbox."),
    ).toBeVisible();
    expect(f.captured).toBe(1);
    expect(
      await f.db.order.count({ where: { paypalCheckoutId: f.checkoutId } }),
    ).toBe(1);
    await page.reload();
    await expect(page.locator(".key-row")).toHaveCount(1);
    expect(
      await f.db.keyReservation.count({ where: { checkoutId: f.checkoutId } }),
    ).toBe(0);
    await page.screenshot({
      path: "/private/tmp/unlock-paypal-confirmation-mobile.png",
      fullPage: true,
    });
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
      page.getByRole("link", { name: /Continuer sur PayPal Sandbox/ }),
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
