import { cleanupEmailSecrets } from "../src/server/email/cleanup.ts";
import nextEnv from "@next/env";
import { createDatabaseClient } from "../src/server/db/factory.ts";
import { readdir, readFile, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
nextEnv.loadEnvConfig(process.cwd());
if (!process.env.DIRECT_URL) throw new Error("DIRECT_URL is required.");
const db = createDatabaseClient(process.env.DIRECT_URL);
try {
  const now = new Date();
  const emailCleanup = await cleanupEmailSecrets(db);
  const [sessions, tokens, limits, carts] = await db.$transaction([
    db.session.deleteMany({ where: { expires: { lte: now } } }),
    db.passwordResetToken.deleteMany({ where: { expiresAt: { lte: now } } }),
    db.authRateLimit.deleteMany({ where: { expiresAt: { lte: now } } }),
    db.cart.deleteMany({ where: { expiresAt: { lte: now } } }),
  ]);
  let messages = 0;
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    const directory = resolve(
      process.env.AUTH_LOCAL_MAILBOX_DIR || ".local/password-reset",
    );
    for (const name of await readdir(directory).catch(() => [])) {
      if (!/^[a-zA-Z0-9_-]+\.json$/.test(name)) continue;
      const file = join(directory, name);
      try {
        const message = JSON.parse(await readFile(file, "utf8"));
        if (
          typeof message.expiresAt === "string" &&
          Date.parse(message.expiresAt) <= now.getTime()
        ) {
          await unlink(file);
          messages++;
        }
      } catch {
        /* Invalid files are preserved for operator review. */
      }
    }
  }
  console.log(
    JSON.stringify(
      {
        ...emailCleanup,
        expiredSessions: sessions.count,
        expiredResetTokens: tokens.count,
        expiredLimits: limits.count,
        expiredGuestCarts: carts.count,
        expiredLocalMessages: messages,
      },
      null,
      2,
    ),
  );
} catch {
  console.error("Authentication cleanup unavailable. No credentials logged.");
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
