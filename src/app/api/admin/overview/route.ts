import { getDatabase } from "@/server/db/client";
import { overview } from "@/server/administration/service";
import { administrator, catalogError } from "@/server/administration/http";
import { privateJson } from "@/server/auth/http";
export const runtime = "nodejs";
export async function GET() {
  try {
    await administrator();
    return privateJson(await overview(getDatabase()));
  } catch (error) {
    return catalogError(error);
  }
}
