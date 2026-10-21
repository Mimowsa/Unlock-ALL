import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import {
  registrationSchema,
  loginSchema,
  resetPasswordSchema,
  profileSchema,
} from "../../validation/auth.ts";
import { passwordHash, passwordMatches } from "./password.ts";
import { enqueueEmail } from "../email/outbox.ts";
import type { EmailEnv } from "../email/config.ts";
import { AuthFailure, consumeRateLimit } from "./rate-limit.ts";
export const SESSION_SECONDS = 8 * 60 * 60;
export const tokenHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const publicUserSelect = {
  id: true,
  email: true,
  name: true,
  discordUsername: true,
  role: true,
  locale: true,
} as const;
export async function registerUser(
  db: PrismaClient,
  input: unknown,
  clientId: string,
  emailEnv: EmailEnv = process.env,
) {
  await consumeRateLimit(db, "register", clientId, 5, 3600);
  const parsed = registrationSchema.safeParse(input);
  if (!parsed.success) throw new AuthFailure("invalidInput");
  const { email, nickname, password, locale } = parsed.data;
  const encoded = await passwordHash(password);
  try {
    return await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          name: nickname,
          passwordHash: encoded,
          locale,
          role: "USER",
          active: true,
          isDemo: false,
        },
        select: publicUserSelect,
      });
      await enqueueEmail(
        tx,
        {
          userId: user.id,
          recipient: user.email,
          locale: user.locale,
          kind: "WELCOME",
          idempotencyKey: `welcome/${user.id}`,
        },
        emailEnv,
      );
      return user;
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002")
      throw new AuthFailure("accountUnavailable", 409);
    throw error;
  }
}
export async function authenticate(
  db: PrismaClient,
  input: unknown,
  clientId: string,
) {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return null;
  await consumeRateLimit(db, "login-network", clientId, 30, 900);
  await consumeRateLimit(db, "login-account", parsed.data.email, 6, 900);
  const user = await db.user.findUnique({
    where: { email: parsed.data.email },
  });
  const matches = await passwordMatches(
    user?.passwordHash ?? null,
    parsed.data.password,
  );
  if (!user || !matches || !user.active || user.isDemo) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    sessionVersion: user.sessionVersion,
  };
}
export async function createLoginSession(
  db: PrismaClient,
  user: { id: string; sessionVersion: number },
) {
  const sessionId = randomBytes(32).toString("hex");
  await db.session.create({
    data: {
      sessionToken: tokenHash(sessionId),
      userId: user.id,
      expires: new Date(Date.now() + SESSION_SECONDS * 1000),
    },
  });
  return sessionId;
}
export async function sessionUser(
  db: PrismaClient,
  token: { sub?: string; sessionId?: unknown; sessionVersion?: unknown } | null,
) {
  if (
    !token?.sub ||
    typeof token.sessionId !== "string" ||
    !/^[a-f0-9]{64}$/.test(token.sessionId) ||
    !Number.isInteger(token.sessionVersion)
  )
    return null;
  const session = await db.session.findUnique({
    where: { sessionToken: tokenHash(token.sessionId) },
    include: { user: true },
  });
  if (
    !session ||
    session.userId !== token.sub ||
    session.expires.getTime() <= Date.now() ||
    !session.user.active ||
    session.user.isDemo ||
    !session.user.passwordHash ||
    session.user.sessionVersion !== token.sessionVersion
  )
    return null;
  const u = session.user;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    discord: u.discordUsername ?? "",
    locale: u.locale,
  };
}
export async function revokeSession(db: PrismaClient, sessionId: string) {
  await db.session.deleteMany({
    where: { sessionToken: tokenHash(sessionId) },
  });
}
export async function createResetToken(
  db: PrismaClient,
  email: string,
  onCreate?: (
    tx: import("../../generated/prisma/client.ts").Prisma.TransactionClient,
    issued: {
      id: string;
      userId: string;
      email: string;
      name: string;
      token: string;
      expiresAt: Date;
    },
  ) => Promise<unknown>,
) {
  const user = await db.user.findUnique({ where: { email } });
  if (!user || !user.active || user.isDemo || !user.passwordHash) return null;
  const token = randomBytes(32).toString("hex");
  const record = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "User" WHERE "id"=${user.id} FOR UPDATE`;
    const current = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!current.active || current.isDemo || !current.passwordHash)
      throw new AuthFailure("invalidReset");
    await tx.emailJob.updateMany({
      where: {
        userId: user.id,
        kind: "PASSWORD_RESET",
        status: { in: ["PENDING", "RETRY"] },
      },
      data: {
        status: "FAILED",
        lastErrorCode: "RESET_SUPERSEDED",
        payloadCiphertext: null,
        payloadKeyId: null,
      },
    });
    await tx.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    const reset = await tx.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: tokenHash(token),
        expiresAt: new Date(Date.now() + 20 * 60 * 1000),
      },
    });
    if (onCreate)
      await onCreate(tx, {
        id: reset.id,
        userId: user.id,
        email: current.email,
        name: current.name ?? "",
        token,
        expiresAt: reset.expiresAt,
      });
    return reset;
  });
  return {
    id: record.id,
    email: user.email,
    token,
    expiresAt: record.expiresAt,
  };
}
export async function resetPassword(db: PrismaClient, input: unknown) {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) throw new AuthFailure("invalidReset");
  const hash = tokenHash(parsed.data.token);
  const candidate = await db.passwordResetToken.findUnique({
    where: { tokenHash: hash },
  });
  if (
    !candidate ||
    candidate.usedAt ||
    candidate.expiresAt.getTime() <= Date.now()
  )
    throw new AuthFailure("invalidReset");
  const encoded = await passwordHash(parsed.data.password);
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "User" WHERE "id"=${candidate.userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: candidate.userId } });
    if (!user || !user.active || user.isDemo)
      throw new AuthFailure("invalidReset");
    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: candidate.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) throw new AuthFailure("invalidReset");
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash: encoded },
    });
    await tx.session.deleteMany({ where: { userId: user.id } });
    await tx.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
  });
}
export async function updateProfile(
  db: PrismaClient,
  userId: string,
  input: unknown,
) {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) throw new AuthFailure("invalidInput");
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { active: true },
  });
  if (!user?.active) throw new AuthFailure("invalidCredentials", 401);
  return db.user.update({
    where: { id: userId },
    data: {
      name: parsed.data.nickname,
      discordUsername: parsed.data.discord || null,
    },
    select: publicUserSelect,
  });
}
