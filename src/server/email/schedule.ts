import "server-only";
import { after } from "next/server";
import { getDatabase } from "../db/client";
import { runEmailJobs } from "./worker";
import { emailConfig } from "./config";
export function scheduleEmailJobs(userId?: string) {
  if (!emailConfig()) return;
  after(async () => {
    try {
      await runEmailJobs(getDatabase(), { userId });
    } catch {
      console.error("Email worker unavailable. Queued jobs are retained.");
    }
  });
}
