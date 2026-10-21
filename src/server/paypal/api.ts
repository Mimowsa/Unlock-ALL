import { sandboxBase } from "./config.ts";
export type Credentials = { clientId: string; secret: string };
export class PayPalFailure extends Error {
  code: string;
  retryable: boolean;
  constructor(code: string, retryable = true) {
    super(code);
    this.code = code;
    this.retryable = retryable;
  }
}
export type PayPalAPI = {
  request: (
    path: string,
    method?: string,
    body?: unknown,
    idempotencyKey?: string,
  ) => Promise<unknown>;
};
const tokens = new Map<string, { value: string; until: number }>();
export function paypalAPI(credentials: Credentials): PayPalAPI {
  async function token() {
    const cached = tokens.get(credentials.clientId);
    if (cached && cached.until > Date.now()) return cached.value;
    let response: Response;
    try {
      response = await fetch(sandboxBase + "/v1/oauth2/token", {
        method: "POST",
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(
              credentials.clientId + ":" + credentials.secret,
            ).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
        signal: AbortSignal.timeout(10000),
        cache: "no-store",
        redirect: "error",
      });
    } catch {
      throw new PayPalFailure("PAYPAL_NETWORK");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new PayPalFailure(
        `PAYPAL_AUTH_${response.status}`,
        response.status >= 500,
      );
    }
    const data = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!data.access_token || !data.expires_in)
      throw new PayPalFailure("PAYPAL_AUTH_RESPONSE");
    tokens.set(credentials.clientId, {
      value: data.access_token,
      until:
        Date.now() + Math.min(1800, Math.max(30, data.expires_in - 60)) * 1000,
    });
    return data.access_token;
  }
  return {
    async request(path, method = "GET", body, idempotencyKey) {
      if (!/^\/v[12]\/[a-zA-Z0-9_/-]+$/.test(path))
        throw new PayPalFailure("PAYPAL_PATH", false);
      const access = await token();
      let response: Response;
      try {
        response = await fetch(sandboxBase + path, {
          method,
          headers: {
            Authorization: "Bearer " + access,
            "Content-Type": "application/json",
            Prefer: "return=representation",
            ...(idempotencyKey ? { "PayPal-Request-Id": idempotencyKey } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(12000),
          cache: "no-store",
          redirect: "error",
        });
      } catch {
        throw new PayPalFailure("PAYPAL_NETWORK");
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        if (response.status === 401) tokens.delete(credentials.clientId);
        throw new PayPalFailure(
          `PAYPAL_HTTP_${response.status}`,
          response.status === 429 ||
            response.status === 409 ||
            response.status >= 500,
        );
      }
      try {
        return await response.json();
      } catch {
        throw new PayPalFailure("PAYPAL_RESPONSE");
      }
    },
  };
}
