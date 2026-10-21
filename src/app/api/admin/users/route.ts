import { getDatabase } from "@/server/db/client";
import { listUsers } from "@/server/administration/service";
import { administrator, catalogError } from "@/server/administration/http";
import { privateJson } from "@/server/auth/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    await administrator();
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").slice(0, 254);
    const raw = Number(url.searchParams.get("page") ?? 1);
    const page =
      Number.isSafeInteger(raw) && raw > 0 ? Math.min(raw, 100000) : 1;
    return privateJson(await listUsers(getDatabase(), q, page));
  } catch (error) {
    return catalogError(error);
  }
}
