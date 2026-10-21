import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getDatabase } from "@/server/db/client";
import { orderDownload } from "@/server/commerce/orders";
import { orderCustomer } from "@/server/commerce/orders-http";
import { catalogError } from "@/server/administration/http";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  try {
    const user = await orderCustomer();
    const { id, itemId } = await params;
    await orderDownload(
      getDatabase(),
      user.id,
      id,
      itemId,
      user.role === "ADMIN",
    );
    const body = await readFile(
      join(process.cwd(), "assets/downloads/unlock-all-demo.txt"),
    );
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": 'attachment; filename="unlock-all-demo.txt"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return catalogError(error);
  }
}
