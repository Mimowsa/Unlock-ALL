import { getDatabase } from "@/server/db/client";
import { readPayPalCheckout, reconcilePayPal } from "@/server/paypal/service";
import { orderCustomer } from "@/server/commerce/orders-http";
import { jsonInput, privateJson } from "@/server/auth/http";
import { catalogError } from "@/server/administration/http";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { CommerceFailure } from "@/server/commerce/inventory";
import { scheduleEmailJobs } from "@/server/email/schedule";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await orderCustomer();
    return privateJson({
      checkout: await readPayPalCheckout(
        getDatabase(),
        user.id,
        (await params).id,
      ),
    });
  } catch (e) {
    return catalogError(e);
  }
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await orderCustomer(),
      input = await jsonInput(request);
    if (
      !input ||
      typeof input !== "object" ||
      Array.isArray(input) ||
      Object.keys(input).some((k) => k !== "cancel") ||
      ("cancel" in input && typeof input.cancel !== "boolean")
    )
      throw new CommerceFailure("invalidInput");
    const db = getDatabase();
    await consumeRateLimit(db, "paypal-reconcile", user.id, 60, 900);
    const checkout = await reconcilePayPal(
      db,
      user.id,
      (await params).id,
      {},
      "cancel" in input && input.cancel === true,
    );
    if (checkout.orderId) scheduleEmailJobs(user.id);
    return privateJson({ checkout });
  } catch (e) {
    return catalogError(e);
  }
}
