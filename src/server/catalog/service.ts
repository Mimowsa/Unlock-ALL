import type { PrismaClient, Prisma } from "../../generated/prisma/client.ts";
import type { Product } from "../../demo/types.ts";
import {
  assertProductImage,
  productImagePath,
} from "../media/product-images.ts";
import { productInput, productUpdate } from "../../validation/catalog.ts";

export class CatalogFailure extends Error {
  code: "invalidInput" | "notFound" | "conflict" | "forbidden" | "lastAdmin";
  status: number;
  constructor(code: CatalogFailure["code"], status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
export const productSelect = {
  id: true,
  slug: true,
  priceCents: true,
  currency: true,
  isDemo: true,
  status: true,
  downloadUrl: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { slug: true } },
  platform: { select: { name: true } },
  translations: { select: { locale: true, name: true, description: true } },
  _count: {
    select: {
      keys: {
        where: {
          isDemo: true,
          disabledAt: null,
          assignment: null,
          reservation: null,
        },
      },
    },
  },
  images: { orderBy: { position: "asc" }, take: 1, select: { url: true } },
} satisfies Prisma.ProductSelect;
type Row = Prisma.ProductGetPayload<{ select: typeof productSelect }>;
export function productDto(row: Row): Product {
  const translation = (locale: "FR" | "EN") =>
    row.translations.find((t) => t.locale === locale);
  const image = row.images[0]?.url;
  const art =
    ["operator", "camo", "weapon", "complete"].find(
      (a) => image === `/images/${a}.svg`,
    ) ?? "operator";
  return {
    id: row.id,
    slug: row.slug,
    price: row.priceCents,
    name: {
      fr: translation("FR")?.name ?? row.slug,
      en: translation("EN")?.name ?? row.slug,
    },
    description: {
      fr: translation("FR")?.description ?? "",
      en: translation("EN")?.description ?? "",
    },
    platform: row.platform.name as Product["platform"],
    category: row.category.slug as Product["category"],
    art: art as Product["art"],
    ...(image && productImagePath.test(image) ? { image } : {}),
    published: row.status === "PUBLISHED",
    availableStock: row._count.keys,
    // Public product data never contains key ciphertext, fingerprints or credentials.
    download: row.downloadUrl ?? "/downloads/demo/unlock-all-demo.txt",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
export async function listProducts(db: PrismaClient, admin = false) {
  return (
    await db.product.findMany({
      where: { isDemo: true, ...(admin ? {} : { status: "PUBLISHED" }) },
      select: productSelect,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    })
  ).map(productDto);
}
export async function publishedProduct(db: PrismaClient, slug: string) {
  const row = await db.product.findFirst({
    where: { slug, isDemo: true, status: "PUBLISHED" },
    select: productSelect,
  });
  return row ? productDto(row) : null;
}
export async function lockAdministrator(
  tx: Prisma.TransactionClient,
  actorId: string,
) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${actorId} FOR UPDATE`;
  const actor = await tx.user.findUnique({
    where: { id: actorId },
    select: { role: true, active: true, isDemo: true, passwordHash: true },
  });
  if (
    !actor ||
    actor.role !== "ADMIN" ||
    !actor.active ||
    actor.isDemo ||
    !actor.passwordHash
  )
    throw new CatalogFailure("forbidden", 403);
}
export async function saveProduct(
  db: PrismaClient,
  actorId: string,
  input: unknown,
  id?: string,
) {
  const parsed = id
    ? productUpdate.safeParse(input)
    : productInput.safeParse(input);
  if (!parsed.success) throw new CatalogFailure("invalidInput");
  const data = parsed.data;
  if (data.image) {
    try {
      await assertProductImage(data.image);
    } catch {
      throw new CatalogFailure("invalidInput");
    }
  }
  return db.$transaction(async (tx) => {
    await lockAdministrator(tx, actorId);
    if (id) {
      await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id"=${id} FOR UPDATE`;
      const old = await tx.product.findUnique({
        where: { id },
        select: { updatedAt: true, isDemo: true },
      });
      if (!old?.isDemo) throw new CatalogFailure("notFound", 404);
      if (
        old.updatedAt.toISOString() !==
        ("updatedAt" in data ? data.updatedAt : undefined)
      )
        throw new CatalogFailure("conflict", 409);
    }
    const category = await tx.category.findUnique({
      where: { slug: data.category },
      select: { id: true },
    });
    const platform = await tx.platform.findUnique({
      where: { slug: data.platform.toLowerCase() },
      select: { id: true },
    });
    const game = await tx.game.findUnique({
      where: { slug: "call-of-duty" },
      select: { id: true },
    });
    if (!category || !platform || !game)
      throw new CatalogFailure("invalidInput");
    const scalar = {
      slug: data.slug,
      priceCents: data.price,
      status: data.published ? ("PUBLISHED" as const) : ("DRAFT" as const),
      downloadUrl: data.download,
      categoryId: category.id,
      platformId: platform.id,
      gameId: game.id,
    };
    const product = id
      ? await tx.product.update({ where: { id }, data: scalar })
      : await tx.product.create({ data: { ...scalar, isDemo: true } });
    for (const locale of ["FR", "EN"] as const) {
      const lang = locale === "FR" ? "fr" : "en";
      const translation = {
        slug: data.slug,
        name: data.name[lang],
        shortDescription: data.description[lang].slice(0, 500),
        description: data.description[lang],
      };
      await tx.productTranslation.upsert({
        where: { productId_locale: { productId: product.id, locale } },
        update: translation,
        create: { productId: product.id, locale, ...translation },
      });
    }
    const image = await tx.productImage.upsert({
      where: { productId_position: { productId: product.id, position: 0 } },
      update: { url: data.image ?? `/images/${data.art}.svg` },
      create: {
        productId: product.id,
        position: 0,
        url: data.image ?? `/images/${data.art}.svg`,
      },
    });
    for (const locale of ["FR", "EN"] as const) {
      const alt = `${locale === "FR" ? "Illustration originale" : "Original illustration"} — ${data.name[locale === "FR" ? "fr" : "en"]}`;
      await tx.productImageTranslation.upsert({
        where: { imageId_locale: { imageId: image.id, locale } },
        update: { alt },
        create: { imageId: image.id, locale, alt },
      });
    }
    await tx.auditLog.create({
      data: {
        actorId,
        action: id ? "product.update" : "product.create",
        entityType: "Product",
        entityId: product.id,
        details: {
          slug: data.slug,
          status: scalar.status,
          priceCents: data.price,
        },
      },
    });
    return productDto(
      await tx.product.findUniqueOrThrow({
        where: { id: product.id },
        select: productSelect,
      }),
    );
  });
}
