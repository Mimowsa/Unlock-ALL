import { getDatabase } from "@/server/db/client";
import { preparePayPalCheckout } from "@/server/paypal/service";
import { orderCustomer } from "@/server/commerce/orders-http";
import { jsonInput, privateJson } from "@/server/auth/http";
import { catalogError } from "@/server/administration/http";
import { consumeRateLimit } from "@/server/auth/rate-limit";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const user = await orderCustomer(),
      input = await jsonInput(request),
      db = getDatabase();
    await consumeRateLimit(db, "paypal-create", user.id, 15, 900);
    return privateJson({
      checkout: await preparePayPalCheckout(db, user.id, input),
    });
  } catch (error) {
    return catalogError(error);
  }
}
export async function GET() {
  try {
    const user = await orderCustomer(),
      rows = await getDatabase().payPalCheckout.findMany({
        where: {
          userId: user.id,
          status: {
            in: [
              "CREATING",
              "APPROVAL_PENDING",
              "CAPTURING",
              "VERIFIED",
              "NEEDS_REVIEW",
            ],
          },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, status: true, createdAt: true, amountCents: true },
      });
    return privateJson({
      checkouts: rows.map((r) => ({
        ...r,
        amountCents: Number(r.amountCents),
      })),
    });
  } catch (e) {
    return catalogError(e);
  }
}
