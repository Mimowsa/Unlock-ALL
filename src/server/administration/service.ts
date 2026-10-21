import type { PrismaClient } from "../../generated/prisma/client.ts";
import { CatalogFailure, lockAdministrator } from "../catalog/service.ts";
import { userUpdate } from "../../validation/catalog.ts";
const userSelect = {
  id: true,
  email: true,
  name: true,
  discordUsername: true,
  role: true,
  active: true,
  isDemo: true,
  updatedAt: true,
} as const;
export async function listUsers(db: PrismaClient, q = "", page = 1) {
  const where = q
    ? {
        OR: [
          { email: { contains: q, mode: "insensitive" as const } },
          { name: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};
  const [users, total] = await db.$transaction([
    db.user.findMany({
      where,
      select: userSelect,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * 25,
      take: 25,
    }),
    db.user.count({ where }),
  ]);
  return {
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      nickname: u.name ?? "Player",
      discord: u.discordUsername ?? "",
      role: u.role,
      active: u.active,
      isDemo: u.isDemo,
      updatedAt: u.updatedAt.toISOString(),
    })),
    total,
    page,
  };
}
export async function saveUser(
  db: PrismaClient,
  actorId: string,
  id: string,
  input: unknown,
) {
  const parsed = userUpdate.safeParse(input);
  if (!parsed.success) throw new CatalogFailure("invalidInput");
  return db.$transaction(async (tx) => {
    // Lock the shared guard first, then user rows, matching the security trigger's
    // lock order. Concurrent administrators cannot deadlock each other's accounts.
    await tx.$queryRaw`SELECT "id" FROM "AuthSecurityState" WHERE "id"='admin-roles' FOR UPDATE`;
    await lockAdministrator(tx, actorId);
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${id} FOR UPDATE`;
    const old = await tx.user.findUnique({ where: { id }, select: userSelect });
    if (!old) throw new CatalogFailure("notFound", 404);
    if (old.updatedAt.toISOString() !== parsed.data.updatedAt)
      throw new CatalogFailure("conflict", 409);
    if (old.isDemo) throw new CatalogFailure("invalidInput");
    await tx.user.update({
      where: { id },
      data: { role: parsed.data.role, active: parsed.data.active },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        action: "user.security.update",
        entityType: "User",
        entityId: id,
        details: {
          before: { role: old.role, active: old.active },
          after: { role: parsed.data.role, active: parsed.data.active },
        },
      },
    });
  });
}
export async function overview(db: PrismaClient) {
  return db.$transaction(
    async (tx) => {
      const users = await tx.user.count();
      const orders = await tx.order.count({ where: { mode: "DEMO" } });
      const completed = await tx.order.count({
        where: { mode: "DEMO", status: "COMPLETED" },
      });
      const failed = await tx.order.count({
        where: { mode: "DEMO", status: "FAILED" },
      });
      const available = await tx.product.count({
        where: {
          isDemo: true,
          status: "PUBLISHED",
          keys: {
            some: {
              disabledAt: null,
              assignment: null,
              reservation: null,
              isDemo: true,
            },
          },
        },
      });
      const soldOut = await tx.product.count({
        where: {
          isDemo: true,
          status: "PUBLISHED",
          keys: {
            none: {
              disabledAt: null,
              assignment: null,
              reservation: null,
              isDemo: true,
            },
          },
        },
      });
      const value = await tx.order.aggregate({
        where: { mode: "DEMO", status: "COMPLETED" },
        _sum: { totalCents: true },
      });
      const recentOrders = await tx.order.findMany({
        where: { mode: "DEMO" },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: {
          id: true,
          reference: true,
          customerEmail: true,
          createdAt: true,
          status: true,
          totalCents: true,
        },
      });
      return {
        users,
        orders,
        completed,
        failed,
        available,
        soldOut,
        valueCents: (value._sum.totalCents ?? 0n).toString(),
        recentOrders: recentOrders.map((o) => ({
          id: o.id,
          reference: o.reference,
          customer: o.customerEmail,
          date: o.createdAt.toISOString(),
          status: o.status,
          totalCents: o.totalCents.toString(),
        })),
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
