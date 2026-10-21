import { getDatabase } from "@/server/db/client";
import { handleJob } from "@/server/jobs/handler";
import { runEmailJobs } from "@/server/email/worker";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  return handleJob(request, () => runEmailJobs(getDatabase(), { limit: 3 }));
}
