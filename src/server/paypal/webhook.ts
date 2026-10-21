import type { PrismaClient } from "../../generated/prisma/client.ts";
import { z } from "zod";
import { keyVaultConfig } from "../security/key-vault.ts";
import { openMerchant } from "./crypto.ts";
import { paypalAPI } from "./api.ts";
import { reconcilePayPal, type PayPalOptions } from "./service.ts";
import { CommerceFailure } from "../commerce/inventory.ts";
import { decimalAmount } from "./config.ts";
const eventSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,150}$/),
  event_type: z.string().max(100),
  resource: z.object({
    id: z.string().optional(),
    supplementary_data: z
      .object({
        related_ids: z.object({
          order_id: z.string().optional(),
          capture_id: z.string().optional(),
        }),
      })
      .optional(),
    links: z.array(z.object({ rel: z.string(), href: z.string() })).optional(),
  }),
});
export async function processPayPalWebhook(
  db: PrismaClient,
  merchantId: string,
  headers: Headers,
  raw: unknown,
  options: PayPalOptions = {},
) {
  const merchant = await db.payPalMerchant.findUnique({
    where: { id: merchantId },
  });
  if (!merchant) throw new CommerceFailure("notFound", 404);
  if (!merchant.webhookId) throw new CommerceFailure("paypalUnavailable", 503);
  const transmissionId = headers.get("paypal-transmission-id"),
    time = headers.get("paypal-transmission-time"),
    sig = headers.get("paypal-transmission-sig"),
    cert = headers.get("paypal-cert-url"),
    algo = headers.get("paypal-auth-algo");
  if (
    !transmissionId ||
    transmissionId.length > 150 ||
    !time ||
    !Number.isFinite(Date.parse(time)) ||
    Math.abs(Date.now() - Date.parse(time)) > 5 * 86400000 ||
    !sig ||
    sig.length > 2048 ||
    algo !== "SHA256withRSA" ||
    !cert ||
    !/^https:\/\/api(?:-m)?\.sandbox\.paypal\.com\/v1\/notifications\/certs\/[A-Za-z0-9-]+$/.test(
      cert,
    )
  )
    throw new CommerceFailure("invalidInput", 400);
  const api =
    options.api?.(merchant.id) ??
    paypalAPI(openMerchant(merchant, options.vault ?? keyVaultConfig()));
  const verification = (await api.request(
    "/v1/notifications/verify-webhook-signature",
    "POST",
    {
      auth_algo: algo,
      cert_url: cert,
      transmission_id: transmissionId,
      transmission_sig: sig,
      transmission_time: time,
      webhook_id: merchant.webhookId,
      webhook_event: raw,
    },
  )) as { verification_status?: string };
  if (verification.verification_status !== "SUCCESS")
    throw new CommerceFailure("forbidden", 403);
  const parsed = eventSchema.safeParse(raw);
  if (!parsed.success) throw new CommerceFailure("invalidInput");
  const event = parsed.data;
  const prior = await db.payPalWebhookEvent.findUnique({
    where: { id: event.id },
  });
  if (prior && prior.merchantId !== merchantId)
    throw new CommerceFailure("forbidden", 403);
  if (prior?.processedAt) return { received: true };
  const orderId =
    event.event_type === "CHECKOUT.ORDER.APPROVED"
      ? event.resource.id
      : event.resource.supplementary_data?.related_ids.order_id;
  await db.payPalWebhookEvent.upsert({
    where: { id: event.id },
    create: {
      id: event.id,
      merchantId,
      eventType: event.event_type,
      paypalOrderId: orderId,
    },
    update: {},
  });
  if (
    orderId &&
    [
      "CHECKOUT.ORDER.APPROVED",
      "PAYMENT.CAPTURE.COMPLETED",
      "PAYMENT.CAPTURE.PENDING",
      "PAYMENT.CAPTURE.DENIED",
    ].includes(event.event_type)
  ) {
    const checkout = await db.payPalCheckout.findFirst({
      where: { paypalOrderId: orderId, merchantId },
      select: { id: true, userId: true },
    });
    if (checkout)
      await reconcilePayPal(db, checkout.userId, checkout.id, options);
  }
  if (
    ["PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED"].includes(
      event.event_type,
    ) &&
    event.resource.id
  ) {
    // A refund resource has its own ID. Extract the parent capture reference;
    // never fetch a URL supplied by the notification.
    const parent = event.resource.links?.find(
      (link) => link.rel === "up",
    )?.href;
    const parentCapture = parent?.match(
      /^https:\/\/api(?:-m)?\.sandbox\.paypal\.com\/v2\/payments\/captures\/([A-Za-z0-9_-]{1,100})$/,
    )?.[1];
    const captureId =
      event.resource.supplementary_data?.related_ids.capture_id ??
      parentCapture ??
      event.resource.id;
    const checkout = await db.payPalCheckout.findFirst({
      where: { captureId, merchantId },
      select: { id: true, captureId: true, amountCents: true },
    });
    if (checkout?.captureId) {
      const capture = (await api.request(
        `/v2/payments/captures/${checkout.captureId}`,
      )) as {
        id?: string;
        status?: string;
        amount?: { currency_code?: string; value?: string };
      };
      if (
        capture.id !== checkout.captureId ||
        capture.amount?.currency_code !== "EUR" ||
        capture.amount.value !== decimalAmount(checkout.amountCents)
      )
        throw new CommerceFailure("paypalReview", 409);
      if (
        ["REFUNDED", "PARTIALLY_REFUNDED", "REVERSED"].includes(
          capture.status ?? "",
        )
      )
        await db.payPalCheckout.update({
          where: { id: checkout.id },
          data: { status: capture.status! },
        });
    }
  }
  await db.payPalWebhookEvent.update({
    where: { id: event.id },
    data: { processedAt: new Date() },
  });
  return { received: true };
}
