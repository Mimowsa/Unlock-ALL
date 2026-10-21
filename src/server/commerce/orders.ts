import { orderEmailStatus } from "../email/status.ts";
import { enqueueEmail } from "../email/outbox.ts";
import type { EmailEnv } from "../email/config.ts";
import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "../../generated/prisma/client.ts";
import { orderInput } from "../../validation/orders.ts";
import { lockOwner, lockCart, cartFingerprint } from "./cart.ts";
import { CommerceFailure } from "./inventory.ts";
import { assertDemoCheckout } from "./demo-policy.ts";
import {
  openKey,
  keyVaultConfig,
  type KeyVaultConfig,
} from "../security/key-vault.ts";
import type { OrderSummary, OrderView } from "../../types/orders.ts";
const summarySelect = {
  id: true,
  reference: true,
  userId: true,
  status: true,
  createdAt: true,
  totalCents: true,
  customerEmail: true,
} as const;
const visibleStatus = (status: string): "completed" | "failed" =>
  status === "COMPLETED" ? "completed" : "failed";
function money(value: bigint) {
  const result = Number(value);
  if (!Number.isSafeInteger(result))
    throw new CommerceFailure("unavailable", 503);
  return result;
}
function summary(
  row: Prisma.OrderGetPayload<{ select: typeof summarySelect }>,
  admin = false,
): OrderSummary {
  return {
    id: row.id,
    reference: row.reference,
    date: row.createdAt.toISOString(),
    total: money(row.totalCents),
    status: visibleStatus(row.status),
    ...(admin ? { customer: row.customerEmail } : {}),
  };
}
export async function createOrder(
  db: PrismaClient,
  userId: string,
  input: unknown,
  options: {
    env?: Readonly<Record<string, string | undefined>>;
    emailEnv?: EmailEnv;
    vault?: KeyVaultConfig;
  } = {},
) {
  const parsed = orderInput.safeParse(input);
  if (!parsed.success) throw new CommerceFailure("invalidInput");
  const request = parsed.data;
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify([
        request.cartRevision,
        request.cartFingerprint,
        request.discord,
        request.locale,
        request.consent,
      ]),
    )
    .digest("hex");
  return db.$transaction(
    async (tx) => {
      await lockOwner(tx, { userId });
      const existing = await tx.order.findUnique({
        where: {
          userId_idempotencyKey: {
            userId,
            idempotencyKey: request.idempotencyKey,
          },
        },
        select: { ...summarySelect, requestHash: true },
      });
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new CommerceFailure("orderConflict", 409);
        return { order: summary(existing), replayed: true };
      }
      await tx.$queryRaw`SELECT "id" FROM "SiteSetting" WHERE "id"='site' FOR SHARE`;
      const site = await tx.siteSetting.findUnique({
        where: { id: "site" },
        select: { demoEnabled: true },
      });
      assertDemoCheckout(site?.demoEnabled === true, options.env);
      const cart = await lockCart(tx, { userId });
      if (cart.revision !== request.cartRevision)
        throw new CommerceFailure("cartConflict", 409);
      const rows = await tx.cartItem.findMany({
        where: { cartId: cart.id },
        include: {
          product: {
            include: { translations: true, platform: true, game: true },
          },
        },
      });
      if (!rows.length) throw new CommerceFailure("emptyError", 409);
      rows.sort((a, b) => a.productId.localeCompare(b.productId));
      for (const row of rows)
        await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id"=${row.productId} FOR UPDATE`;
      // Re-read prices, publication and translations only after locking the products.
      const items = await tx.cartItem.findMany({
        where: { cartId: cart.id },
        orderBy: { productId: "asc" },
        include: {
          product: {
            include: { translations: true, platform: true, game: true },
          },
        },
      });
      if (cartFingerprint(items) !== request.cartFingerprint)
        throw new CommerceFailure("cartConflict", 409);
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { email: true, discordUsername: true },
      });
      const total = items.reduce(
        (sum, i) => sum + BigInt(i.product.priceCents) * BigInt(i.quantity),
        0n,
      );
      const order = await tx.order.create({
        data: {
          reference: `UA-DEMO-${randomUUID().toUpperCase()}`,
          userId,
          idempotencyKey: request.idempotencyKey,
          requestHash,
          mode: "DEMO",
          paymentStatus: "NOT_REQUIRED",
          locale: request.locale,
          currency: "EUR",
          customerEmail: user.email,
          discordUsername: request.discord,
          subtotalCents: total,
          totalCents: total,
        },
      });
      await tx.orderEvent.create({
        data: { orderId: order.id, type: "CREATED" },
      });
      const lines: { id: string }[] = [];
      for (const item of items) {
        const fr = item.product.translations.find((t) => t.locale === "FR");
        const en = item.product.translations.find((t) => t.locale === "EN");
        lines.push(
          await tx.orderItem.create({
            data: {
              orderId: order.id,
              productId: item.productId,
              productNameFr: fr?.name ?? item.product.slug,
              productNameEn: en?.name ?? item.product.slug,
              platformName: item.product.platform.name,
              gameName: item.product.game.name,
              unitPriceCents: item.product.priceCents,
              quantity: item.quantity,
              lineTotalCents:
                BigInt(item.product.priceCents) * BigInt(item.quantity),
              downloadUrl: item.product.downloadUrl,
            },
          }),
        );
      }
      let failure: string | null = null;
      const selected: {
        id: string;
        productId: string;
        ciphertext: string;
        encryptionKeyId: string;
      }[][] = [];
      for (const item of items) {
        if (
          !item.product.isDemo ||
          item.product.status !== "PUBLISHED" ||
          item.product.currency !== "EUR"
        ) {
          failure = "STOCK_UNAVAILABLE";
          break;
        }
        const keys = await tx.$queryRaw<
          {
            id: string;
            productId: string;
            ciphertext: string;
            encryptionKeyId: string;
          }[]
        >`SELECT k."id",k."productId",k."ciphertext",k."encryptionKeyId" FROM "ActivationKey" k WHERE k."productId"=${item.productId} AND k."isDemo"=true AND k."disabledAt" IS NULL AND NOT EXISTS(SELECT 1 FROM "KeyAssignment" a WHERE a."keyId"=k."id") AND NOT EXISTS(SELECT 1 FROM "KeyReservation" r WHERE r."keyId"=k."id") ORDER BY k."createdAt",k."id" LIMIT ${item.quantity} FOR UPDATE OF k`;
        if (keys.length !== item.quantity) {
          failure = "STOCK_UNAVAILABLE";
          break;
        }
        selected.push(keys);
      }
      if (!failure) {
        const vault = options.vault ?? keyVaultConfig();
        try {
          for (const group of selected)
            for (const key of group) openKey(key, vault);
        } catch {
          failure = "DELIVERY_UNAVAILABLE";
        }
      }
      if (failure) {
        await tx.order.update({
          where: { id: order.id },
          data: {
            status:
              failure === "STOCK_UNAVAILABLE" ? "FAILED" : "NEEDS_ATTENTION",
            failureCode: failure,
          },
        });
        await tx.orderEvent.create({
          data: {
            orderId: order.id,
            type:
              failure === "STOCK_UNAVAILABLE"
                ? "FAILED"
                : "INTERVENTION_REQUESTED",
            details: { code: failure },
          },
        });
      } else {
        await tx.order.update({
          where: { id: order.id },
          data: { status: "VALIDATED" },
        });
        await tx.orderEvent.create({
          data: { orderId: order.id, type: "VALIDATED" },
        });
        await tx.order.update({
          where: { id: order.id },
          data: { status: "ASSIGNING" },
        });
        for (let index = 0; index < lines.length; index++)
          await tx.keyAssignment.createMany({
            data: selected[index].map((key, unit) => ({
              keyId: key.id,
              productId: key.productId,
              orderItemId: lines[index].id,
              unitIndex: unit + 1,
            })),
          });
        await tx.orderEvent.create({
          data: { orderId: order.id, type: "KEYS_ASSIGNED" },
        });
        await tx.order.update({
          where: { id: order.id },
          data: { status: "DELIVERING" },
        });
        await tx.order.update({
          where: { id: order.id },
          data: { status: "COMPLETED", completedAt: new Date() },
        });
        await tx.orderEvent.create({
          data: { orderId: order.id, type: "DELIVERED" },
        });
        for (const kind of ["ORDER_CONFIRMATION", "KEY_DELIVERY"] as const)
          await enqueueEmail(
            tx,
            {
              userId,
              recipient: user.email,
              orderId: order.id,
              locale: request.locale,
              kind,
              idempotencyKey: `${kind.toLowerCase()}/${order.id}`,
            },
            options.emailEnv ?? process.env,
          );
        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
        await tx.cart.update({
          where: { id: cart.id },
          data: { revision: { increment: 1 } },
        });
      }
      if (user.discordUsername !== request.discord)
        await tx.user.update({
          where: { id: userId },
          data: { discordUsername: request.discord },
        });
      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: failure ? "order.demo.failed" : "order.demo.completed",
          entityType: "Order",
          entityId: order.id,
          details: { ...(failure ? { code: failure } : {}) },
        },
      });
      return {
        order: summary(
          await tx.order.findUniqueOrThrow({
            where: { id: order.id },
            select: summarySelect,
          }),
        ),
        replayed: false,
      };
    },
    { maxWait: 10000, timeout: 30000 },
  );
}
async function readAccess(db: PrismaClient, userId: string, admin: boolean) {
  const actor = await db.user.findUnique({
    where: { id: userId },
    select: { active: true, isDemo: true, passwordHash: true, role: true },
  });
  if (
    !actor?.active ||
    actor.isDemo ||
    !actor.passwordHash ||
    (admin && actor.role !== "ADMIN")
  )
    throw new CommerceFailure("forbidden", 403);
}
export async function listOrders(
  db: PrismaClient,
  userId: string,
  options: {
    admin?: boolean;
    page?: number;
    q?: string;
    status?: "completed" | "failed" | "";
  } = {},
) {
  const { admin = false, page = 1, q = "", status = "" } = options;
  await readAccess(db, userId, admin);
  const where: Prisma.OrderWhereInput = {
    mode: "DEMO",
    ...(admin ? {} : { userId }),
    ...(status === "completed"
      ? { status: "COMPLETED" }
      : status === "failed"
        ? { status: { not: "COMPLETED" } }
        : {}),
    ...(admin && q
      ? {
          OR: [
            { reference: { contains: q, mode: "insensitive" } },
            { customerEmail: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [rows, total] = await db.$transaction([
    db.order.findMany({
      where,
      select: summarySelect,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * 25,
      take: 25,
    }),
    db.order.count({ where }),
  ]);
  return { orders: rows.map((row) => summary(row, admin)), total, page };
}
export async function orderDetails(
  db: PrismaClient,
  userId: string,
  id: string,
  admin = false,
  vault: KeyVaultConfig = keyVaultConfig(),
): Promise<OrderView> {
  await readAccess(db, userId, admin);
  const order = await db.order.findFirst({
    where: { id, mode: "DEMO", ...(admin ? {} : { userId }) },
    include: {
      paypalCheckout: {
        select: {
          status: true,
          captureId: true,
          merchant: { select: { label: true } },
        },
      },
      emailJobs: {
        where: { kind: { in: ["ORDER_CONFIRMATION", "KEY_DELIVERY"] } },
        select: {
          kind: true,
          status: true,
          attempts: true,
          lastErrorCode: true,
        },
      },
      items: {
        orderBy: { id: "asc" },
        include: {
          assignments: {
            orderBy: { unitIndex: "asc" },
            include: {
              key: { select: { ciphertext: true, encryptionKeyId: true } },
            },
          },
        },
      },
      events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
  });
  if (!order) throw new CommerceFailure("notFound", 404);
  let items: OrderView["items"];
  try {
    items = order.items.map((item) => ({
      id: item.id,
      name: { fr: item.productNameFr, en: item.productNameEn },
      platform: item.platformName,
      unitPrice: item.unitPriceCents,
      quantity: item.quantity,
      keys:
        order.status === "COMPLETED"
          ? item.assignments.map((a) => openKey(a.key, vault))
          : [],
      download:
        order.status === "COMPLETED" && item.downloadUrl
          ? `/api/orders/${encodeURIComponent(id)}/download/${encodeURIComponent(item.id)}`
          : null,
    }));
  } catch {
    throw new CommerceFailure("deliveryUnavailable", 503);
  }
  await db.auditLog.create({
    data: {
      actorId: userId,
      action: admin ? "order.admin.view" : "order.customer.view",
      entityType: "Order",
      entityId: id,
    },
  });
  return {
    ...summary(order, admin),
    paypal: order.paypalCheckout
      ? {
          status: order.paypalCheckout.status,
          ...(admin
            ? {
                captureId: order.paypalCheckout.captureId,
                account: order.paypalCheckout.merchant.label,
              }
            : {}),
        }
      : null,
    email: {
      status: orderEmailStatus(order.emailJobs, order.customerEmail),
      ...(admin ? { jobs: order.emailJobs } : {}),
    },
    items,
    events: order.events.map((e) => ({
      type: e.type,
      date: e.createdAt.toISOString(),
    })),
  };
}
export async function orderDownload(
  db: PrismaClient,
  userId: string,
  id: string,
  itemId: string,
  admin = false,
) {
  await readAccess(db, userId, admin);
  const item = await db.orderItem.findFirst({
    where: {
      id: itemId,
      orderId: id,
      order: {
        mode: "DEMO",
        status: "COMPLETED",
        ...(admin ? {} : { userId }),
      },
    },
    select: { downloadUrl: true },
  });
  if (!item || item.downloadUrl !== "/downloads/demo/unlock-all-demo.txt")
    throw new CommerceFailure("notFound", 404);
  return item.downloadUrl;
}
