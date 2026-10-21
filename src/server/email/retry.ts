import type { PrismaClient } from "../../generated/prisma/client.ts";
import { CommerceFailure } from "../commerce/inventory.ts";
import { emailConfig, allowedRecipient, type EmailEnv } from "./config.ts";
export async function retryOrderEmails(
  db: PrismaClient,
  actorId: string,
  orderId: string,
  env: EmailEnv = process.env,
) {
  return db.$transaction(async (tx) => {
    const actor = await tx.user.findUnique({
      where: { id: actorId },
      select: { role: true, active: true, isDemo: true, passwordHash: true },
    });
    if (
      actor?.role !== "ADMIN" ||
      !actor.active ||
      actor.isDemo ||
      !actor.passwordHash
    )
      throw new CommerceFailure("forbidden", 403);
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { mode: true, status: true, customerEmail: true },
    });
    if (!order || order.mode !== "DEMO" || order.status !== "COMPLETED")
      throw new CommerceFailure("notFound", 404);
    if (!allowedRecipient(emailConfig(env), order.customerEmail))
      throw new CommerceFailure("emailUnavailable", 409);
    const jobs = await tx.emailJob.findMany({
      where: {
        orderId,
        kind: { in: ["ORDER_CONFIRMATION", "KEY_DELIVERY"] },
        status: { in: ["FAILED", "RETRY"] },
      },
    });
    let count = 0;
    for (const job of jobs) {
      if (
        job.attempts >= job.maxAttempts ||
        job.lastErrorCode === "RECONCILIATION_REQUIRED" ||
        (job.firstAttemptAt &&
          Date.now() - job.firstAttemptAt.getTime() >= 23 * 60 * 60 * 1000)
      )
        continue;
      const changed = await tx.emailJob.updateMany({
        where: { id: job.id, status: job.status, attempts: job.attempts },
        data: { status: "RETRY", nextAttemptAt: new Date() },
      });
      count += changed.count;
    }
    if (!count) throw new CommerceFailure("emailReviewRequired", 409);
    await tx.auditLog.create({
      data: {
        actorId,
        action: "email.order.retry",
        entityType: "Order",
        entityId: orderId,
        details: { count },
      },
    });
    return { queued: count };
  });
}
