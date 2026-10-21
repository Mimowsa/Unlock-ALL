import { getDatabase } from "@/server/db/client";
import { listProducts } from "@/server/catalog/service";
import { privateJson } from "@/server/auth/http";
import { catalogError } from "@/server/administration/http";
export const runtime = "nodejs";
export async function GET() {
  try {
    return privateJson({ products: await listProducts(getDatabase()) });
  } catch (error) {
    return catalogError(error);
  }
}
