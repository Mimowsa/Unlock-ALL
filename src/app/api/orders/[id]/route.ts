import { getDatabase } from "@/server/db/client";
import { orderDetails } from "@/server/commerce/orders";
import { orderCustomer } from "@/server/commerce/orders-http";
import { privateJson } from "@/server/auth/http";
import { catalogError } from "@/server/administration/http";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await orderCustomer();
    const { id } = await params;
    return privateJson({
      order: await orderDetails(getDatabase(), user.id, id),
    });
  } catch (error) {
    return catalogError(error);
  }
}
