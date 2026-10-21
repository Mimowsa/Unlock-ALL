import { getDatabase } from "@/server/db/client";
import { listOrders } from "@/server/commerce/orders";
import { orderPage } from "@/server/commerce/orders-http";
import { privateJson } from "@/server/auth/http";
import { administrator, catalogError } from "@/server/administration/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const user = await administrator();
    return privateJson(
      await listOrders(getDatabase(), user.id, {
        admin: true,
        ...orderPage(request),
      }),
    );
  } catch (error) {
    return catalogError(error);
  }
}
