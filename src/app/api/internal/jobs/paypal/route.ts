import { getDatabase } from "@/server/db/client";
import { handleJob } from "@/server/jobs/handler";
import { reconcilePayPalBatch } from "@/server/paypal/worker";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request: Request) {
  return handleJob(request, () => reconcilePayPalBatch(getDatabase(), {}, 2));
}
