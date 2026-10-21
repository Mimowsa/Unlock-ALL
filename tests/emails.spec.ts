import { expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { test, loginProfile, browserDatabase, origin } from "./browser-helpers";
import { emailTemplate } from "../src/server/email/templates.ts";

test("email delivery state updates without hiding keys and exposes operational details only to admins", async ({
  page,
  browser,
}) => {
  const email = await loginProfile(page),
    db = browserDatabase();
  try {
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    await page.request.post("/api/cart", {
      headers: { Origin: origin },
      data: {
        operation: "add",
        productId: "demo-product-unlock-0",
        quantity: 1,
      },
    });
    const cart = await (await page.request.get("/api/cart")).json();
    const response = await page.request.post("/api/orders", {
      headers: { Origin: origin },
      data: {
        idempotencyKey: randomUUID(),
        cartRevision: cart.revision,
        cartFingerprint: cart.fingerprint,
        discord: "email.demo",
        locale: "FR",
        consent: true,
      },
    });
    const { order } = await response.json();
    expect(order.status).toBe("completed");
    await db.emailJob.createMany({
      data: ["ORDER_CONFIRMATION", "KEY_DELIVERY"].map((kind) => ({
        userId: user.id,
        orderId: order.id,
        recipient: email,
        kind: kind as "ORDER_CONFIRMATION" | "KEY_DELIVERY",
        idempotencyKey: `ui-${kind}/${order.id}`,
      })),
    });
    await page.goto(`/fr/confirmation/${order.id}`);
    await expect(
      page.getByText(
        "Les emails sont en attente d’envoi. Vos clés restent disponibles ici.",
      ),
    ).toBeVisible();
    await expect(page.locator(".key-row")).toHaveCount(1);
    await db.emailJob.updateMany({
      where: { orderId: order.id },
      data: {
        status: "SENT",
        sentAt: new Date(),
        providerMessageId: "test-provider-id",
      },
    });
    await expect(
      page.getByText(/Les emails ont été acceptés par le service/),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".key-row")).toHaveCount(1);
    const detail = (
      await (await page.request.get(`/api/orders/${order.id}`)).json()
    ).order;
    expect(detail.email.status).toBe("accepted");
    expect(detail.email.jobs).toBeUndefined();
    expect(JSON.stringify(detail)).not.toContain("payloadCiphertext");
    expect(
      (
        await page.request.post(`/api/admin/orders/${order.id}/emails/retry`, {
          headers: { Origin: origin },
          data: {},
        })
      ).status(),
    ).toBe(403);
    const context = await browser.newContext(),
      admin = await context.newPage();
    try {
      await loginProfile(admin, true);
      await db.emailJob.updateMany({
        where: { orderId: order.id },
        data: {
          status: "FAILED",
          sentAt: null,
          lastErrorCode: "PROVIDER_403",
          attempts: 1,
          firstAttemptAt: new Date(),
        },
      });
      await admin.goto(`/fr/admin/commandes/${order.id}`);
      await expect(
        admin.getByText(/Un email n’a pas pu être envoyé/),
      ).toBeVisible();
      await expect(admin.getByText(/KEY_DELIVERY · FAILED/)).toBeVisible();
      expect(
        (
          await admin.request.post(
            `/api/admin/orders/${order.id}/emails/retry`,
            { headers: { Origin: "https://external.invalid" }, data: {} },
          )
        ).status(),
      ).toBe(403);
      expect(
        (
          await admin.request.post(
            `/api/admin/orders/${order.id}/emails/retry`,
            {
              headers: { Origin: origin },
              data: { recipient: "external@example.com" },
            },
          )
        ).status(),
      ).toBe(400);
      await admin
        .getByRole("button", { name: "Relancer les emails", exact: true })
        .click();
      await expect(admin.locator(".toast")).toContainText(
        "Reprise indisponible",
      );
      expect(
        (await db.order.findUniqueOrThrow({ where: { id: order.id } })).status,
      ).toBe("COMPLETED");
      expect(
        await db.keyAssignment.count({
          where: { orderItem: { orderId: order.id } },
        }),
      ).toBe(1);
    } finally {
      await context.close();
    }
  } finally {
    await db.$disconnect();
  }
});

test("password reset uses a conditional queue notice without claiming delivery", async ({
  page,
}) => {
  await page.route("**/api/auth/password/forgot", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ delivery: "email" }),
    }),
  );
  await page.goto("/fr/mot-de-passe-oublie");
  await page
    .getByLabel("Adresse email", { exact: true })
    .fill("owner@example.com");
  await page
    .getByRole("button", { name: "Demander un lien", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Si ce compte est actif et autorisé pour les tests",
  );
});

test("all four email templates render in FR and EN at mobile and desktop widths", async ({
  page,
}) => {
  for (const locale of ["FR", "EN"] as const)
    for (const kind of [
      "WELCOME",
      "ORDER_CONFIRMATION",
      "KEY_DELIVERY",
      "PASSWORD_RESET",
    ] as const) {
      const { html } = emailTemplate({
        kind,
        locale,
        name: "Player Demo",
        url: `http://127.0.0.1:3100/${locale.toLowerCase()}/compte`,
        reference: "UA-DEMO-VISUEL-1234567890",
        totalCents: 4980n,
        items:
          kind === "ORDER_CONFIRMATION" || kind === "KEY_DELIVERY"
            ? [
                {
                  name: "Unlock All · PC",
                  quantity: 2,
                  unitPriceCents: 2490,
                  ...(kind === "KEY_DELIVERY"
                    ? { keys: ["DEMO-EXEMPLE-0001", "DEMO-EXEMPLE-0002"] }
                    : {}),
                },
              ]
            : [],
      });
      await page.setContent(html);
      await expect(page.locator("html")).toHaveAttribute(
        "lang",
        locale.toLowerCase(),
      );
      await expect(page.locator("h1")).toBeVisible();
      for (const width of [320, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: `/private/tmp/unlock-email-${kind.toLowerCase()}-${locale.toLowerCase()}-${width}.png`,
          fullPage: true,
        });
      }
    }
});
