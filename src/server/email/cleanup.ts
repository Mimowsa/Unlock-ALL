import type { PrismaClient } from "../../generated/prisma/client.ts";
export async function cleanupEmailSecrets(db: PrismaClient) {
  const now = new Date();
  const expired = await db.emailJob.updateMany({
    where: {
      kind: "PASSWORD_RESET",
      status: { not: "SENT" },
      OR: [
        { resetToken: null },
        { resetToken: { usedAt: { not: null } } },
        { resetToken: { expiresAt: { lte: now } } },
      ],
    },
    data: {
      status: "FAILED",
      lastErrorCode: "RESET_EXPIRED",
      lockedUntil: null,
      lockToken: null,
      payloadCiphertext: null,
      payloadKeyId: null,
    },
  });
  const retired = await db.emailJob.updateMany({
    where: {
      status: "FAILED",
      firstAttemptAt: { lte: new Date(now.getTime() - 23 * 60 * 60 * 1000) },
      payloadCiphertext: { not: null },
    },
    data: { payloadCiphertext: null, payloadKeyId: null },
  });
  return {
    expiredResetEmails: expired.count,
    retiredEmailPayloads: retired.count,
  };
}
