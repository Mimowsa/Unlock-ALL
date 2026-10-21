import { cleanupEmailSecrets } from "./cleanup.ts";
import { randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "../../generated/prisma/client.ts";
import {
  emailConfig,
  allowedRecipient,
  type EmailEnv,
  type EmailConfig,
} from "./config.ts";
import { sendResend, DeliveryFailure, type SendEmail } from "./resend.ts";
import { openPayload, sealPayload, type EmailPayload } from "./payload.ts";
import { emailTemplate } from "./templates.ts";
import {
  keyVaultConfig,
  openKey,
  type KeyVaultConfig,
} from "../security/key-vault.ts";
const RETRY_WINDOW = 23 * 60 * 60 * 1000;
const jobInclude = {
  user: true,
  resetToken: true,
  order: {
    include: {
      items: {
        orderBy: { id: "asc" as const },
        include: {
          assignments: {
            orderBy: { unitIndex: "asc" as const },
            include: { key: true },
          },
        },
      },
    },
  },
} as const;
type Job = Prisma.EmailJobGetPayload<{ include: typeof jobInclude }>;
function validJob(job: Job) {
  if (
    !job.user.active ||
    job.user.isDemo ||
    !job.user.passwordHash ||
    job.recipient !== job.user.email
  )
    throw new DeliveryFailure("RECIPIENT_UNAVAILABLE", false);
  if (
    job.kind === "PASSWORD_RESET" &&
    (!job.resetToken ||
      job.resetToken.userId !== job.userId ||
      job.resetToken.usedAt ||
      job.resetToken.expiresAt.getTime() <= Date.now())
  )
    throw new DeliveryFailure("RESET_EXPIRED", false);
  if (
    (job.kind === "ORDER_CONFIRMATION" || job.kind === "KEY_DELIVERY") &&
    (!job.order ||
      job.order.userId !== job.userId ||
      job.order.status !== "COMPLETED" ||
      job.order.mode !== "DEMO" ||
      job.order.customerEmail !== job.recipient)
  )
    throw new DeliveryFailure("ORDER_UNAVAILABLE", false);
}
function makePayload(
  job: Job,
  config: EmailConfig,
  vault: KeyVaultConfig,
): EmailPayload {
  validJob(job);
  if (job.payloadCiphertext && job.payloadKeyId)
    return openPayload(
      job.id,
      {
        payloadCiphertext: job.payloadCiphertext,
        payloadKeyId: job.payloadKeyId,
      },
      vault,
    );
  if (job.kind === "PASSWORD_RESET")
    throw new DeliveryFailure("RESET_PAYLOAD_UNAVAILABLE", false);
  const locale = job.locale.toLowerCase(),
    order = job.order;
  return {
    from: config.from,
    to: [job.recipient],
    ...emailTemplate({
      kind: job.kind,
      locale: job.locale,
      name: job.user.name ?? "",
      url: new URL(
        `/${locale}/${order ? `compte/commandes/${order.id}` : "compte"}`,
        config.origin,
      ).href,
      ...(order
        ? {
            reference: order.reference,
            totalCents: order.totalCents,
            items: order.items.map((i) => ({
              name: job.locale === "FR" ? i.productNameFr : i.productNameEn,
              quantity: i.quantity,
              unitPriceCents: i.unitPriceCents,
              ...(job.kind === "KEY_DELIVERY"
                ? { keys: i.assignments.map((a) => openKey(a.key, vault)) }
                : {}),
            })),
          }
        : {}),
    }),
  };
}
export async function runEmailJobs(
  db: PrismaClient,
  options: {
    env?: EmailEnv;
    vault?: KeyVaultConfig;
    send?: SendEmail;
    limit?: number;
    pauseMs?: number;
    userId?: string;
  } = {},
) {
  const env = options.env ?? process.env,
    config = emailConfig(env);
  const result = {
    processed: 0,
    sent: 0,
    retry: 0,
    failed: 0,
    disabled: !config,
  };
  if (!config) return result;
  const workerToken = randomUUID(),
    now = new Date();
  await db.emailWorkerLease.createMany({
    data: [{ id: "dispatch" }],
    skipDuplicates: true,
  });
  const lease = await db.emailWorkerLease.updateMany({
    where: {
      id: "dispatch",
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
    },
    data: { token: workerToken, lockedUntil: new Date(now.getTime() + 90000) },
  });
  if (!lease.count) return result;
  try {
    await cleanupEmailSecrets(db);
    const vault = options.vault ?? keyVaultConfig(env),
      send = options.send ?? sendResend;
    for (
      let index = 0;
      index < Math.max(1, Math.min(5, options.limit ?? 3));
      index++
    ) {
      const token = randomUUID();
      const job = await db.$transaction(async (tx) => {
        const candidates = options.userId
          ? await tx.$queryRaw<
              { id: string }[]
            >`SELECT "id" FROM "EmailJob" WHERE "userId"=${options.userId} AND (("status" IN ('PENDING','RETRY') AND "nextAttemptAt"<=now()) OR ("status"='PROCESSING' AND "lockedUntil"<now())) ORDER BY CASE WHEN "kind"='PASSWORD_RESET' THEN 0 ELSE 1 END,"createdAt","id" LIMIT 1 FOR UPDATE SKIP LOCKED`
          : await tx.$queryRaw<
              { id: string }[]
            >`SELECT "id" FROM "EmailJob" WHERE (("status" IN ('PENDING','RETRY') AND "nextAttemptAt"<=now()) OR ("status"='PROCESSING' AND "lockedUntil"<now())) ORDER BY CASE WHEN "kind"='PASSWORD_RESET' THEN 0 ELSE 1 END,"createdAt","id" LIMIT 1 FOR UPDATE SKIP LOCKED`;
        if (!candidates.length) return null;
        const row = await tx.emailJob.findUniqueOrThrow({
          where: { id: candidates[0].id },
        });
        if (
          row.attempts >= row.maxAttempts ||
          (row.firstAttemptAt &&
            Date.now() - row.firstAttemptAt.getTime() >= RETRY_WINDOW)
        ) {
          await tx.emailJob.update({
            where: { id: row.id },
            data: {
              status: "FAILED",
              lockedUntil: null,
              lockToken: null,
              lastErrorCode: "RECONCILIATION_REQUIRED",
              payloadCiphertext: null,
              payloadKeyId: null,
            },
          });
          return { stopped: true as const };
        }
        return {
          stopped: false as const,
          value: await tx.emailJob.update({
            where: { id: row.id },
            data: {
              status: "PROCESSING",
              attempts: { increment: 1 },
              lockToken: token,
              lockedUntil: new Date(Date.now() + 60000),
              firstAttemptAt: row.firstAttemptAt ?? new Date(),
            },
            include: jobInclude,
          }),
        };
      });
      if (!job) break;
      result.processed++;
      if (job.stopped) {
        result.failed++;
        continue;
      }
      const row = job.value;
      try {
        if (!allowedRecipient(config, row.recipient))
          throw new DeliveryFailure("RECIPIENT_RESTRICTED", false);
        let payload: EmailPayload;
        try {
          payload = makePayload(row, config, vault);
        } catch (error) {
          throw error instanceof DeliveryFailure
            ? error
            : new DeliveryFailure("PAYLOAD_UNAVAILABLE", false);
        }
        // A frozen retry must retain the exact original recipient, sender and body.
        if (
          payload.to.length !== 1 ||
          payload.to[0] !== row.recipient ||
          payload.from !== config.from
        )
          throw new DeliveryFailure("CONFIGURATION_CHANGED", false);
        if (!row.payloadCiphertext) {
          const persisted = await db.emailJob.updateMany({
            where: { id: row.id, status: "PROCESSING", lockToken: token },
            data: sealPayload(row.id, payload, vault),
          });
          if (!persisted.count) break;
        }
        const messageId = await send(payload, row.idempotencyKey, config);
        const updated = await db.emailJob.updateMany({
          where: { id: row.id, status: "PROCESSING", lockToken: token },
          data: {
            status: "SENT",
            sentAt: new Date(),
            providerMessageId: messageId,
            lastErrorCode: null,
            lockedUntil: null,
            lockToken: null,
            payloadCiphertext: null,
            payloadKeyId: null,
          },
        });
        if (updated.count) result.sent++;
      } catch (error) {
        const failure =
          error instanceof DeliveryFailure
            ? error
            : new DeliveryFailure("DELIVERY_STORAGE_UNAVAILABLE", true);
        const retry =
          failure.retryable &&
          row.attempts < row.maxAttempts &&
          Date.now() - (row.firstAttemptAt?.getTime() ?? Date.now()) <
            RETRY_WINDOW;
        await db.$transaction(async (tx) => {
          const updated = await tx.emailJob.updateMany({
            where: { id: row.id, status: "PROCESSING", lockToken: token },
            data: {
              status: retry ? "RETRY" : "FAILED",
              nextAttemptAt: new Date(
                Date.now() +
                  [60000, 300000, 900000, 3600000, 7200000][
                    Math.min(row.attempts - 1, 4)
                  ],
              ),
              lastErrorCode: failure.code,
              lockedUntil: null,
              lockToken: null,
              ...(!retry &&
              [
                "RESET_EXPIRED",
                "RECIPIENT_UNAVAILABLE",
                "RECIPIENT_RESTRICTED",
                "ORDER_UNAVAILABLE",
              ].includes(failure.code)
                ? { payloadCiphertext: null, payloadKeyId: null }
                : {}),
            },
          });
          if (updated.count && row.orderId)
            await tx.orderEvent.create({
              data: {
                orderId: row.orderId,
                type: "EMAIL_FAILED",
                details: { jobId: row.id, code: failure.code, retry },
              },
            });
        });
        result[retry ? "retry" : "failed"]++;
      }
      if (index < Math.min(5, options.limit ?? 3) - 1)
        await new Promise((resolve) =>
          setTimeout(resolve, options.pauseMs ?? 600),
        );
    }
  } finally {
    await db.emailWorkerLease.updateMany({
      where: { id: "dispatch", token: workerToken },
      data: { token: null, lockedUntil: null },
    });
  }
  return result;
}
