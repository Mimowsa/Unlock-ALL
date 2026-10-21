import { z } from "zod";
import { PayPalFailure, type PayPalAPI } from "./api.ts";
import { decimalAmount } from "./config.ts";
const info = z.object({
  transaction_id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  transaction_event_code: z.string(),
  transaction_status: z.string(),
  transaction_initiation_date: z.iso.datetime({ offset: true }),
  transaction_amount: z.object({
    currency_code: z.string(),
    value: z.string(),
  }),
  transaction_note: z.string().optional(),
  transaction_subject: z.string().optional(),
});
const pageSchema = z.object({
  account_number: z.string(),
  last_refreshed_datetime: z.iso.datetime({ offset: true }),
  page: z.number().int().positive(),
  total_pages: z.number().int().nonnegative(),
  total_items: z.number().int().nonnegative(),
  transaction_details: z.array(z.object({ transaction_info: info })),
});
export type ReportTransaction = z.infer<typeof info>;
export async function transactionReport(
  api: PayPalAPI,
  accountId: string,
  start: Date,
  end: Date,
) {
  if (
    end.getTime() <= start.getTime() ||
    end.getTime() - start.getTime() > 31 * 86400000
  )
    throw new PayPalFailure("PAYPAL_REPORT_RANGE", false);
  const transactions: ReportTransaction[] = [];
  let pages = 1,
    items = 0,
    refreshed = Infinity;
  for (let page = 1; page <= pages; page++) {
    const parsed = pageSchema.safeParse(
      await api.request(
        "/v1/reporting/transactions",
        "GET",
        undefined,
        undefined,
        {
          start_date: start.toISOString(),
          end_date: end.toISOString(),
          fields: "transaction_info",
          page_size: "100",
          page: String(page),
        },
      ),
    );
    if (!parsed.success)
      throw new PayPalFailure("PAYPAL_REPORT_INVALID", false);
    const data = parsed.data;
    if (data.account_number !== accountId)
      throw new PayPalFailure("PAYPAL_REPORT_ACCOUNT", false);
    if (
      data.page !== page ||
      data.total_pages > 5 ||
      (page > 1 &&
        (Math.max(1, data.total_pages) !== pages || data.total_items !== items))
    )
      throw new PayPalFailure("PAYPAL_REPORT_INCOMPLETE");
    pages = Math.max(1, data.total_pages);
    items = data.total_items;
    refreshed = Math.min(refreshed, Date.parse(data.last_refreshed_datetime));
    transactions.push(
      ...data.transaction_details.map((t) => t.transaction_info),
    );
  }
  if (transactions.length !== items)
    throw new PayPalFailure("PAYPAL_REPORT_INCOMPLETE");
  return { transactions, refreshedAt: new Date(refreshed) };
}
export function matchTransfer(
  transactions: ReportTransaction[],
  expected: {
    reference: string;
    amountCents: bigint;
    createdAt: Date;
    payUntil: Date;
  },
) {
  const candidates = transactions.filter(
    (t) =>
      (t.transaction_note ?? t.transaction_subject ?? "").trim() ===
      expected.reference,
  );
  if (!candidates.length) return { kind: "missing" as const };
  const ids = new Set(candidates.map((t) => t.transaction_id));
  if (ids.size !== 1)
    return { kind: "review" as const, code: "TRANSFER_MULTIPLE_PAYMENTS" };
  if (
    candidates.some((t) => JSON.stringify(t) !== JSON.stringify(candidates[0]))
  )
    return { kind: "review" as const, code: "TRANSFER_AMBIGUOUS" };
  const t = candidates[0],
    paidAt = new Date(t.transaction_initiation_date);
  if (
    t.transaction_amount.currency_code !== "EUR" ||
    t.transaction_amount.value !== decimalAmount(expected.amountCents) ||
    t.transaction_event_code !== "T0000" ||
    paidAt < expected.createdAt ||
    paidAt > expected.payUntil
  )
    return { kind: "review" as const, code: "TRANSFER_MISMATCH" };
  if (t.transaction_status === "P") return { kind: "pending" as const };
  if (t.transaction_status !== "S")
    return { kind: "review" as const, code: "TRANSFER_NOT_COMPLETED" };
  return { kind: "match" as const, transaction: t, paidAt };
}
