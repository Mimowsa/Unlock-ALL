import type { EmailConfig } from "./config.ts";
import type { EmailPayload } from "./payload.ts";
export class DeliveryFailure extends Error {
  code: string;
  retryable: boolean;
  constructor(code: string, retryable: boolean) {
    super(code);
    this.code = code;
    this.retryable = retryable;
  }
}
export type SendEmail = (
  payload: EmailPayload,
  idempotencyKey: string,
  config: EmailConfig,
) => Promise<string>;
export const sendResend: SendEmail = async (
  payload,
  idempotencyKey,
  config,
) => {
  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    throw new DeliveryFailure("PROVIDER_NETWORK", true);
  }
  if (!response.ok) {
    let reason: unknown;
    try {
      reason = await response.json();
    } catch {}
    const message =
      reason &&
      typeof reason === "object" &&
      "message" in reason &&
      typeof reason.message === "string"
        ? reason.message.toLowerCase()
        : "";
    const name =
      reason && typeof reason === "object" && "name" in reason
        ? reason.name
        : "";
    const code =
      response.status === 403 && message.includes("only send testing emails")
        ? "PROVIDER_TEST_RECIPIENT"
        : response.status === 403 && name === "restricted_api_key"
          ? "PROVIDER_KEY_PERMISSION"
          : response.status === 403 &&
              message.includes("domain") &&
              message.includes("not verified")
            ? "PROVIDER_DOMAIN_UNVERIFIED"
            : `PROVIDER_${response.status}`;
    throw new DeliveryFailure(
      code,
      response.status === 429 ||
        response.status === 409 ||
        response.status >= 500,
    );
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new DeliveryFailure("PROVIDER_RESPONSE", true);
  }
  if (
    !data ||
    typeof data !== "object" ||
    !("id" in data) ||
    typeof data.id !== "string" ||
    !/^[a-zA-Z0-9_-]{1,200}$/.test(data.id)
  )
    throw new DeliveryFailure("PROVIDER_RESPONSE", true);
  return data.id;
};
