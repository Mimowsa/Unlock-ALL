import { randomUUID } from "node:crypto";
import type { PrismaClient } from "../../generated/prisma/client.ts";
import { CommerceFailure } from "../commerce/inventory.ts";
import { keyVaultConfig } from "../security/key-vault.ts";
import { openMerchant } from "./crypto.ts";
import { paypalAPI, PayPalFailure } from "./api.ts";
import { transactionReport, matchTransfer } from "./reporting.ts";
import {
  readPayPalCheckout,
  fulfillPayPal,
  type PayPalOptions,
} from "./service.ts";
export async function reconcileTransfer(
  db: PrismaClient,
  userId: string,
  id: string,
  options: PayPalOptions = {},
  cancel = false,
) {
  await readPayPalCheckout(db, userId, id);
  if (cancel) throw new CommerceFailure("invalidInput", 409);
  let row = await db.payPalCheckout.findUniqueOrThrow({
    where: { id },
    include: { merchant: true, order: true },
  });
  if (row.method !== "REFERENCE") throw new CommerceFailure("invalidInput");
  if (
    row.order ||
    [
      "CANCELED",
      "DECLINED",
      "REFUNDED",
      "PARTIALLY_REFUNDED",
      "REVERSED",
    ].includes(row.status)
  )
    return readPayPalCheckout(db, userId, id);
  if (row.status === "VERIFIED") {
    await fulfillPayPal(db, userId, id, options);
    return readPayPalCheckout(db, userId, id);
  }
  if (row.lastCheckedAt && Date.now() - row.lastCheckedAt.getTime() < 60000)
    return readPayPalCheckout(db, userId, id);
  const token = randomUUID();
  if (
    !(
      await db.payPalCheckout.updateMany({
        where: {
          id,
          OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }],
        },
        data: { leaseToken: token, leaseUntil: new Date(Date.now() + 90000) },
      })
    ).count
  )
    throw new CommerceFailure("paypalBusy", 409);
  try {
    row = await db.payPalCheckout.findUniqueOrThrow({
      where: { id },
      include: { merchant: true, order: true },
    });
    const api =
      options.api?.(row.merchantId) ??
      paypalAPI(openMerchant(row.merchant, options.vault ?? keyVaultConfig()));
    const report = await transactionReport(
      api,
      row.merchant.merchantId,
      // A start after PayPal's reporting watermark can return 404. Include
      // the documented reporting delay; matching still enforces createdAt.
      new Date(row.createdAt.getTime() - 3 * 3600000 - 60000),
      new Date(),
    );
    const match = matchTransfer(report.transactions, {
      reference: row.transferReference!,
      amountCents: row.amountCents,
      createdAt: row.createdAt,
      payUntil: row.payUntil!,
    });
    if (match.kind === "match" && row.status !== "EXPIRED") {
      await db.$transaction(
        async (tx) => {
          // The evidence and unique PayPal transaction ID commit before delivery.
          await tx.payPalTransferReceipt.create({
            data: {
              checkoutId: id,
              transactionId: match.transaction.transaction_id,
              accountId: row.merchant.merchantId,
              reference: row.transferReference!,
              amountCents: row.amountCents,
              currency: "EUR",
              eventCode: match.transaction.transaction_event_code,
              status: "S",
              paidAt: match.paidAt,
            },
          });
          await tx.payPalCheckout.update({
            where: { id, leaseToken: token },
            data: {
              status: "VERIFIED",
              captureId: match.transaction.transaction_id,
              lastCheckedAt: new Date(),
              errorCode: null,
            },
          });
        },
        { maxWait: 10000, timeout: 30000 },
      );
      await fulfillPayPal(db, userId, id, options);
    } else if (
      match.kind === "review" ||
      (match.kind === "match" && row.status === "EXPIRED") ||
      (match.kind === "pending" && row.expiresAt <= new Date())
    ) {
      await db.payPalCheckout.update({
        where: { id, leaseToken: token },
        data: {
          status: "NEEDS_REVIEW",
          lastCheckedAt: new Date(),
          errorCode:
            match.kind === "review" ? match.code : "TRANSFER_LATE_OR_PENDING",
        },
      });
    } else if (
      match.kind === "missing" &&
      row.expiresAt <= new Date() &&
      report.refreshedAt >= row.payUntil!
    ) {
      await db.$transaction(async (tx) => {
        await tx.payPalCheckout.update({
          where: { id, leaseToken: token },
          data: {
            status: "EXPIRED",
            lastCheckedAt: new Date(),
            errorCode: null,
          },
        });
        await tx.keyReservation.deleteMany({ where: { checkoutId: id } });
      });
    } else
      await db.payPalCheckout.update({
        where: { id, leaseToken: token },
        data: { lastCheckedAt: new Date(), errorCode: null },
      });
    return readPayPalCheckout(db, userId, id);
  } catch (error) {
    if (error instanceof PayPalFailure) {
      if (error.code === "PAYPAL_HTTP_403")
        await db.payPalMerchant.update({
          where: { id: row.merchantId },
          data: { reportingEnabled: false },
        });
      await db.payPalCheckout.updateMany({
        where: { id, leaseToken: token },
        data: { lastCheckedAt: new Date(), errorCode: error.code },
      });
      throw new CommerceFailure("paypalUnavailable", 503);
    }
    if ((error as { code?: string }).code === "P2002") {
      await db.payPalCheckout.updateMany({
        where: { id, leaseToken: token },
        data: {
          status: "NEEDS_REVIEW",
          lastCheckedAt: new Date(),
          errorCode: "TRANSFER_ALREADY_USED",
        },
      });
      return readPayPalCheckout(db, userId, id);
    }
    throw error;
  } finally {
    await db.payPalCheckout.updateMany({
      where: { id, leaseToken: token },
      data: { leaseToken: null, leaseUntil: null },
    });
  }
}
