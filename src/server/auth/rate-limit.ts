import { createHmac } from "node:crypto";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { authSecret } from "./config.ts";
export class AuthFailure extends Error {
  code:
    | "invalidCredentials"
    | "rateLimited"
    | "invalidInput"
    | "accountUnavailable"
    | "invalidReset"
    | "unavailable";
  status: number;
  constructor(code: AuthFailure["code"], status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
export async function consumeRateLimit(
  db: PrismaClient,
  scope: string,
  identifier: string,
  limit: number,
  windowSeconds: number,
) {
  const key = createHmac("sha256", authSecret())
    .update(`${scope}:${identifier}`)
    .digest("hex");
  const rows = await db.$queryRaw<
    { hits: number }[]
  >`INSERT INTO "AuthRateLimit" ("key", "hits", "expiresAt") VALUES (${key}, 1, now() + ${windowSeconds} * interval '1 second') ON CONFLICT ("key") DO UPDATE SET "hits" = CASE WHEN "AuthRateLimit"."expiresAt" <= now() THEN 1 ELSE "AuthRateLimit"."hits" + 1 END, "expiresAt" = CASE WHEN "AuthRateLimit"."expiresAt" <= now() THEN now() + ${windowSeconds} * interval '1 second' ELSE "AuthRateLimit"."expiresAt" END RETURNING "hits"`;
  if (rows[0].hits > limit) throw new AuthFailure("rateLimited", 429);
}
