import { getDatabase } from "@/server/db/client";
import { orderDetails } from "@/server/commerce/orders";
import { privateJson } from "@/server/auth/http";
import { administrator, catalogError } from "@/server/administration/http";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await administrator();
    const { id } = await params;
    return privateJson({
      order: await orderDetails(getDatabase(), user.id, id, true),
    });
  } catch (error) {
    return catalogError(error);
  }
}
