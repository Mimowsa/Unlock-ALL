import { randomUUID } from "node:crypto";
import type { Prisma, EmailKind } from "../../generated/prisma/client.ts";
import { emailConfig, allowedRecipient, type EmailEnv } from "./config.ts";
import { sealPayload } from "./payload.ts";
import { emailTemplate } from "./templates.ts";
import { keyVaultConfig, type KeyVaultConfig } from "../security/key-vault.ts";
export async function enqueueEmail(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    recipient: string;
    locale: "FR" | "EN";
    kind: EmailKind;
    idempotencyKey: string;
    orderId?: string;
    reset?: { id: string; token: string; name: string };
  },
  env: EmailEnv = process.env,
  vault?: KeyVaultConfig,
) {
  const config = emailConfig(env);
  if (!config || !allowedRecipient(config, input.recipient)) return null;
  const id = randomUUID();
  let encrypted: {} | ReturnType<typeof sealPayload> = {};
  if (input.kind === "PASSWORD_RESET") {
    if (!input.reset) throw new Error("Reset delivery requires a token");
    const url = new URL(
      `/${input.locale.toLowerCase()}/reinitialiser-mot-de-passe`,
      config.origin,
    );
    url.hash = input.reset.token;
    encrypted = sealPayload(
      id,
      {
        from: config.from,
        to: [input.recipient],
        ...emailTemplate({
          kind: input.kind,
          locale: input.locale,
          name: input.reset.name,
          url: url.href,
        }),
      },
      vault ?? keyVaultConfig(env),
    );
  }
  const job = await tx.emailJob.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    create: {
      id,
      userId: input.userId,
      recipient: input.recipient,
      locale: input.locale,
      kind: input.kind,
      idempotencyKey: input.idempotencyKey,
      orderId: input.orderId,
      resetTokenId: input.reset?.id,
      ...encrypted,
    },
    update: {},
    select: { id: true },
  });
  return job.id;
}
