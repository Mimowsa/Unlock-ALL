import { randomUUID, createHmac } from "node:crypto";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import type { KeyVaultConfig } from "../security/key-vault.ts";
import { sealMerchant, openMerchant } from "./crypto.ts";
export async function activateMerchant(
  db: PrismaClient,
  credentials: { clientId: string; secret: string },
  merchantId: string,
  label: string,
  vault: KeyVaultConfig,
  webhookId?: string,
) {
  const fingerprint = createHmac("sha256", vault.fingerprintSecret)
    .update(credentials.clientId)
    .digest("hex");
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(11335422)`;
    let merchant = await tx.payPalMerchant.findUnique({
      where: { fingerprint },
    });
    if (!merchant) {
      const id = randomUUID();
      merchant = await tx.payPalMerchant.create({
        data: {
          id,
          label,
          merchantId,
          clientId: credentials.clientId,
          ...sealMerchant(id, credentials, vault),
          ...(webhookId ? { webhookId } : {}),
        },
      });
    }
    if (openMerchant(merchant, vault).secret !== credentials.secret)
      throw new Error(
        "Credentials changed for an existing application; use a new versioned application.",
      );
    if (merchant.merchantId !== merchantId)
      throw new Error("Merchant identity mismatch");
    const old = await tx.payPalSetting.findUnique({ where: { id: "site" } });
    if (old && old.activeMerchantId !== merchant.id)
      await tx.payPalMerchant.update({
        where: { id: old.activeMerchantId },
        data: { retiredAt: new Date() },
      });
    await tx.payPalMerchant.update({
      where: { id: merchant.id },
      data: { retiredAt: null, ...(webhookId ? { webhookId } : {}) },
    });
    await tx.payPalSetting.upsert({
      where: { id: "site" },
      create: { activeMerchantId: merchant.id },
      update: { activeMerchantId: merchant.id },
    });
    await tx.auditLog.create({
      data: {
        action: "paypal.sandbox.account.activate",
        entityType: "PayPalMerchant",
        entityId: merchant.id,
        details: { previousId: old?.activeMerchantId ?? null },
      },
    });
    return { id: merchant.id, label: merchant.label };
  });
}
