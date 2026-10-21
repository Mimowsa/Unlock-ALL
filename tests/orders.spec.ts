import { expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { test, loginProfile, browserDatabase, origin } from "./browser-helpers";
import { keyVaultConfig, sealKey } from "../src/server/security/key-vault.ts";

test("order APIs protect owner-only keys and downloads, admin review and strict inputs", async ({
  page,
  browser,
}) => {
  const email = await loginProfile(page);
  const added = await page.request.post("/api/cart", {
    headers: { Origin: origin },
    data: { operation: "add", productId: "demo-product-unlock-0", quantity: 1 },
  });
  expect(added.ok()).toBe(true);
  const cart = await (await page.request.get("/api/cart")).json();
  const input = {
    idempotencyKey: randomUUID(),
    cartRevision: cart.revision,
    cartFingerprint: cart.fingerprint,
    discord: "player.demo",
    locale: "FR",
    consent: true,
  };
  expect(
    (
      await page.request.post("/api/orders", {
        headers: { Origin: "https://external.invalid" },
        data: input,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post("/api/orders", {
        headers: { Origin: origin },
        data: { ...input, total: 1, mode: "COMMERCIAL" },
      })
    ).status(),
  ).toBe(400);
  const response = await page.request.post("/api/orders", {
    headers: { Origin: origin },
    data: input,
  });
  expect(response.ok()).toBe(true);
  const { order } = await response.json();
  expect(order.status).toBe("completed");
  expect(JSON.stringify(order)).not.toContain("keys");
  const repeat = await page.request.post("/api/orders", {
    headers: { Origin: origin },
    data: input,
  });
  expect((await repeat.json()).order.id).toBe(order.id);
  const detailResponse = await page.request.get(`/api/orders/${order.id}`);
  expect(detailResponse.headers()["cache-control"]).toContain("no-store");
  const { order: detail } = await detailResponse.json();
  expect(detail.items[0].keys).toHaveLength(1);
  const download = detail.items[0].download;
  expect((await page.request.get(download)).status()).toBe(200);
  expect(
    (await page.request.get("/downloads/demo/unlock-all-demo.txt")).status(),
  ).toBe(404);
  const outsiderContext = await browser.newContext();
  const outsider = await outsiderContext.newPage();
  try {
    expect(
      (await outsider.request.get(`/api/orders/${order.id}`)).status(),
    ).toBe(401);
    expect((await outsider.request.get(download)).status()).toBe(401);
    await loginProfile(outsider);
    expect(
      (await outsider.request.get(`/api/orders/${order.id}`)).status(),
    ).toBe(404);
    expect((await outsider.request.get(download)).status()).toBe(404);
    expect((await outsider.request.get("/api/admin/orders")).status()).toBe(
      403,
    );
    expect(
      (await (await outsider.request.get("/api/orders")).json()).orders,
    ).toEqual([]);
    await loginProfile(outsider, true);
    const adminResponse = await outsider.request.get(
      `/api/admin/orders/${order.id}`,
    );
    expect(adminResponse.ok()).toBe(true);
    expect((await adminResponse.json()).order.items[0].keys).toEqual(
      detail.items[0].keys,
    );
    await outsider.goto("/fr/admin/commandes");
    await outsider
      .getByRole("textbox", { name: "Rechercher une référence ou un client…" })
      .fill(email);
    await outsider
      .getByRole("button", { name: "Rechercher", exact: true })
      .click();
    await expect(outsider.locator("tbody tr")).toHaveCount(1);
    await outsider.locator("tbody tr").getByRole("link").click();
    await expect(outsider.locator(".key-row")).toHaveCount(1);
  } finally {
    await outsiderContext.close();
  }
  await page.goto(`/fr/confirmation/${order.id}`);
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator(".key-row")).toHaveCount(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `/private/tmp/unlock-order-${width}.png`,
      fullPage: true,
    });
  }
  const storage = await page.evaluate(() =>
    localStorage.getItem("unlock-all:demo:v1"),
  );
  expect(storage).not.toContain(detail.items[0].keys[0]);
});

test("a lost checkout response retries the same transaction and delivers only once", async ({
  page,
}) => {
  await loginProfile(page);
  await page.goto("/fr/produits/camos-pc");
  await page
    .getByRole("button", { name: "Ajouter au panier", exact: true })
    .click();
  await expect(page.locator(".toast")).toContainText(
    "Produit ajouté au panier",
  );
  await page.goto("/fr/commande");
  await page
    .getByRole("textbox", { name: "Nom d’utilisateur Discord" })
    .fill("retry.demo");
  await page.getByRole("checkbox").check();
  let first = true;
  const attempts: string[] = [];
  await page.route("**/api/orders", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    attempts.push(route.request().postDataJSON().idempotencyKey);
    if (first) {
      first = false;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "Simuler la commande", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Réponse non confirmée" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Réessayer la même commande", exact: true })
    .click();
  await expect(page).toHaveURL(/\/fr\/confirmation\//);
  await expect(page.locator(".key-row")).toHaveCount(1);
  expect(attempts).toHaveLength(2);
  expect(new Set(attempts).size).toBe(1);
  const db = browserDatabase();
  try {
    expect(
      await db.order.count({ where: { idempotencyKey: attempts[0] } }),
    ).toBe(1);
  } finally {
    await db.$disconnect();
  }
});

test("a stock race records failure, retains cart, and a disabled demo rejects checkout", async ({
  page,
}) => {
  await loginProfile(page);
  const db = browserDatabase();
  try {
    const base = await db.product.findUniqueOrThrow({
      where: { slug: "unlock-pc" },
    });
    const slug = `race-${randomUUID()}`;
    const product = await db.product.create({
      data: {
        slug,
        categoryId: base.categoryId,
        gameId: base.gameId,
        platformId: base.platformId,
        priceCents: 500,
        status: "PUBLISHED",
        isDemo: true,
        translations: {
          create: [
            {
              locale: "FR",
              slug,
              name: "Test course stock",
              shortDescription: "Démo",
              description: "Démo",
            },
            {
              locale: "EN",
              slug,
              name: "Stock race test",
              shortDescription: "Demo",
              description: "Demo",
            },
          ],
        },
      },
    });
    const key = await db.activationKey.create({
      data: {
        productId: product.id,
        isDemo: true,
        ...sealKey(`DEMO-RACE-${randomUUID()}`, keyVaultConfig()),
      },
    });
    await page.request.post("/api/cart", {
      headers: { Origin: origin },
      data: { operation: "add", productId: product.id, quantity: 1 },
    });
    const cart = await (await page.request.get("/api/cart")).json();
    const input = {
      idempotencyKey: randomUUID(),
      cartRevision: cart.revision,
      cartFingerprint: cart.fingerprint,
      discord: "race.demo",
      locale: "FR",
      consent: true,
    };
    await db.siteSetting.update({
      where: { id: "site" },
      data: { demoEnabled: false },
    });
    expect(
      (
        await page.request.post("/api/orders", {
          headers: { Origin: origin },
          data: input,
        })
      ).status(),
    ).toBe(403);
    await db.siteSetting.update({
      where: { id: "site" },
      data: { demoEnabled: true },
    });
    await db.activationKey.update({
      where: { id: key.id },
      data: { disabledAt: new Date() },
    });
    const result = await page.request.post("/api/orders", {
      headers: { Origin: origin },
      data: input,
    });
    expect(result.ok()).toBe(true);
    const { order } = await result.json();
    expect(order.status).toBe("failed");
    await page.goto(`/fr/confirmation/${order.id}`);
    await expect(
      page.getByRole("heading", { name: "Simulation échouée", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".key-row")).toHaveCount(0);
    expect(
      (await (await page.request.get("/api/cart")).json()).items,
    ).toHaveLength(1);
    expect(
      await db.keyAssignment.count({ where: { productId: product.id } }),
    ).toBe(0);
  } finally {
    await db.siteSetting.update({
      where: { id: "site" },
      data: { demoEnabled: true },
    });
    await db.$disconnect();
  }
});
