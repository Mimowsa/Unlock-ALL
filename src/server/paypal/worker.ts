import type { PrismaClient } from "../../generated/prisma/client.ts";
import {
  reconcilePayPal,
  expireCheckout,
  type PayPalOptions,
} from "./service.ts";
export async function reconcilePayPalBatch(
  db: PrismaClient,
  options: PayPalOptions = {},
  limit = 5,
) {
  const rows = await db.payPalCheckout.findMany({
    where: {
      status: { in: ["CREATING", "APPROVAL_PENDING", "CAPTURING", "VERIFIED"] },
    },
    select: { id: true, userId: true, status: true, expiresAt: true },
    orderBy: { updatedAt: "asc" },
    take: Math.max(1, Math.min(5, Math.trunc(limit))),
  });
  let processed = 0;
  for (const row of rows) {
    try {
      if (
        row.expiresAt <= new Date() &&
        ["CREATING", "APPROVAL_PENDING"].includes(row.status)
      )
        await expireCheckout(db, row.id);
      else await reconcilePayPal(db, row.userId, row.id, options);
      processed++;
    } catch {
      /* An uncertain payment retains its stock and its original account references. */
    }
  }
  return { processed };
}
