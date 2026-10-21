import { expect } from "@playwright/test";
import { test, loginProfile, browserDatabase, origin } from "./browser-helpers";
const productId = "demo-product-unlock-0";
const add = (request: any, quantity = 1) =>
  request.post(origin + "/api/cart", {
    headers: { Origin: origin },
    data: { operation: "add", productId, quantity },
  });

test("guest cart uses an HttpOnly cookie, rejects forged amounts and never exposes inventory values", async ({
  page,
  request,
}) => {
  await page.goto("/fr/produits/unlock-pc");
  await expect(
    page.getByRole("button", { name: "Ajouter au panier", exact: true }),
  ).toBeVisible();
  const cookie = (await page.context().cookies()).find(
    (c) => c.name === "unlock-all.cart",
  )!;
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.sameSite).toBe("Lax");
  expect(await page.evaluate(() => document.cookie)).not.toContain(
    cookie.value,
  );
  expect((await add(page.request, 2)).status()).toBe(200);
  for (const patch of [
    { quantity: 1000 },
    { quantity: -1 },
    { quantity: 1.5 },
    { price: 1 },
    { userId: "other" },
  ]) {
    const response = await page.request.post(origin + "/api/cart", {
      headers: { Origin: origin },
      data: { operation: "add", productId, quantity: 1, ...patch },
    });
    expect([400, 409]).toContain(response.status());
  }
  const cross = await page.request.post(origin + "/api/cart", {
    headers: { Origin: "https://attacker.example" },
    data: { operation: "add", productId, quantity: 1 },
  });
  expect(cross.status()).toBe(403);
  const cart = await (await page.request.get(origin + "/api/cart")).json();
  expect(cart.items[0].quantity).toBe(2);
  expect(cart.totalCents).toBe(4980);
  expect(
    (await (await request.get(origin + "/api/cart")).json()).items,
  ).toEqual([]);
  expect(
    JSON.stringify(await (await request.get(origin + "/api/catalog")).json()),
  ).not.toMatch(/ciphertext|fingerprint|DEMO-UNLOCK/);
});

test("account carts persist across browsers and guest merge is applied once", async ({
  page,
  browser,
}) => {
  await page.goto("/fr/produits/unlock-pc");
  await expect(
    page.getByRole("button", { name: "Ajouter au panier", exact: true }),
  ).toBeVisible();
  expect((await add(page.request, 2)).status()).toBe(200);
  const email = await loginProfile(page);
  await page.goto("/fr/panier");
  await expect(page.locator(".quantity-control")).toContainText("2");
  expect(
    (await page.context().cookies()).find((c) => c.name === "unlock-all.cart"),
  ).toBeUndefined();
  const cookies = (await page.context().cookies()).filter((c) =>
    c.name.includes("session-token"),
  );
  const other = await browser.newContext();
  await other.addCookies(cookies);
  const second = await other.newPage();
  try {
    await second.goto("/fr/panier");
    await expect(second.locator(".quantity-control")).toContainText("2");
    expect((await add(second.request)).status()).toBe(200);
    await page.reload();
    await expect(page.locator(".quantity-control")).toContainText("3");
    await page.request.post(origin + "/api/cart/merge", {
      headers: { Origin: origin },
      data: {},
    });
    await page.reload();
    await expect(page.locator(".quantity-control")).toContainText("3");
    const db = browserDatabase();
    try {
      const user = await db.user.findUniqueOrThrow({ where: { email } });
      expect(
        (
          await db.cart.findUniqueOrThrow({
            where: { userId: user.id },
            include: { items: true },
          })
        ).items[0].quantity,
      ).toBe(3);
    } finally {
      await db.$disconnect();
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: "/private/tmp/unlock-phase6-cart-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 320, height: 900 });
    await page.reload();
    await expect(page.locator(".quantity-control")).toContainText("3");
    await expect(page.locator(".site-header")).toHaveCount(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "/private/tmp/unlock-phase6-cart-mobile.png",
      fullPage: true,
    });
    expect(
      await page.evaluate(() => localStorage.getItem("unlock-all:demo:v1")),
    ).not.toContain('"quantity":3');
  } finally {
    await other.close();
  }
});

test("two stale cart edits cannot overwrite each other and stock is not reserved", async ({
  page,
}) => {
  await loginProfile(page);
  expect((await add(page.request)).status()).toBe(200);
  const cart = await (await page.request.get(origin + "/api/cart")).json();
  const first = await page.request.post(origin + "/api/cart", {
    headers: { Origin: origin },
    data: { operation: "set", productId, quantity: 2, revision: cart.revision },
  });
  expect(first.status()).toBe(200);
  const stale = await page.request.post(origin + "/api/cart", {
    headers: { Origin: origin },
    data: { operation: "set", productId, quantity: 3, revision: cart.revision },
  });
  expect(stale.status()).toBe(409);
  expect(
    (await (await page.request.get(origin + "/api/cart")).json()).items[0]
      .quantity,
  ).toBe(2);
  const db = browserDatabase();
  try {
    expect(await db.keyAssignment.count()).toBe(0);
    expect(
      await db.activationKey.count({
        where: { productId, disabledAt: null, assignment: null },
      }),
    ).toBe(8);
  } finally {
    await db.$disconnect();
  }
});

test("inventory administration masks and encrypts keys, rejects ordinary users and persists changes", async ({
  page,
  request,
  browser,
}) => {
  expect(
    (
      await request.get(origin + `/api/admin/keys?productId=${productId}`)
    ).status(),
  ).toBe(401);
  await loginProfile(page);
  expect(
    (
      await page.request.post(origin + "/api/admin/keys", {
        headers: { Origin: origin },
        data: { productId, value: "DEMO-NOT-ADMIN" },
      })
    ).status(),
  ).toBe(403);
  await loginProfile(page, true);
  const value = "DEMO-COMMERCE-STOCK-TEST";
  let id = "";
  try {
    const created = await page.request.post(origin + "/api/admin/keys", {
      headers: { Origin: origin },
      data: { productId, value },
    });
    expect(created.status()).toBe(201);
    id = (await created.json()).id;
    const listing = await (
      await page.request.get(origin + `/api/admin/keys?productId=${productId}`)
    ).json();
    expect(JSON.stringify(listing)).not.toContain(value);
    expect(JSON.stringify(listing)).not.toContain("ciphertext");
    expect(listing.available).toBe(9);
    const revealed = await page.request.post(
      origin + `/api/admin/keys/${id}/reveal`,
      { headers: { Origin: origin }, data: {} },
    );
    expect((await revealed.json()).value).toBe(value);
    const duplicate = await page.request.post(origin + "/api/admin/keys", {
      headers: { Origin: origin },
      data: { productId: "demo-product-camos-0", value },
    });
    expect(duplicate.status()).toBe(409);
    expect(
      (
        await page.request.patch(origin + `/api/admin/keys/${id}`, {
          headers: { Origin: origin },
          data: { disabled: true },
        })
      ).status(),
    ).toBe(200);
    const other = await browser.newContext();
    try {
      const data = await (
        await other.request.get(origin + "/api/catalog")
      ).json();
      expect(
        data.products.find((p: any) => p.id === productId).availableStock,
      ).toBe(8);
    } finally {
      await other.close();
    }
    const db = browserDatabase();
    try {
      const stored = await db.activationKey.findUniqueOrThrow({
        where: { id },
      });
      expect(stored.ciphertext).not.toContain(value);
      expect(await db.auditLog.count({ where: { entityId: id } })).toBe(3);
    } finally {
      await db.$disconnect();
    }
  } finally {
    if (id) {
      const db = browserDatabase();
      try {
        await db.activationKey.delete({ where: { id } });
      } finally {
        await db.$disconnect();
      }
    }
  }
});

test("the checkout validator rejects stock loss and never trusts browser inventory", async ({
  page,
}) => {
  await loginProfile(page);
  expect((await add(page.request, 2)).status()).toBe(200);
  const db = browserDatabase();
  const keys = await db.activationKey.findMany({
    where: { productId, disabledAt: null },
    select: { id: true },
  });
  try {
    await db.activationKey.updateMany({
      where: { id: { in: keys.map((k) => k.id) } },
      data: { disabledAt: new Date() },
    });
    const response = await page.request.post(origin + "/api/cart/validate", {
      headers: { Origin: origin },
      data: {},
    });
    expect(response.status()).toBe(409);
    const snapshot = await (
      await page.request.get(origin + "/api/cart")
    ).json();
    expect(snapshot.valid).toBe(false);
    expect(snapshot.items[0].quantity).toBe(2);
    expect(await db.keyAssignment.count()).toBe(0);
  } finally {
    await db.activationKey.updateMany({
      where: { id: { in: keys.map((k) => k.id) } },
      data: { disabledAt: null },
    });
    await db.$disconnect();
  }
});

test("cart network errors are visible and adding a product cannot falsely succeed", async ({
  page,
}) => {
  await page.route("**/api/cart", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "unavailable" }),
    }),
  );
  await page.goto("/fr/produits/unlock-pc");
  await expect(
    page.locator(".storage-warning").filter({ hasText: "panier serveur" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Ajouter au panier", exact: true }),
  ).toBeDisabled();
  await page.unroute("**/api/cart");
  await page.getByRole("button", { name: "Réessayer", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Ajouter au panier", exact: true }),
  ).toBeEnabled();
});
