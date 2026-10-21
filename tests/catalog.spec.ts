import { expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { test, loginProfile, browserDatabase, origin } from "./browser-helpers";
const input = (slug: string) => ({
  slug,
  name: { fr: "Pack persistant", en: "Persistent Pack" },
  description: {
    fr: "Description française de test.",
    en: "English test description.",
  },
  price: 7390,
  platform: "PC",
  category: "unlock",
  art: "complete",
  published: false,
  download: "/downloads/demo/unlock-all-demo.txt",
});

test("catalogue API hides drafts and administrator APIs reject guests and ordinary users", async ({
  page,
  request,
}) => {
  for (const path of ["products", "users", "overview"])
    expect((await request.get(`${origin}/api/admin/${path}`)).status()).toBe(
      401,
    );
  expect(
    (
      await request.post(`${origin}/api/admin/products`, {
        headers: { Origin: origin },
        data: input("guest-injection"),
      })
    ).status(),
  ).toBe(401);
  await loginProfile(page);
  expect((await page.request.get(`${origin}/api/admin/users`)).status()).toBe(
    403,
  );
  expect(
    (
      await page.request.post(`${origin}/api/admin/products`, {
        headers: { Origin: origin },
        data: input("user-injection"),
      })
    ).status(),
  ).toBe(403);
  const db = browserDatabase();
  try {
    expect(
      await db.product.count({
        where: { slug: { in: ["guest-injection", "user-injection"] } },
      }),
    ).toBe(0);
  } finally {
    await db.$disconnect();
  }
});

test("product CRUD persists bilingual content and assets across browsers, hides drafts and rejects stale edits", async ({
  page,
  browser,
}) => {
  await loginProfile(page, true);
  const slug = `persistent-${randomUUID()}`;
  const payload = input(slug);
  let id = "";
  const other = await browser.newContext();
  const visitor = await other.newPage();
  try {
    const response = await page.request.post(`${origin}/api/admin/products`, {
      headers: { Origin: origin },
      data: payload,
    });
    expect(response.status()).toBe(201);
    const { product } = await response.json();
    id = product.id;
    expect(
      (
        await (await visitor.request.get(`${origin}/api/catalog`)).json()
      ).products.some((p: { id: string }) => p.id === id),
    ).toBe(false);
    await visitor.goto(`/fr/produits/${slug}`);
    await expect(visitor.getByRole("heading", { level: 1 })).not.toHaveText(
      payload.name.fr,
    );
    const cross = await page.request.patch(
      `${origin}/api/admin/products/${id}`,
      {
        headers: { Origin: "https://attacker.example" },
        data: { ...payload, updatedAt: product.updatedAt },
      },
    );
    expect(cross.status()).toBe(403);
    const write = await page.request.patch(
      `${origin}/api/admin/products/${id}`,
      {
        headers: { Origin: origin },
        data: { ...payload, published: true, updatedAt: product.updatedAt },
      },
    );
    expect(write.status()).toBe(200);
    const updated = (await write.json()).product;
    const stale = await page.request.patch(
      `${origin}/api/admin/products/${id}`,
      {
        headers: { Origin: origin },
        data: { ...payload, price: 1, updatedAt: product.updatedAt },
      },
    );
    expect(stale.status()).toBe(409);
    expect(
      (
        await page.request.post(`${origin}/api/admin/products`, {
          headers: { Origin: origin },
          data: payload,
        })
      ).status(),
    ).toBe(409);
    await visitor.goto(`/en/produits/${slug}`);
    await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(
      "Persistent Pack",
    );
    await expect(visitor.locator(".detail-price")).toContainText("73.90");
    await expect(visitor.locator(".detail-art img")).toHaveAttribute(
      "src",
      /complete\.svg/,
    );
    const publicData = await (
      await visitor.request.get(`${origin}/api/catalog`)
    ).json();
    expect(JSON.stringify(publicData)).not.toMatch(
      /ciphertext|fingerprint|passwordHash|sessionVersion/,
    );
    const db = browserDatabase();
    try {
      expect(
        await db.productTranslation.count({ where: { productId: id } }),
      ).toBe(2);
      expect(await db.auditLog.count({ where: { entityId: id } })).toBe(2);
    } finally {
      await db.$disconnect();
    }
    const hidden = await page.request.patch(
      `${origin}/api/admin/products/${id}`,
      {
        headers: { Origin: origin },
        data: { ...payload, updatedAt: updated.updatedAt },
      },
    );
    expect(hidden.status()).toBe(200);
    await visitor.reload();
    await expect(visitor.getByRole("heading", { level: 1 })).not.toHaveText(
      "Persistent Pack",
    );
  } finally {
    await other.close();
    if (id) {
      const db = browserDatabase();
      try {
        await db.product.delete({ where: { id } });
      } finally {
        await db.$disconnect();
      }
    }
  }
});

test("server validation rejects fractional prices, unsafe assets, privilege fields and oversized bodies", async ({
  page,
}) => {
  await loginProfile(page, true);
  const slug = `invalid-${randomUUID()}`;
  for (const patch of [
    { price: 1.1 },
    { price: -1 },
    { isDemo: false },
    { art: "../../secret" },
    { download: "https://attacker.example/run.exe" },
    { name: { fr: "", en: "Invalid" } },
    { platform: "Hacked" },
  ]) {
    expect(
      (
        await page.request.post(`${origin}/api/admin/products`, {
          headers: { Origin: origin },
          data: { ...input(slug), ...patch },
        })
      ).status(),
    ).toBe(400);
  }
  const huge = await page.request.post(`${origin}/api/admin/products`, {
    headers: { Origin: origin, "Content-Type": "application/json" },
    data: " ".repeat(32769),
  });
  expect(huge.status()).toBe(413);
  const db = browserDatabase();
  try {
    expect(await db.product.count({ where: { slug } })).toBe(0);
  } finally {
    await db.$disconnect();
  }
});

test("browser product metadata cannot override database prices and publication", async ({
  page,
}) => {
  await page.goto("/fr/produits/unlock-pc");
  await expect(page.locator(".detail-price")).toContainText("24,90");
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("unlock-all:demo:v1")!);
    const p = state.products.find(
      (p: { slug: string }) => p.slug === "unlock-pc",
    );
    p.price = 1;
    p.name.fr = "Forged browser product";
    localStorage.setItem("unlock-all:demo:v1", JSON.stringify(state));
  });
  await page.reload();
  await expect(page.locator(".detail-price")).toContainText("24,90");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Unlock All",
  );
});

test("dashboard metrics are calculated from PostgreSQL and contain no authentication secrets", async ({
  page,
}) => {
  await loginProfile(page, true);
  await page.goto("/fr/admin");
  const response = await page.request.get(`${origin}/api/admin/overview`);
  expect(response.headers()["cache-control"]).toBe("no-store");
  const stats = await response.json();
  const db = browserDatabase();
  try {
    expect(stats.users).toBe(await db.user.count());
    expect(stats.orders).toBe(
      await db.order.count({ where: { mode: "DEMO" } }),
    );
    expect(stats.available).toBe(11);
    expect(stats.soldOut).toBe(1);
  } finally {
    await db.$disconnect();
  }
  await expect(page.locator(".stat-card").first()).toContainText(
    String(stats.users).padStart(2, "0"),
  );
  await expect(page.locator(".stats-grid")).toContainText(
    "Utilisateurs enregistrés",
  );
  await expect(
    page.getByText("POSTGRESQL · DÉMO", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "/private/tmp/unlock-phase5-dashboard.png",
    fullPage: true,
  });
});

test("administrator user controls persist roles, invalidate existing sessions and keep personal data out of local storage", async ({
  page,
  browser,
}) => {
  const other = await browser.newContext();
  const customer = await other.newPage();
  const targetEmail = await loginProfile(customer);
  await customer.goto("/fr/compte");
  try {
    await loginProfile(page, true);
    await page.goto("/fr/admin/utilisateurs");
    await page
      .getByRole("textbox", { name: "Rechercher un profil…" })
      .fill(targetEmail);
    await page.getByRole("button", { name: "Rechercher", exact: true }).click();
    const row = page.locator("tbody tr").filter({ hasText: targetEmail });
    await expect(row).toHaveCount(1);
    page.on("dialog", (d) => d.accept());
    await row.getByRole("combobox").selectOption("ADMIN");
    await expect(page.locator(".toast")).toContainText(
      "Modifications enregistrées dans PostgreSQL",
    );
    expect(
      (await customer.request.get(`${origin}/api/account/profile`)).status(),
    ).toBe(401);
    const db = browserDatabase();
    try {
      expect(
        (await db.user.findUniqueOrThrow({ where: { email: targetEmail } }))
          .role,
      ).toBe("ADMIN");
    } finally {
      await db.$disconnect();
    }
    await expect(row.getByRole("combobox")).toHaveValue("ADMIN");
    await row.getByRole("button", { name: "Désactiver", exact: true }).click();
    await expect(
      row.getByRole("button", { name: "Activer", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => JSON.stringify(localStorage)),
    ).not.toContain(targetEmail);
  } finally {
    await other.close();
  }
});

test("administrator data errors provide a retry and do not display a fictional catalogue", async ({
  page,
}) => {
  await loginProfile(page, true);
  await page.route("**/api/admin/products", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "unavailable" }),
    }),
  );
  await page.goto("/fr/admin/produits");
  await expect(page.locator(".admin-content").getByRole("alert")).toContainText(
    "Les données sont momentanément indisponibles",
  );
  await expect(page.locator("tbody tr")).toHaveCount(0);
  await page.unroute("**/api/admin/products");
  await page.getByRole("button", { name: "Réessayer", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(12);
});

test("failed product saves keep entered content and never claim success", async ({
  page,
}) => {
  await loginProfile(page, true);
  await page.goto("/fr/admin/produits");
  await page
    .getByRole("button", { name: "Modifier Unlock All PC", exact: true })
    .click();
  await page
    .getByRole("spinbutton", { name: "Prix fictif en centimes" })
    .fill("8888");
  await page.route("**/api/admin/products/*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "unavailable" }),
    }),
  );
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.locator(".admin-content").getByRole("alert")).toContainText(
    "Les données sont momentanément indisponibles",
  );
  await expect(
    page.getByRole("spinbutton", { name: "Prix fictif en centimes" }),
  ).toHaveValue("8888");
  await expect(page.locator(".admin-editor")).toBeVisible();
  const db = browserDatabase();
  try {
    expect(
      (await db.product.findUniqueOrThrow({ where: { slug: "unlock-pc" } }))
        .priceCents,
    ).toBe(2490);
  } finally {
    await db.$disconnect();
  }
});

test("administrators can upload a product image, preview it and persist it across browsers", async ({
  page,
  browser,
}) => {
  const sharp = (await import("sharp")).default;
  const png = await sharp({
    create: { width: 720, height: 480, channels: 3, background: "#7950e8" },
  })
    .png()
    .toBuffer();
  await loginProfile(page, true);
  await page.goto("/fr/admin/produits");
  const row = page
    .locator("tbody tr")
    .filter({
      has: page.getByRole("button", {
        name: "Modifier Unlock All PC",
        exact: true,
      }),
    });
  await expect(row.getByRole("img")).toHaveAttribute("src", /operator\.svg/);
  await row
    .getByRole("button", { name: "Modifier Unlock All PC", exact: true })
    .click();
  await page
    .getByLabel("Ajouter une image", { exact: true })
    .setInputFiles({ name: "product.png", mimeType: "image/png", buffer: png });
  const preview = page.getByRole("img", {
    name: "Aperçu de l’image du produit",
    exact: true,
  });
  await expect(preview).toHaveAttribute(
    "src",
    /^\/api\/media\/products\/.*\.webp$/,
  );
  const imageUrl = (await preview.getAttribute("src"))!;
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.locator(".admin-editor")).toHaveCount(0);
  await expect(row.getByRole("img")).toHaveAttribute("src", imageUrl);
  const other = await browser.newContext();
  const guest = await other.newPage();
  try {
    const response = await guest.request.get(origin + imageUrl);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/webp");
    expect((await sharp(await response.body()).metadata()).format).toBe("webp");
    await guest.goto("/fr/produits/unlock-pc");
    await expect(guest.locator(".detail-art img")).toHaveAttribute(
      "src",
      imageUrl,
    );
    await guest.reload();
    await expect(guest.locator(".detail-art img")).toHaveAttribute(
      "src",
      imageUrl,
    );
    await page.goto("/fr/admin/produits");
    await page
      .getByRole("button", { name: "Modifier Unlock All PC", exact: true })
      .click();
    await expect(
      page.getByRole("img", {
        name: "Aperçu de l’image du produit",
        exact: true,
      }),
    ).toHaveAttribute("src", imageUrl);
    await page.setViewportSize({ width: 320, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "/private/tmp/unlock-product-image-editor-mobile.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Revenir au visuel prédéfini", exact: true })
      .click();
    await expect(
      page.getByRole("img", {
        name: "Aperçu de l’image du produit",
        exact: true,
      }),
    ).toHaveAttribute("src", /operator\.svg/);
    await page
      .getByRole("button", { name: "Enregistrer", exact: true })
      .click();
    await expect(page.locator(".admin-editor")).toHaveCount(0);
  } finally {
    await other.close();
    const db = browserDatabase();
    try {
      const p = await db.product.findUniqueOrThrow({
        where: { slug: "unlock-pc" },
      });
      await db.productImage.update({
        where: { productId_position: { productId: p.id, position: 0 } },
        data: { url: "/images/operator.svg" },
      });
    } finally {
      await db.$disconnect();
    }
  }
});

test("product image endpoints reject guests, invalid content, oversized images and forged image paths", async ({
  page,
  request,
}) => {
  expect(
    (
      await request.post(origin + "/api/admin/product-images", {
        headers: { Origin: origin, "Content-Type": "image/png" },
        data: Buffer.from("invalid"),
      })
    ).status(),
  ).toBe(401);
  await loginProfile(page, true);
  const invalid = await page.request.post(
    origin + "/api/admin/product-images",
    {
      headers: { Origin: origin, "Content-Type": "image/png" },
      data: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      ),
    },
  );
  expect(invalid.status()).toBe(400);
  const large = await page.request.post(origin + "/api/admin/product-images", {
    headers: { Origin: origin, "Content-Type": "image/png" },
    data: Buffer.alloc(5 * 1024 * 1024 + 1),
  });
  expect(large.status()).toBe(413);
  const cross = await page.request.post(origin + "/api/admin/product-images", {
    headers: {
      Origin: "https://attacker.example",
      "Content-Type": "image/png",
    },
    data: Buffer.from("invalid"),
  });
  expect(cross.status()).toBe(403);
  const forged = await page.request.post(origin + "/api/admin/products", {
    headers: { Origin: origin },
    data: {
      ...input("forged-image"),
      image: "/api/media/products/00000000-0000-0000-0000-000000000000.webp",
    },
  });
  expect(forged.status()).toBe(400);
  expect(
    (
      await request.get(origin + "/api/media/products/not-an-image.webp")
    ).status(),
  ).toBe(404);
});
