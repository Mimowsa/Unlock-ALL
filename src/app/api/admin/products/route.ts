import { getDatabase } from "@/server/db/client";
import { listProducts, saveProduct } from "@/server/catalog/service";
import { administrator, catalogError } from "@/server/administration/http";
import { jsonInput, privateJson } from "@/server/auth/http";
import { consumeRateLimit } from "@/server/auth/rate-limit";
export const runtime = "nodejs";
export async function GET() {
  try {
    await administrator();
    return privateJson({ products: await listProducts(getDatabase(), true) });
  } catch (error) {
    return catalogError(error);
  }
}
export async function POST(request: Request) {
  try {
    const user = await administrator();
    const input = await jsonInput(request, 32768);
    const db = getDatabase();
    await consumeRateLimit(db, "admin-write", user.id, 100, 900);
    return privateJson({ product: await saveProduct(db, user.id, input) }, 201);
  } catch (error) {
    return catalogError(error);
  }
}
