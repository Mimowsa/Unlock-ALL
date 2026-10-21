import { randomBytes, createHash } from "node:crypto";
import type { PrismaClient, Prisma } from "../../generated/prisma/client.ts";
import { productSelect, productDto } from "../catalog/service.ts";
import { cartMutation } from "../../validation/commerce.ts";
import { CommerceFailure } from "./inventory.ts";
export type CartOwner =
  | { userId: string; guestToken?: never }
  | { guestToken: string; userId?: never };
export const GUEST_CART_SECONDS = 30 * 24 * 60 * 60;
export const newGuestToken = () => randomBytes(32).toString("hex");
export const guestHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export async function lockOwner(
  tx: Prisma.TransactionClient,
  owner: CartOwner,
) {
  if (owner.userId) {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${owner.userId} FOR UPDATE`;
    const user = await tx.user.findUnique({
      where: { id: owner.userId },
      select: { active: true, isDemo: true, passwordHash: true },
    });
    if (!user?.active || user.isDemo || !user.passwordHash)
      throw new CommerceFailure("forbidden", 401);
  }
}
export async function lockCart(tx: Prisma.TransactionClient, owner: CartOwner) {
  const cart = owner.userId
    ? await tx.cart.upsert({
        where: { userId: owner.userId },
        update: {},
        create: { userId: owner.userId },
      })
    : await tx.cart.upsert({
        where: { guestTokenHash: guestHash(owner.guestToken!) },
        update: {},
        create: {
          guestTokenHash: guestHash(owner.guestToken!),
          expiresAt: new Date(Date.now() + GUEST_CART_SECONDS * 1000),
        },
      });
  await tx.$queryRaw`SELECT "id" FROM "Cart" WHERE "id"=${cart.id} FOR UPDATE`;
  const current = await tx.cart.findUniqueOrThrow({ where: { id: cart.id } });
  if (current.expiresAt && current.expiresAt <= new Date())
    throw new CommerceFailure("cartExpired", 409);
  return current;
}
export async function cartDto(tx: Prisma.TransactionClient, id: string) {
  const cart = await tx.cart.findUniqueOrThrow({
    where: { id },
    include: {
      items: {
        orderBy: { productId: "asc" },
        include: { product: { select: productSelect } },
      },
    },
  });
  const fingerprint = cartFingerprint(cart.items);
  const products = cart.items.map((i) => productDto(i.product));
  const valid = cart.items.every(
    (i) =>
      i.product.isDemo !== false &&
      i.product.status === "PUBLISHED" &&
      i.quantity <= i.product._count.keys,
  );
  return {
    items: cart.items.map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
    })),
    products,
    revision: cart.revision,
    fingerprint,
    valid,
    totalCents: cart.items.reduce(
      (sum, i) => sum + i.quantity * i.product.priceCents,
      0,
    ),
  };
}
export async function readCart(db: PrismaClient, owner: CartOwner) {
  return db.$transaction(async (tx) => {
    await lockOwner(tx, owner);
    const cart = await lockCart(tx, owner);
    return cartDto(tx, cart.id);
  });
}
export async function mutateCart(
  db: PrismaClient,
  owner: CartOwner,
  input: unknown,
) {
  const parsed = cartMutation.safeParse(input);
  if (!parsed.success) throw new CommerceFailure("invalidInput");
  const data = parsed.data;
  return db.$transaction(async (tx) => {
    await lockOwner(tx, owner);
    const cart = await lockCart(tx, owner);
    if (data.operation === "set" && data.revision !== cart.revision)
      throw new CommerceFailure("cartConflict", 409);
    await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id"=${data.productId} FOR UPDATE`;
    const old = await tx.cartItem.findUnique({
      where: {
        cartId_productId: { cartId: cart.id, productId: data.productId },
      },
    });
    const quantity =
      data.operation === "add"
        ? (old?.quantity ?? 0) + data.quantity
        : data.quantity;
    if (quantity) {
      const product = await tx.product.findFirst({
        where: { id: data.productId, isDemo: true, status: "PUBLISHED" },
        select: productSelect,
      });
      if (!product || quantity > product._count.keys || quantity > 1000)
        throw new CommerceFailure("stockLimit", 409);
      if (
        !old &&
        (await tx.cartItem.count({ where: { cartId: cart.id } })) >= 100
      )
        throw new CommerceFailure("cartLimit", 409);
      await tx.cartItem.upsert({
        where: {
          cartId_productId: { cartId: cart.id, productId: data.productId },
        },
        create: { cartId: cart.id, productId: data.productId, quantity },
        update: { quantity },
      });
    } else
      await tx.cartItem.deleteMany({
        where: { cartId: cart.id, productId: data.productId },
      });
    await tx.cart.update({
      where: { id: cart.id },
      data: { revision: { increment: 1 } },
    });
    return cartDto(tx, cart.id);
  });
}
export async function mergeGuestCart(
  db: PrismaClient,
  userId: string,
  guestToken?: string,
) {
  return db.$transaction(async (tx) => {
    await lockOwner(tx, { userId });
    const cart = await lockCart(tx, { userId });
    let adjusted = false;
    const guest = guestToken
      ? await tx.cart.findUnique({
          where: { guestTokenHash: guestHash(guestToken) },
        })
      : null;
    if (guest) {
      await tx.$queryRaw`SELECT "id" FROM "Cart" WHERE "id"=${guest.id} FOR UPDATE`;
      // Re-read after waiting: another request may already have consumed this cart.
      const remaining = await tx.cart.findUnique({
        where: { id: guest.id },
        include: { items: true },
      });
      if (remaining && remaining.expiresAt! > new Date()) {
        for (const item of remaining.items.sort((a, b) =>
          a.productId.localeCompare(b.productId),
        )) {
          await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id"=${item.productId} FOR UPDATE`;
          const product = await tx.product.findFirst({
            where: { id: item.productId, isDemo: true, status: "PUBLISHED" },
            select: productSelect,
          });
          const old = await tx.cartItem.findUnique({
            where: {
              cartId_productId: { cartId: cart.id, productId: item.productId },
            },
          });
          if (
            !old &&
            (await tx.cartItem.count({ where: { cartId: cart.id } })) >= 100
          ) {
            adjusted = true;
            continue;
          }
          const requested = (old?.quantity ?? 0) + item.quantity;
          const quantity = Math.min(requested, product?._count.keys ?? 0, 1000);
          if (quantity !== requested) adjusted = true;
          if (quantity)
            await tx.cartItem.upsert({
              where: {
                cartId_productId: {
                  cartId: cart.id,
                  productId: item.productId,
                },
              },
              create: { cartId: cart.id, productId: item.productId, quantity },
              update: { quantity },
            });
          else
            await tx.cartItem.deleteMany({
              where: { cartId: cart.id, productId: item.productId },
            });
        }
      }
      if (remaining) await tx.cart.delete({ where: { id: guest.id } });
      await tx.cart.update({
        where: { id: cart.id },
        data: { revision: { increment: 1 } },
      });
    }
    return { ...(await cartDto(tx, cart.id)), adjusted };
  });
}
export async function validateCart(db: PrismaClient, userId: string) {
  return db.$transaction(async (tx) => {
    await lockOwner(tx, { userId });
    const cart = await lockCart(tx, { userId });
    const items = await tx.cartItem.findMany({
      where: { cartId: cart.id },
      orderBy: { productId: "asc" },
    });
    if (!items.length) throw new CommerceFailure("emptyError", 409);
    for (const item of items)
      await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id"=${item.productId} FOR UPDATE`;
    const result = await cartDto(tx, cart.id);
    if (!result.valid) throw new CommerceFailure("stockError", 409);
    return result;
  });
}

export function cartFingerprint(
  items: {
    productId: string;
    quantity: number;
    product: { priceCents: number; currency: string };
  }[],
) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        [...items]
          .sort((a, b) => a.productId.localeCompare(b.productId))
          .map((i) => [
            i.productId,
            i.quantity,
            i.product.priceCents,
            i.product.currency,
          ]),
      ),
    )
    .digest("hex");
}
