export function authSecret() {
  const value = process.env.NEXTAUTH_SECRET;
  if (!value || Buffer.byteLength(value) < 32)
    throw new Error("NEXTAUTH_SECRET must contain at least 32 random bytes.");
  return value;
}
export function authOrigin() {
  const url = new URL(process.env.NEXTAUTH_URL || "http://127.0.0.1:3000");
  if (
    url.username ||
    url.password ||
    !["http:", "https:"].includes(url.protocol)
  )
    throw new Error("Invalid NEXTAUTH_URL.");
  if (
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new Error(
      "Authentication requires HTTPS outside loopback development.",
    );
  return url.origin;
}
export function localResetEnabled() {
  return (
    process.env.AUTH_RESET_DELIVERY === "local" &&
    process.env.APP_MODE === "demo" &&
    process.env.NODE_ENV !== "production" &&
    !process.env.VERCEL
  );
}
