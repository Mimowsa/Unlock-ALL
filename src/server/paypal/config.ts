import type { EmailEnv } from "../email/config.ts";
export const sandboxBase = "https://api-m.sandbox.paypal.com";
export function paypalEnabled(env: EmailEnv = process.env) {
  return (
    env.APP_MODE === "demo" &&
    env.PAYPAL_ENV === "sandbox" &&
    env.PAYPAL_CHECKOUT_ENABLED === "true"
  );
}
export function sandboxCredentials(env: EmailEnv = process.env) {
  if (env.PAYPAL_ENV !== "sandbox" || env.APP_MODE !== "demo")
    throw new Error("Sandbox only");
  const clientId = env.PAYPAL_CLIENT_ID,
    secret = env.PAYPAL_CLIENT_SECRET;
  if (
    !clientId ||
    !secret ||
    !/^[A-Za-z0-9_-]{20,300}$/.test(clientId) ||
    !/^[A-Za-z0-9_-]{20,300}$/.test(secret)
  )
    throw new Error("PayPal credentials unavailable");
  return { clientId, secret };
}
export function approvalUrl(raw: string) {
  try {
    const url = new URL(raw);
    if (
      url.protocol === "https:" &&
      url.hostname === "www.sandbox.paypal.com" &&
      !url.username &&
      !url.password &&
      ["/checkoutnow", "/webapps/hermes"].includes(url.pathname)
    )
      return url.href;
  } catch {}
  throw new Error("Invalid PayPal approval URL");
}
export const decimalAmount = (cents: bigint) =>
  `${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
