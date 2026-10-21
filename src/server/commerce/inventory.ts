import type { PrismaClient } from "../../generated/prisma/client.ts";
import { CatalogFailure, lockAdministrator } from "../catalog/service.ts";
import { keyInput, keyUpdate } from "../../validation/commerce.ts";
import {
  sealKey,
  openKey,
  keyVaultConfig,
  type KeyVaultConfig,
} from "../security/key-vault.ts";
export class CommerceFailure extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
export async function listKeys(db: PrismaClient, productId: string, page = 1) {
  const product = await db.product.findFirst({
    where: { id: productId, isDemo: true },
    select: { id: true },
  });
  if (!product) throw new CommerceFailure("notFound", 404);
  const where = { productId, isDemo: true };
  const [keys, total, available] = await db.$transaction([
    db.activationKey.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * 25,
      take: 25,
      select: {
        id: true,
        reservation: { select: { checkoutId: true } },
        disabledAt: true,
        createdAt: true,
        assignment: {
          select: {
            orderItem: {
              select: { order: { select: { id: true, reference: true } } },
            },
          },
        },
      },
    }),
    db.activationKey.count({ where }),
    db.activationKey.count({
      where: {
        ...where,
        disabledAt: null,
        assignment: null,
        reservation: null,
      },
    }),
  ]);
  return {
    keys: keys.map((k) => ({
      id: k.id,
      label: `DEMO-••••-${k.id.slice(-8)}`,
      disabled: !!k.disabledAt,
      reserved: !!k.reservation,
      assigned: !!k.assignment,
      order: k.assignment?.orderItem.order ?? null,
    })),
    total,
    available,
    page,
  };
}
export async function addKey(
  db: PrismaClient,
  actorId: string,
  input: unknown,
  vault: KeyVaultConfig = keyVaultConfig(),
) {
  const parsed = keyInput.safeParse(input);
  if (!parsed.success) throw new CommerceFailure("invalidInput");
  const { productId, value } = parsed.data;
  const sealed = sealKey(value, vault);
  try {
    return await db.$transaction(async (tx) => {
      await lockAdministrator(tx, actorId);
      await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id"=${productId} FOR UPDATE`;
      if (
        !(await tx.product.findFirst({
          where: { id: productId, isDemo: true },
          select: { id: true },
        }))
      )
        throw new CommerceFailure("notFound", 404);
      const key = await tx.activationKey.create({
        data: { productId, isDemo: true, ...sealed },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          action: "inventory.key.add",
          entityType: "ActivationKey",
          entityId: key.id,
          details: { productId },
        },
      });
      return { id: key.id };
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002")
      throw new CommerceFailure("duplicateKey", 409);
    throw error;
  }
}
export async function changeKey(
  db: PrismaClient,
  actorId: string,
  id: string,
  input: unknown,
) {
  const parsed = keyUpdate.safeParse(input);
  if (!parsed.success) throw new CommerceFailure("invalidInput");
  return db.$transaction(async (tx) => {
    await lockAdministrator(tx, actorId);
    const key = await tx.activationKey.findFirst({
      where: { id, isDemo: true },
      select: { productId: true },
    });
    if (!key) throw new CommerceFailure("notFound", 404);
    await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id"=${key.productId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "ActivationKey" WHERE "id"=${id} FOR UPDATE`;
    const current = await tx.activationKey.findUniqueOrThrow({
      where: { id },
      select: {
        assignment: { select: { keyId: true } },
        reservation: { select: { keyId: true } },
      },
    });
    if (current.reservation) throw new CommerceFailure("keyReserved", 409);
    if (current.assignment) throw new CommerceFailure("keyAssigned", 409);
    await tx.activationKey.update({
      where: { id },
      data: { disabledAt: parsed.data.disabled ? new Date() : null },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        action: parsed.data.disabled
          ? "inventory.key.disable"
          : "inventory.key.enable",
        entityType: "ActivationKey",
        entityId: id,
        details: { productId: key.productId },
      },
    });
  });
}
export async function revealKey(
  db: PrismaClient,
  actorId: string,
  id: string,
  vault: KeyVaultConfig = keyVaultConfig(),
) {
  return db.$transaction(async (tx) => {
    await lockAdministrator(tx, actorId);
    const key = await tx.activationKey.findFirst({
      where: { id, isDemo: true },
      select: { ciphertext: true, encryptionKeyId: true },
    });
    if (!key) throw new CommerceFailure("notFound", 404);
    const value = openKey(key, vault);
    await tx.auditLog.create({
      data: {
        actorId,
        action: "inventory.key.view",
        entityType: "ActivationKey",
        entityId: id,
      },
    });
    return { value };
  });
}
