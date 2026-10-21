import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { PrismaClient, Prisma } from "../../generated/prisma/client.ts";
import { orderInput } from "../../validation/orders.ts";
import { CommerceFailure } from "../commerce/inventory.ts";
import { lockOwner, lockCart, cartFingerprint } from "../commerce/cart.ts";
import {
  keyVaultConfig,
  openKey,
  type KeyVaultConfig,
} from "../security/key-vault.ts";
import { enqueueEmail } from "../email/outbox.ts";
import type { EmailEnv } from "../email/config.ts";
import { paypalEnabled, decimalAmount, approvalUrl } from "./config.ts";
import { openMerchant } from "./crypto.ts";
import { paypalAPI, PayPalFailure, type PayPalAPI } from "./api.ts";
import { verifyOrder, verifiedCapture } from "./verify.ts";
const line = z.object({
  productId: z.string(),
  fr: z.string(),
  en: z.string(),
  platform: z.string(),
  game: z.string(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().int().nonnegative(),
  download: z.string().nullable(),
});
const snapshotSchema = z.array(line).min(1).max(100);
export type PayPalOptions = {
  env?: EmailEnv;
  vault?: KeyVaultConfig;
  api?: (merchantId: string) => PayPalAPI;
};
const include = { merchant: true, order: { select: { id: true } } } as const;
type Checkout = Prisma.PayPalCheckoutGetPayload<{ include: typeof include }>;
function dto(row: Checkout) {
  return {
    id: row.id,
    status: row.status,
    amountCents: Number(row.amountCents),
    expiresAt: row.expiresAt.toISOString(),
    approvalUrl: row.status === "APPROVAL_PENDING" ? row.approvalUrl : null,
    orderId: row.order?.id ?? null,
    reference: row.paypalOrderId,
    environment: "sandbox" as const,
  };
}
function apiFor(row: Checkout, options: PayPalOptions) {
  return (
    options.api?.(row.merchantId) ??
    paypalAPI(openMerchant(row.merchant, options.vault ?? keyVaultConfig()))
  );
}
async function owned(db: PrismaClient, userId: string, id: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { active: true, isDemo: true, passwordHash: true },
  });
  if (!user?.active || user.isDemo || !user.passwordHash)
    throw new CommerceFailure("forbidden", 401);
  const row = await db.payPalCheckout.findFirst({
    where: { id, userId },
    include,
  });
  if (!row) throw new CommerceFailure("notFound", 404);
  return row;
}
export async function readPayPalCheckout(
  db: PrismaClient,
  userId: string,
  id: string,
) {
  return dto(await owned(db, userId, id));
}
export async function preparePayPalCheckout(
  db: PrismaClient,
  userId: string,
  input: unknown,
  options: PayPalOptions = {},
) {
  const parsed = orderInput.safeParse(input);
  if (!parsed.success) throw new CommerceFailure("invalidInput");
  const request = parsed.data;
  const hash = createHash("sha256")
    .update(JSON.stringify(request))
    .digest("hex");
  const id = await db.$transaction(
    async (tx) => {
      await lockOwner(tx, { userId });
      const old = await tx.payPalCheckout.findUnique({
        where: {
          userId_idempotencyKey: {
            userId,
            idempotencyKey: request.idempotencyKey,
          },
        },
      });
      if (old) {
        if (old.requestHash !== hash)
          throw new CommerceFailure("orderConflict", 409);
        return old.id;
      }
      if (!paypalEnabled(options.env))
        throw new CommerceFailure("paypalUnavailable", 403);
      const setting = await tx.payPalSetting.findUnique({
        where: { id: "site" },
        include: { activeMerchant: true },
      });
      if (!setting || setting.activeMerchant.environment !== "sandbox")
        throw new CommerceFailure("paypalUnavailable", 503);
      const cart = await lockCart(tx, { userId });
      if (cart.revision !== request.cartRevision)
        throw new CommerceFailure("cartConflict", 409);
      let items = await tx.cartItem.findMany({
        where: { cartId: cart.id },
        orderBy: { productId: "asc" },
        include: {
          product: {
            include: { translations: true, platform: true, game: true },
          },
        },
      });
      if (!items.length) throw new CommerceFailure("emptyError", 409);
      const ids = items
        .map((i) => i.productId)
        .sort((a, b) => a.localeCompare(b));
      for (const productId of ids)
        await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id"=${productId} FOR UPDATE`;
      items = await tx.cartItem.findMany({
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
      if (
        items.some(
          (i) =>
            !i.product.isDemo ||
            i.product.status !== "PUBLISHED" ||
            i.product.currency !== "EUR",
        )
      )
        throw new CommerceFailure("stockError", 409);
      const snapshot = items.map((i) => ({
        productId: i.productId,
        fr:
          i.product.translations.find((t) => t.locale === "FR")?.name ??
          i.product.slug,
        en:
          i.product.translations.find((t) => t.locale === "EN")?.name ??
          i.product.slug,
        platform: i.product.platform.name,
        game: i.product.game.name,
        quantity: i.quantity,
        unitPrice: i.product.priceCents,
        download: i.product.downloadUrl,
      }));
      const amount = snapshot.reduce(
        (s, i) => s + BigInt(i.quantity) * BigInt(i.unitPrice),
        0n,
      );
      if (amount <= 0n || amount > BigInt(Number.MAX_SAFE_INTEGER))
        throw new CommerceFailure("invalidInput");
      const checkoutId = randomUUID(),
        user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const origin = new URL(
        (options.env ?? process.env).NEXTAUTH_URL || "http://127.0.0.1:3000",
      );
      if (
        origin.username ||
        origin.password ||
        !["https:", "http:"].includes(origin.protocol) ||
        (origin.protocol === "http:" &&
          !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname))
      )
        throw new CommerceFailure("paypalUnavailable", 503);
      const returnUrl = new URL(
        `/${request.locale.toLowerCase()}/commande/paypal/${checkoutId}`,
        origin.origin,
      ).href;
      const body = {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: "default",
            custom_id: checkoutId,
            invoice_id: `UA-SB-${checkoutId}`,
            payee: { merchant_id: setting.activeMerchant.merchantId },
            amount: { currency_code: "EUR", value: decimalAmount(amount) },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: "UNLOCK-ALL Sandbox",
              shipping_preference: "NO_SHIPPING",
              user_action: "PAY_NOW",
              return_url: returnUrl,
              cancel_url: returnUrl + "?canceled=1",
            },
          },
        },
      };
      await tx.payPalCheckout.create({
        data: {
          id: checkoutId,
          userId,
          merchantId: setting.activeMerchantId,
          idempotencyKey: request.idempotencyKey,
          requestHash: hash,
          amountCents: amount,
          locale: request.locale,
          discordUsername: request.discord,
          customerEmail: user.email,
          cartRevision: cart.revision,
          cartFingerprint: request.cartFingerprint,
          snapshot,
          requestBody: body,
          expiresAt: new Date(Date.now() + 30 * 60000),
        },
      });
      const vault = options.vault ?? keyVaultConfig();
      for (const item of snapshot) {
        const keys = await tx.$queryRaw<
          { id: string; ciphertext: string; encryptionKeyId: string }[]
        >`SELECT k."id",k."ciphertext",k."encryptionKeyId" FROM "ActivationKey" k WHERE k."productId"=${item.productId} AND k."isDemo"=true AND k."disabledAt" IS NULL AND NOT EXISTS(SELECT 1 FROM "KeyAssignment" a WHERE a."keyId"=k."id") AND NOT EXISTS(SELECT 1 FROM "KeyReservation" r WHERE r."keyId"=k."id") ORDER BY k."createdAt",k."id" LIMIT ${item.quantity} FOR UPDATE OF k`;
        if (keys.length !== item.quantity)
          throw new CommerceFailure("stockError", 409);
        for (let index = 0; index < keys.length; index++) {
          try {
            openKey(keys[index], vault);
          } catch {
            throw new CommerceFailure("deliveryUnavailable", 503);
          }
          await tx.keyReservation.create({
            data: {
              keyId: keys[index].id,
              checkoutId,
              productId: item.productId,
              unitIndex: index + 1,
            },
          });
        }
      }
      return checkoutId;
    },
    { maxWait: 10000, timeout: 30000 },
  );
  return createRemoteOrder(db, userId, id, options);
}
async function lease(db: PrismaClient, id: string) {
  const token = randomUUID();
  const claimed = await db.payPalCheckout.updateMany({
    where: {
      id,
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
    },
    data: { leaseToken: token, leaseUntil: new Date(Date.now() + 60000) },
  });
  if (!claimed.count) throw new CommerceFailure("paypalBusy", 409);
  return token;
}
async function release(db: PrismaClient, id: string, token: string) {
  await db.payPalCheckout.updateMany({
    where: { id, leaseToken: token },
    data: { leaseToken: null, leaseUntil: null },
  });
}
async function createRemoteOrder(
  db: PrismaClient,
  userId: string,
  id: string,
  options: PayPalOptions,
) {
  let row = await owned(db, userId, id);
  if (row.status !== "CREATING") return dto(row);
  const token = await lease(db, id);
  try {
    row = await owned(db, userId, id);
    if (row.status !== "CREATING") return dto(row);
    if (row.expiresAt <= new Date()) {
      await expireCheckout(db, id, token);
      return readPayPalCheckout(db, userId, id);
    }
    const raw = await apiFor(row, options).request(
        "/v2/checkout/orders",
        "POST",
        row.requestBody,
        `create-${row.id}`,
      ),
      data = verifyOrder(raw, row);
    const link = data.links?.find(
      (l) => l.rel === "payer-action" || l.rel === "approve",
    );
    if (!link) throw new PayPalFailure("PAYPAL_RESPONSE");
    const url = approvalUrl(link.href);
    await db.payPalCheckout.update({
      where: { id, leaseToken: token },
      data: {
        paypalOrderId: data.id,
        approvalUrl: url,
        status: "APPROVAL_PENDING",
        errorCode: null,
      },
    });
    return readPayPalCheckout(db, userId, id);
  } catch (error) {
    if (error instanceof PayPalFailure) {
      await db.payPalCheckout.update({
        where: { id, leaseToken: token },
        data: {
          errorCode: error.code,
          ...(!error.retryable ? { status: "NEEDS_REVIEW" } : {}),
        },
      });
      throw new CommerceFailure("paypalUnavailable", 503);
    }
    throw error;
  } finally {
    await release(db, id, token);
  }
}
export async function expireCheckout(
  db: PrismaClient,
  id: string,
  leaseToken?: string,
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "PayPalCheckout" WHERE "id"=${id} FOR UPDATE`;
    const row = await tx.payPalCheckout.findUniqueOrThrow({ where: { id } });
    if (
      ["CREATING", "APPROVAL_PENDING"].includes(row.status) &&
      !row.captureStartedAt &&
      row.expiresAt <= new Date() &&
      (!row.leaseUntil ||
        row.leaseUntil <= new Date() ||
        (leaseToken !== undefined && row.leaseToken === leaseToken))
    ) {
      await tx.payPalCheckout.update({
        where: { id },
        data: { status: "EXPIRED" },
      });
      await tx.keyReservation.deleteMany({ where: { checkoutId: id } });
    }
  });
}
export async function fulfillPayPal(
  db: PrismaClient,
  userId: string,
  id: string,
  options: PayPalOptions = {},
) {
  return db.$transaction(
    async (tx) => {
      await lockOwner(tx, { userId });
      await tx.$queryRaw`SELECT "id" FROM "PayPalCheckout" WHERE "id"=${id} FOR UPDATE`;
      const checkout = await tx.payPalCheckout.findFirst({
        where: { id, userId },
        include: { order: { select: { id: true } } },
      });
      if (!checkout) throw new CommerceFailure("notFound", 404);
      if (checkout.order) return checkout.order.id;
      if (checkout.status !== "VERIFIED" || !checkout.captureId)
        throw new CommerceFailure("paypalPending", 409);
      const lines = snapshotSchema.parse(checkout.snapshot);
      for (const productId of lines
        .map((i) => i.productId)
        .sort((a, b) => a.localeCompare(b)))
        await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id"=${productId} FOR UPDATE`;
      const reservations = await tx.keyReservation.findMany({
        where: { checkoutId: id },
        include: { key: true },
        orderBy: { unitIndex: "asc" },
      });
      for (const item of lines) {
        const keys = reservations.filter((k) => k.productId === item.productId);
        if (keys.length !== item.quantity || keys.some((k) => k.key.disabledAt))
          throw new CommerceFailure("paypalReview", 409);
        for (const key of keys)
          openKey(key.key, options.vault ?? keyVaultConfig());
      }
      const order = await tx.order.create({
        data: {
          reference: `UA-SB-${id.toUpperCase()}`,
          userId,
          idempotencyKey: `paypal-${id}`,
          requestHash: checkout.requestHash,
          mode: "DEMO",
          paymentProvider: "PAYPAL_SANDBOX",
          paypalCheckoutId: id,
          paymentStatus: "VERIFIED",
          locale: checkout.locale,
          customerEmail: checkout.customerEmail,
          discordUsername: checkout.discordUsername,
          subtotalCents: checkout.amountCents,
          totalCents: checkout.amountCents,
        },
      });
      const orderItems: { id: string }[] = [];
      for (const item of lines)
        orderItems.push(
          await tx.orderItem.create({
            data: {
              orderId: order.id,
              productId: item.productId,
              productNameFr: item.fr,
              productNameEn: item.en,
              platformName: item.platform,
              gameName: item.game,
              quantity: item.quantity,
              unitPriceCents: item.unitPrice,
              lineTotalCents: BigInt(item.quantity) * BigInt(item.unitPrice),
              downloadUrl: item.download,
            },
          }),
        );
      await tx.orderEvent.create({
        data: { orderId: order.id, type: "CREATED" },
      });
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
      for (let index = 0; index < lines.length; index++) {
        const keys = reservations.filter(
          (r) => r.productId === lines[index].productId,
        );
        await tx.keyAssignment.createMany({
          data: keys.map((k) => ({
            keyId: k.keyId,
            productId: k.productId,
            unitIndex: k.unitIndex,
            orderItemId: orderItems[index].id,
          })),
        });
      }
      await tx.orderEvent.create({
        data: { orderId: order.id, type: "KEYS_ASSIGNED" },
      });
      await tx.order.update({
        where: { id: order.id },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      await tx.orderEvent.create({
        data: { orderId: order.id, type: "DELIVERED" },
      });
      await tx.payPalCheckout.update({
        where: { id },
        data: { status: "FULFILLED", errorCode: null },
      });
      await tx.keyReservation.deleteMany({ where: { checkoutId: id } });
      const cart = await lockCart(tx, { userId });
      const current = await tx.cartItem.findMany({
        where: { cartId: cart.id },
        include: { product: true },
      });
      if (
        cart.revision === checkout.cartRevision &&
        cartFingerprint(current) === checkout.cartFingerprint
      ) {
        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
        await tx.cart.update({
          where: { id: cart.id },
          data: { revision: { increment: 1 } },
        });
      }
      for (const kind of ["ORDER_CONFIRMATION", "KEY_DELIVERY"] as const)
        await enqueueEmail(
          tx,
          {
            userId,
            recipient: checkout.customerEmail,
            locale: checkout.locale,
            kind,
            orderId: order.id,
            idempotencyKey: `${kind.toLowerCase()}/${order.id}`,
          },
          options.env ?? process.env,
        );
      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: "paypal.sandbox.fulfilled",
          entityType: "Order",
          entityId: order.id,
          details: { checkoutId: id },
        },
      });
      return order.id;
    },
    { maxWait: 10000, timeout: 30000 },
  );
}
export async function reconcilePayPal(
  db: PrismaClient,
  userId: string,
  id: string,
  options: PayPalOptions = {},
  cancel = false,
) {
  let row = await owned(db, userId, id);
  if (row.order && row.captureId) {
    const api = apiFor(row, options),
      capture = (await api.request(
        `/v2/payments/captures/${row.captureId}`,
      )) as {
        id?: string;
        status?: string;
        amount?: { currency_code?: string; value?: string };
      };
    if (
      capture.id !== row.captureId ||
      capture.amount?.currency_code !== "EUR" ||
      capture.amount.value !== decimalAmount(row.amountCents)
    )
      throw new CommerceFailure("paypalReview", 409);
    if (
      ["REFUNDED", "PARTIALLY_REFUNDED", "REVERSED"].includes(
        capture.status ?? "",
      )
    )
      await db.payPalCheckout.update({
        where: { id },
        data: { status: capture.status! },
      });
    return readPayPalCheckout(db, userId, id);
  }
  if (
    row.order ||
    [
      "EXPIRED",
      "CANCELED",
      "DECLINED",
      "REFUNDED",
      "PARTIALLY_REFUNDED",
      "REVERSED",
    ].includes(row.status)
  )
    return dto(row);
  if (row.status === "VERIFIED") {
    await fulfillPayPal(db, userId, id, options);
    return readPayPalCheckout(db, userId, id);
  }
  if (row.status === "CREATING")
    return createRemoteOrder(db, userId, id, options);
  const token = await lease(db, id);
  try {
    row = await owned(db, userId, id);
    if (row.order) return dto(row);
    if (!row.paypalOrderId) throw new CommerceFailure("paypalReview", 409);
    const api = apiFor(row, options);
    let remote = verifyOrder(
      await api.request(`/v2/checkout/orders/${row.paypalOrderId}`),
      row,
    );
    if (
      cancel &&
      !row.captureStartedAt &&
      ["CREATED", "APPROVED", "PAYER_ACTION_REQUIRED"].includes(remote.status)
    ) {
      await db.$transaction(async (tx) => {
        await tx.payPalCheckout.update({
          where: { id, leaseToken: token },
          data: { status: "CANCELED" },
        });
        await tx.keyReservation.deleteMany({ where: { checkoutId: id } });
      });
      return readPayPalCheckout(db, userId, id);
    }
    if (cancel && row.captureStartedAt && remote.status !== "COMPLETED")
      return readPayPalCheckout(db, userId, id);
    if (remote.status === "APPROVED" && row.status !== "NEEDS_REVIEW") {
      if (!row.captureStartedAt && row.expiresAt <= new Date()) {
        await db.payPalCheckout.update({
          where: { id, leaseToken: token },
          data: { status: "EXPIRED" },
        });
        await db.keyReservation.deleteMany({ where: { checkoutId: id } });
        return readPayPalCheckout(db, userId, id);
      }
      if (
        row.captureStartedAt &&
        Date.now() - row.captureStartedAt.getTime() > 5 * 3600000
      )
        throw new PayPalFailure("PAYPAL_RECONCILIATION_REQUIRED", false);
      await db.payPalCheckout.update({
        where: { id, leaseToken: token },
        data: {
          status: "CAPTURING",
          captureStartedAt: row.captureStartedAt ?? new Date(),
        },
      });
      await api.request(
        `/v2/checkout/orders/${row.paypalOrderId}/capture`,
        "POST",
        {},
        `capture-${id}`,
      );
      // Capture responses can omit purchase-unit identity fields. Re-read the
      // complete server representation before treating the payment as verified.
      remote = verifyOrder(
        await api.request(`/v2/checkout/orders/${row.paypalOrderId}`),
        row,
      );
    }
    const capture = verifiedCapture(remote, row.amountCents);
    if (capture?.status === "COMPLETED") {
      await db.payPalCheckout.update({
        where: { id, leaseToken: token },
        data: { status: "VERIFIED", captureId: capture.id, errorCode: null },
      });
      await fulfillPayPal(db, userId, id, options);
    } else if (capture && ["REFUNDED", "REVERSED"].includes(capture.status)) {
      await db.$transaction(async (tx) => {
        await tx.payPalCheckout.update({
          where: { id, leaseToken: token },
          data: { status: capture.status, captureId: capture.id },
        });
        await tx.keyReservation.deleteMany({ where: { checkoutId: id } });
      });
    } else if (capture?.status === "PARTIALLY_REFUNDED") {
      await db.payPalCheckout.update({
        where: { id, leaseToken: token },
        data: {
          status: "NEEDS_REVIEW",
          captureId: capture.id,
          errorCode: "PAYPAL_PARTIAL_REFUND",
        },
      });
    } else if (
      (capture && ["DECLINED", "DENIED", "FAILED"].includes(capture.status)) ||
      remote.status === "VOIDED"
    ) {
      await db.$transaction(async (tx) => {
        await tx.payPalCheckout.update({
          where: { id, leaseToken: token },
          data: { status: "DECLINED", errorCode: "PAYPAL_DECLINED" },
        });
        await tx.keyReservation.deleteMany({ where: { checkoutId: id } });
      });
    } else if (cancel && remote.status === "CREATED") {
      await db.$transaction(async (tx) => {
        await tx.payPalCheckout.update({
          where: { id, leaseToken: token },
          data: { status: "CANCELED" },
        });
        await tx.keyReservation.deleteMany({ where: { checkoutId: id } });
      });
    } else if (
      row.expiresAt <= new Date() &&
      !row.captureStartedAt &&
      remote.status !== "COMPLETED"
    ) {
      await db.$transaction(async (tx) => {
        await tx.payPalCheckout.update({
          where: { id, leaseToken: token },
          data: { status: "EXPIRED" },
        });
        await tx.keyReservation.deleteMany({ where: { checkoutId: id } });
      });
    }
    return readPayPalCheckout(db, userId, id);
  } catch (error) {
    if (error instanceof PayPalFailure) {
      await db.payPalCheckout.update({
        where: { id, leaseToken: token },
        data: {
          errorCode: error.code,
          ...(!error.retryable ? { status: "NEEDS_REVIEW" } : {}),
        },
      });
      throw new CommerceFailure(
        error.retryable ? "paypalPending" : "paypalReview",
        503,
      );
    }
    throw error;
  } finally {
    await release(db, id, token);
  }
}
