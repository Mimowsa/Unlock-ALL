import type { EmailStatus } from "../../generated/prisma/client.ts";
import type { OrderView } from "../../types/orders.ts";
import { emailConfig, allowedRecipient } from "./config.ts";
export function orderEmailStatus(
  jobs: { status: EmailStatus }[],
  recipient: string,
): OrderView["email"]["status"] {
  if (!jobs.length) {
    const config = emailConfig();
    return config && !allowedRecipient(config, recipient)
      ? "restricted"
      : "not_sent";
  }
  if (jobs.some((j) => j.status === "FAILED")) return "failed";
  if (jobs.length === 2 && jobs.every((j) => j.status === "SENT"))
    return "accepted";
  return "queued";
}
