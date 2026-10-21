import { z } from "zod";
export type EmailEnv = Readonly<Record<string, string | undefined>>;
export type EmailConfig = {
  apiKey: string;
  from: string;
  testRecipient: string;
  origin: string;
};
export function emailConfig(env: EmailEnv = process.env): EmailConfig | null {
  if (env.EMAIL_DELIVERY !== "resend-test" || env.APP_MODE !== "demo")
    return null;
  const recipient = z
    .email()
    .safeParse(env.EMAIL_TEST_RECIPIENT?.trim().toLowerCase());
  const key = env.RESEND_API_KEY;
  if (!recipient.success || !key || !/^re_[A-Za-z0-9_-]{10,}$/.test(key))
    return null;
  try {
    const url = new URL(env.NEXTAUTH_URL || "http://127.0.0.1:3000");
    if (
      url.username ||
      url.password ||
      url.hash ||
      url.search ||
      url.pathname !== "/" ||
      !["http:", "https:"].includes(url.protocol)
    )
      return null;
    if (
      url.protocol !== "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
      return null;
    return {
      apiKey: key,
      from: "UNLOCK-ALL <onboarding@resend.dev>",
      testRecipient: recipient.data,
      origin: url.origin,
    };
  } catch {
    return null;
  }
}
export function allowedRecipient(
  config: EmailConfig | null,
  recipient: string,
) {
  return !!config && recipient === config.testRecipient;
}
