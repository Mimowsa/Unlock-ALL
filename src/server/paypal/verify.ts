import { z } from "zod";
import { decimalAmount } from "./config.ts";
import { PayPalFailure } from "./api.ts";
const amount = z.object({ currency_code: z.string(), value: z.string() });
const capture = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  status: z.string(),
  amount,
  final_capture: z.boolean().optional(),
});
export const remoteOrder = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  status: z.string(),
  intent: z.literal("CAPTURE").optional(),
  purchase_units: z
    .array(
      z.object({
        custom_id: z.string(),
        invoice_id: z.string().optional(),
        payee: z.object({ merchant_id: z.string() }),
        amount,
        payments: z.object({ captures: z.array(capture) }).optional(),
      }),
    )
    .length(1),
  links: z.array(z.object({ rel: z.string(), href: z.string() })).optional(),
});
export function verifyOrder(
  raw: unknown,
  expected: {
    id: string;
    amountCents: bigint;
    paypalOrderId: string | null;
    merchant: { merchantId: string };
  },
) {
  const parsed = remoteOrder.safeParse(raw);
  if (!parsed.success) throw new PayPalFailure("PAYPAL_MISMATCH", false);
  const data = parsed.data,
    u = data.purchase_units[0];
  if (
    (expected.paypalOrderId && data.id !== expected.paypalOrderId) ||
    u.custom_id !== expected.id ||
    u.payee.merchant_id !== expected.merchant.merchantId ||
    u.amount.currency_code !== "EUR" ||
    u.amount.value !== decimalAmount(expected.amountCents)
  )
    throw new PayPalFailure("PAYPAL_MISMATCH", false);
  return data;
}
export function verifiedCapture(
  data: z.infer<typeof remoteOrder>,
  amountCents: bigint,
) {
  if (data.status !== "COMPLETED") return null;
  const captures = data.purchase_units[0].payments?.captures;
  if (!captures || captures.length !== 1)
    throw new PayPalFailure("PAYPAL_MISMATCH", false);
  const c = captures[0];
  if (
    c.amount.currency_code !== "EUR" ||
    c.amount.value !== decimalAmount(amountCents) ||
    !c.final_capture
  )
    throw new PayPalFailure("PAYPAL_MISMATCH", false);
  return c;
}
