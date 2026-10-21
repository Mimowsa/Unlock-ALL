import {
  emailConfig,
  allowedRecipient,
  type EmailEnv,
} from "../email/config.ts";
import { enqueueEmail } from "../email/outbox.ts";
import type { KeyVaultConfig } from "../security/key-vault.ts";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { authOrigin, localResetEnabled } from "./config.ts";
import { createResetToken } from "./service.ts";
import type { PrismaClient } from "../../generated/prisma/client.ts";
export async function requestPasswordReset(
  db: PrismaClient,
  email: string,
  locale: "FR" | "EN",
  options: { env?: EmailEnv; vault?: KeyVaultConfig } = {},
) {
  const env = options.env ?? process.env,
    config = emailConfig(env);
  if (config) {
    if (allowedRecipient(config, email))
      await createResetToken(db, email, async (tx, issued) => {
        await enqueueEmail(
          tx,
          {
            userId: issued.userId,
            recipient: issued.email,
            locale,
            kind: "PASSWORD_RESET",
            idempotencyKey: `reset/${issued.id}`,
            reset: { id: issued.id, token: issued.token, name: issued.name },
          },
          env,
          options.vault,
        );
      });
    return { delivery: "email" as const };
  }
  // No token is issued when no real delivery mechanism is configured.
  if (!localResetEnabled()) return { delivery: "unavailable" as const };
  const issued = await createResetToken(db, email);
  if (issued) {
    const directory = resolve(
      process.env.AUTH_LOCAL_MAILBOX_DIR || ".local/password-reset",
    );
    const file = join(directory, `${issued.id}.json`);
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const url = new URL(
        `/${locale.toLowerCase()}/reinitialiser-mot-de-passe`,
        authOrigin(),
      );
      url.hash = issued.token;
      await writeFile(
        file,
        JSON.stringify(
          {
            recipient: issued.email,
            url: url.href,
            expiresAt: issued.expiresAt.toISOString(),
            emailSent: false,
          },
          null,
          2,
        ),
        { mode: 0o600, flag: "wx" },
      );
    } catch {
      await db.passwordResetToken.updateMany({
        where: { id: issued.id },
        data: { usedAt: new Date() },
      });
      await unlink(file).catch(() => {});
      throw new Error("Local password reset delivery unavailable.");
    }
  }
  // Identical response for registered, unknown, inactive and demo accounts.
  return { delivery: "local" as const };
}
