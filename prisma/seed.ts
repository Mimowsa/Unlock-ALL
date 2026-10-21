import nextEnv from "@next/env";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { initialState } from "../src/demo/fixtures.ts";
import { createDatabaseClient } from "../src/server/db/factory.ts";
import {
  keyVaultConfig,
  sealKey,
  openKey,
  type KeyVaultConfig,
} from "../src/server/security/key-vault.ts";
import { assertDemoSeedAllowed } from "../src/server/db/demo-seed-policy.ts";
nextEnv.loadEnvConfig(process.cwd());

export async function seedDemo(
  options: { connectionString?: string; vault?: KeyVaultConfig } = {},
) {
  assertDemoSeedAllowed();
  const connectionString = options.connectionString ?? process.env.DIRECT_URL;
  if (!connectionString) throw new Error("DIRECT_URL is required for seeding.");
  const vault = options.vault ?? keyVaultConfig();
  const db = createDatabaseClient(connectionString);
  const demo = initialState();
  try {
    await db.$transaction(
      async (tx) => {
        // Serialize concurrent seed runs; never reset stock or overwrite edits/assignments.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(731104, 3)`;
        await tx.siteSetting.upsert({
          where: { id: "site" },
          update: {},
          create: { id: "site", demoEnabled: false },
        });
        await tx.game.upsert({
          where: { id: "demo-game-cod" },
          update: {},
          create: {
            id: "demo-game-cod",
            slug: "call-of-duty",
            name: "Call of Duty",
          },
        });
        for (const [i, name] of ["PC", "PlayStation", "Xbox"].entries())
          await tx.platform.upsert({
            where: { id: `demo-platform-${i}` },
            update: {},
            create: {
              id: `demo-platform-${i}`,
              slug: name.toLowerCase(),
              name,
            },
          });
        const labels = {
          unlock: ["Unlock All", "Unlock All"],
          camos: ["Camouflages", "Camos"],
          weapons: ["Armes", "Weapons"],
          fullPack: ["Pack complet", "Complete pack"],
        } as const;
        for (const [slug, names] of Object.entries(labels)) {
          const id = `demo-category-${slug}`;
          await tx.category.upsert({
            where: { id },
            update: {},
            create: {
              id,
              slug,
              translations: {
                create: [
                  { locale: "FR", name: names[0] },
                  { locale: "EN", name: names[1] },
                ],
              },
            },
          });
        }
        for (const user of demo.users)
          await tx.user.upsert({
            where: { email: user.email },
            update: {},
            create: {
              id: `seed-${user.id}`,
              email: user.email,
              name: user.nickname,
              discordUsername: user.discord || null,
              role: user.role,
              active: user.role !== "ADMIN",
              isDemo: true,
              passwordHash: null,
            },
          });
        for (const product of demo.products) {
          const id = `demo-product-${product.id}`;
          const platformIndex = ["PC", "PlayStation", "Xbox"].indexOf(
            product.platform,
          );
          const legal = {
            fr: "Produit entièrement fictif. Aucun contenu de jeu débloqué, aucun logiciel de contournement.",
            en: "Entirely fictional product. No game content unlocked, no bypass software.",
          };
          await tx.product.upsert({
            where: { id },
            update: {},
            create: {
              id,
              slug: product.slug,
              priceCents: product.price,
              status: "PUBLISHED",
              isDemo: true,
              downloadUrl: product.download,
              categoryId: `demo-category-${product.category}`,
              gameId: "demo-game-cod",
              platformId: `demo-platform-${platformIndex}`,
              translations: {
                create: (["FR", "EN"] as const).map((locale) => {
                  const language = locale === "FR" ? "fr" : "en";
                  return {
                    locale,
                    slug: product.slug,
                    name: product.name[language],
                    shortDescription: product.description[language],
                    description: `${product.description[language]}\n\n${legal[language]}`,
                  };
                }),
              },
              images: {
                create: {
                  id: `demo-image-${product.id}`,
                  url: `/images/${product.art}.svg`,
                  position: 0,
                  translations: {
                    create: [
                      {
                        locale: "FR",
                        alt: `Illustration originale — ${product.name.fr}`,
                      },
                      {
                        locale: "EN",
                        alt: `Original illustration — ${product.name.en}`,
                      },
                    ],
                  },
                },
              },
            },
          });
        }
        // Deterministic IDs prevent a reseed from replenishing consumed/disabled keys.
        for (const key of demo.keys) {
          const id = `seed-${key.id}`;
          const existing = await tx.activationKey.findUnique({
            where: { id },
            select: {
              ciphertext: true,
              encryptionKeyId: true,
              fingerprint: true,
            },
          });
          if (existing) {
            if (
              openKey(existing, vault) !== key.value ||
              existing.fingerprint !== sealKey(key.value, vault).fingerprint
            )
              throw new Error(
                "Existing demo keys require their original encryption and fingerprint secrets.",
              );
          } else
            await tx.activationKey.create({
              data: {
                id,
                productId: `demo-product-${key.productId}`,
                ...sealKey(key.value, vault),
                isDemo: true,
              },
            });
        }
      },
      { timeout: 60000 },
    );
    const [products, users, keys] = await Promise.all([
      db.product.count({ where: { isDemo: true } }),
      db.user.count({ where: { isDemo: true } }),
      db.activationKey.count({ where: { isDemo: true } }),
    ]);
    console.log(
      `Demo seed complete: ${products} products, ${users} fictional profiles, ${keys} encrypted demo keys. No credentials or keys logged. Seeded admin has no password and is inactive.`,
    );
  } finally {
    await db.$disconnect();
  }
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  seedDemo().catch(() => {
    console.error(
      "Demo seed failed. Check the environment, database, migrations and encryption configuration. No secrets logged.",
    );
    process.exitCode = 1;
  });
