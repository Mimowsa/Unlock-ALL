import { expect } from "@playwright/test";
import { test, loginProfile, browserDatabase } from "./browser-helpers";
test("home and catalogue remain usable at the target viewport widths", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/fr");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Passez au",
    );
    await expect(page.locator(".product-card")).toHaveCount(12);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `/private/tmp/unlock-home-${width}.png`,
      fullPage: true,
    });
    await page.goto("/fr/boutique");
    await expect(page.locator(".product-card")).toHaveCount(12);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  expect(errors).toEqual([]);
});
test("filters, search, sorting and sold-out products", async ({ page }) => {
  await page.goto("/fr/boutique");
  await page.getByRole("button", { name: "Camouflages" }).click();
  await expect(page.locator(".product-card")).toHaveCount(3);
  await page.getByRole("button", { name: "Xbox", exact: true }).click();
  await expect(page.locator(".product-card")).toHaveCount(1);
  await page
    .getByRole("textbox", { name: "Rechercher dans le catalogue" })
    .fill("zzzz");
  await expect(
    page.getByRole("heading", { name: "Aucun produit trouvé" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Réinitialiser les filtres", exact: true })
    .last()
    .click();
  await expect(page.locator(".product-card")).toHaveCount(12);
  await page.goto("/fr/produits/weapons-xbox");
  await expect(
    page.getByRole("button", { name: "Ajouter au panier" }),
  ).toBeDisabled();
  await expect(
    page.getByText("Victime de son succès ! Réassort prochainement."),
  ).toBeVisible();
});
test("multi-product order, guest cart merge, persistence and unique keys", async ({
  page,
}) => {
  await page.goto("/fr/produits/unlock-pc");
  await page.getByRole("spinbutton").fill("2");
  await page.getByRole("button", { name: "Ajouter au panier" }).click();
  await expect(page.locator(".toast")).toContainText(
    "Produit ajouté au panier",
  );
  await page.goto("/fr/produits/camos-xbox");
  await page.getByRole("button", { name: "Ajouter au panier" }).click();
  await expect(page.locator(".toast")).toContainText(
    "Produit ajouté au panier",
  );
  await page.goto("/fr/panier");
  await expect(page.locator(".cart-item")).toHaveCount(2);
  await page.getByRole("link", { name: "Passer à la simulation" }).click();
  await loginProfile(page);
  await page.goto("/fr/commande");
  await expect(page).toHaveURL(/\/fr\/commande$/);
  await page
    .getByRole("textbox", { name: "Nom d’utilisateur Discord" })
    .fill("player.demo");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Simuler la commande", exact: true })
    .click();
  await expect(page).toHaveURL(/\/fr\/confirmation\//);
  await expect(page.locator(".key-row")).toHaveCount(3);
  const keys = await page.locator(".key-row code").allTextContents();
  expect(new Set(keys).size).toBe(3);
  await expect(page.getByText("64,70", { exact: false }).first()).toBeVisible();
  const url = page.url();
  await page.reload();
  await expect(page.locator(".key-row")).toHaveCount(3);
  await page.goto("/fr/compte/commandes");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.goto("/fr/panier");
  await expect(page.locator(".cart-item")).toHaveCount(0);
  await page.goto("/fr/compte");
  await page.getByRole("button", { name: "Déconnexion" }).click();
  await expect(page).toHaveURL(/\/fr\/connexion/);
  await page.goto(url);
  await expect(page).toHaveURL(/\/fr\/connexion/);
});
test("sign-up stores a real account without persisting its password in the browser", async ({
  page,
}) => {
  await page.goto("/fr/inscription");
  await page.getByRole("textbox", { name: "Pseudonyme" }).fill("Test Player");
  await page
    .getByRole("textbox", { name: "Adresse email" })
    .fill("signup-1792516311234@example.com");
  await page.getByLabel("Mot de passe").fill("Browser Strong Passphrase 123");
  await page
    .getByRole("button", { name: "Créer un compte", exact: true })
    .click();
  await expect(page).toHaveURL(/\/fr\/compte$/);
  expect(
    await page.evaluate(() => localStorage.getItem("unlock-all:demo:v1")),
  ).not.toContain("Browser Strong Passphrase 123");
});
test("administrator can edit a product, manage keys and protect the last admin", async ({
  page,
}) => {
  await page.goto("/fr/connexion");
  const adminEmail = await loginProfile(page, true);
  await page.goto("/fr/admin/produits");
  await page
    .getByRole("button", { name: "Modifier Unlock All PC", exact: true })
    .click();
  await page
    .getByRole("spinbutton", { name: "Prix fictif en centimes" })
    .fill("2990");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(
    page.locator("tbody tr").filter({
      has: page.getByRole("button", {
        name: "Modifier Unlock All PC",
        exact: true,
      }),
    }),
  ).toContainText("29,90");
  await page.goto("/fr/admin/stocks");
  await page
    .getByRole("textbox", { name: "Clé fictive à ajouter" })
    .fill("DEMO-TEST-KEY-123");
  await page.getByRole("button", { name: "Ajouter la clé" }).click();
  await expect(page.locator(".toast")).toContainText("Clé chiffrée ajoutée");
  await page
    .locator("tbody tr")
    .first()
    .getByRole("button", { name: /^Afficher/ })
    .click();
  await expect(
    page.getByText("DEMO-TEST-KEY-123", { exact: true }),
  ).toBeVisible();
  await page
    .locator("tr")
    .filter({ hasText: "DEMO-TEST-KEY-123" })
    .getByRole("button", { name: "Désactiver", exact: true })
    .click();
  await expect(
    page.locator("tr").filter({ hasText: "DEMO-TEST-KEY-123" }),
  ).toContainText("Désactivée");
  const guardDb = browserDatabase();
  try {
    await guardDb.user.updateMany({
      where: { role: "ADMIN", active: true, email: { not: adminEmail } },
      data: { role: "USER" },
    });
  } finally {
    await guardDb.$disconnect();
  }
  await page.goto("/fr/admin/utilisateurs");
  page.on("dialog", (d) => d.accept());
  await page
    .locator("tbody tr")
    .filter({ hasText: adminEmail })
    .getByRole("combobox")
    .selectOption("USER");
  await expect(page.locator(".admin-content").getByRole("alert")).toContainText(
    "Le dernier administrateur actif",
  );
  await expect(
    page
      .locator("tbody tr")
      .filter({ hasText: adminEmail })
      .getByRole("combobox"),
  ).toHaveValue("ADMIN");
  const db = browserDatabase();
  try {
    await db.product.update({
      where: { slug: "unlock-pc" },
      data: { priceCents: 2490 },
    });
  } finally {
    await db.$disconnect();
  }
});
test("language switch preserves the page and translates visible UI", async ({
  page,
}) => {
  await page.goto("/fr/boutique");
  await page
    .getByRole("combobox", { name: "FR / EN", exact: true })
    .selectOption("en");
  await expect(page).toHaveURL(/\/en\/boutique$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Your game. Your platform. Your pack.",
  );
  await expect(
    page.getByRole("link", { name: "Store", exact: true }).first(),
  ).toBeVisible();
});
test("mobile menu is keyboard accessible and closes after navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/fr");
  const menu = page.getByRole("button", { name: "Ouvrir le menu" });
  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "Fermer", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await page
    .locator("#mobile-navigation")
    .getByRole("link", { name: "Boutique", exact: true })
    .click();
  await expect(page).toHaveURL(/\/fr\/boutique$/);
  await expect(page.locator("#mobile-navigation")).toHaveCount(0);
});
test("malformed local storage falls back to a usable demo with an honest warning", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("unlock-all:demo:v1", "{broken"),
  );
  await page.goto("/fr");
  await expect(
    page.getByRole("alert").filter({ hasText: "Stockage local indisponible" }),
  ).toBeVisible();
  await expect(page.locator(".product-card")).toHaveCount(12);
});

test("a new demo product starts empty and becomes available after adding a key", async ({
  page,
}) => {
  await page.goto("/fr/connexion");
  await loginProfile(page, true);
  await page.goto("/fr/admin/produits");
  await page
    .getByRole("button", { name: "Créer un produit", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Nom français", exact: true })
    .fill("Pack découverte");
  await page
    .getByRole("textbox", { name: "Nom anglais", exact: true })
    .fill("Discovery Pack");
  await page
    .getByRole("textbox", { name: "Slug", exact: true })
    .fill("discovery-pc");
  await page
    .getByRole("textbox", { name: "Description française", exact: true })
    .fill("Un nouveau pack fictif de présentation.");
  await page
    .getByRole("textbox", { name: "Description anglaise", exact: true })
    .fill("A new fictional presentation pack.");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.locator(".admin-editor")).toHaveCount(0);
  await page.goto("/fr/produits/discovery-pc");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Pack découverte",
  );
  await expect(
    page.getByRole("button", { name: "Ajouter au panier" }),
  ).toBeDisabled();
  await page.goto("/fr/admin/stocks");
  await page
    .getByRole("combobox")
    .filter({ has: page.locator("option", { hasText: "Pack découverte" }) })
    .selectOption({ label: "Pack découverte · PC" });
  await page
    .getByRole("textbox", { name: "Clé fictive à ajouter" })
    .fill("DEMO-DISCOVERY-001");
  await page.getByRole("button", { name: "Ajouter la clé" }).click();
  await expect(page.locator(".toast")).toContainText("Clé chiffrée ajoutée");
  await page.goto("/fr/produits/discovery-pc");
  await expect(
    page.getByRole("button", { name: "Ajouter au panier" }),
  ).toBeEnabled();
  await page.setViewportSize({ width: 320, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.goto("/fr/admin/produits");
  await expect(page.locator("tbody tr")).toHaveCount(13);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/private/tmp/unlock-admin-mobile.png",
    fullPage: true,
  });
});

test("stock changes block the preview without assigning keys or losing the server cart", async ({
  page,
}) => {
  await loginProfile(page);
  await page.goto("/fr/produits/unlock-pc");
  await page
    .getByRole("button", { name: "Ajouter au panier", exact: true })
    .click();
  await expect(page.locator(".toast")).toContainText(
    "Produit ajouté au panier",
  );
  const db = browserDatabase();
  const keys = await db.activationKey.findMany({
    where: {
      productId: "demo-product-unlock-0",
      disabledAt: null,
      assignment: null,
    },
    select: { id: true },
  });
  try {
    await db.activationKey.updateMany({
      where: { id: { in: keys.map((k) => k.id) } },
      data: { disabledAt: new Date() },
    });
    await page.goto("/fr/commande");
    await expect(
      page.getByRole("button", { name: "Simuler la commande", exact: true }),
    ).toBeDisabled();
    await expect(page.locator(".form-error")).toContainText(
      "Stock insuffisant",
    );
    expect(await db.keyAssignment.count()).toBe(3);
    await page.goto("/fr/panier");
    await expect(page.locator(".cart-item")).toHaveCount(1);
  } finally {
    await db.activationKey.updateMany({
      where: { id: { in: keys.map((k) => k.id) } },
      data: { disabledAt: null },
    });
    await db.$disconnect();
  }
});
