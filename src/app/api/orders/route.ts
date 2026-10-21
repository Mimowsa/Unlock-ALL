import { scheduleEmailJobs } from "@/server/email/schedule";
import { getDatabase } from "@/server/db/client";
import { createOrder, listOrders } from "@/server/commerce/orders";
import { orderCustomer, orderPage } from "@/server/commerce/orders-http";
import { privateJson, jsonInput } from "@/server/auth/http";
import { consumeRateLimit } from "@/server/auth/rate-limit";
import { catalogError } from "@/server/administration/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const user = await orderCustomer();
    return privateJson(
      await listOrders(getDatabase(), user.id, {
        page: orderPage(request).page,
      }),
    );
  } catch (error) {
    return catalogError(error);
  }
}
export async function POST(request: Request) {
  try {
    const user = await orderCustomer();
    const input = await jsonInput(request);
    const db = getDatabase();
    await consumeRateLimit(db, "order-demo-create", user.id, 20, 900);
    const result = await createOrder(db, user.id, input);
    scheduleEmailJobs(user.id);
    return privateJson(result);
  } catch (error) {
    return catalogError(error);
  }
}
