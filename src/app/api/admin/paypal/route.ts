import { getDatabase } from "@/server/db/client";
import { administrator, catalogError } from "@/server/administration/http";
import { jsonInput, privateJson } from "@/server/auth/http";
import { reconcilePayPal } from "@/server/paypal/service";
import { CommerceFailure } from "@/server/commerce/inventory";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { scheduleEmailJobs } from "@/server/email/schedule";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET() {
  try {
    await administrator();
    const rows = await getDatabase().payPalCheckout.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        status: true,
        createdAt: true,
        amountCents: true,
        customerEmail: true,
        paypalOrderId: true,
        captureId: true,
        errorCode: true,
        merchant: { select: { label: true } },
        order: { select: { id: true } },
      },
    });
    return privateJson({
      payments: rows.map((r) => ({ ...r, amountCents: Number(r.amountCents) })),
    });
  } catch (e) {
    return catalogError(e);
  }
}
export async function POST(request: Request) {
  try {
    const actor = await administrator(),
      input = await jsonInput(request);
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).length !== 1 ||
      !("id" in input) ||
      typeof input.id !== "string"
    )
      throw new CommerceFailure("invalidInput");
    const db = getDatabase();
    await consumeRateLimit(db, "paypal-admin-review", actor.id, 30, 900);
    const checkout = await db.payPalCheckout.findUnique({
      where: { id: input.id },
      select: { userId: true },
    });
    if (!checkout) throw new CommerceFailure("notFound", 404);
    const result = await reconcilePayPal(db, checkout.userId, input.id);
    await db.auditLog.create({
      data: {
        actorId: actor.id,
        action: "paypal.sandbox.review",
        entityType: "PayPalCheckout",
        entityId: input.id,
      },
    });
    scheduleEmailJobs(checkout.userId);
    return privateJson({ checkout: result });
  } catch (e) {
    return catalogError(e);
  }
}
