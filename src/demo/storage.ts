import type { DemoState } from "./types";
export const STORAGE_KEY = "unlock-all:demo:v1";
const record = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const string = (x: unknown): x is string => typeof x === "string";
const money = (x: unknown) =>
  Number.isSafeInteger(x) && Number(x) >= 0 && Number(x) <= 100000000;
const localized = (x: unknown) => record(x) && string(x.fr) && string(x.en);
export const safeDownload = (x: string) =>
  /^\/downloads\/demo\/[a-zA-Z0-9_-]+\.(txt|pdf)$/.test(x);
// Local storage is untrusted. Reject incompatible or malformed snapshots.
export function isDemoState(value: unknown): value is DemoState {
  try {
    if (
      !record(value) ||
      value.version !== 1 ||
      !Array.isArray(value.products) ||
      !Array.isArray(value.keys) ||
      !Array.isArray(value.users) ||
      !Array.isArray(value.orders) ||
      !record(value.carts)
    )
      return false;
    if (
      value.products.length > 500 ||
      value.keys.length > 10000 ||
      value.orders.length > 2000
    )
      return false;
    if (
      !value.products.every(
        (p) =>
          record(p) &&
          string(p.id) &&
          string(p.slug) &&
          localized(p.name) &&
          localized(p.description) &&
          money(p.price) &&
          ["PC", "PlayStation", "Xbox"].includes(String(p.platform)) &&
          ["unlock", "camos", "weapons", "fullPack"].includes(
            String(p.category),
          ) &&
          ["operator", "camo", "weapon", "complete"].includes(String(p.art)) &&
          (p.image === undefined ||
            (string(p.image) &&
              /^\/api\/media\/products\/[a-f0-9-]{36}\.webp$/.test(p.image))) &&
          typeof p.published === "boolean" &&
          string(p.download) &&
          safeDownload(p.download) &&
          string(p.createdAt) &&
          string(p.updatedAt),
      )
    )
      return false;
    const productIds = new Set(value.products.map((p) => p.id));
    if (
      !value.keys.every(
        (k) =>
          record(k) &&
          string(k.id) &&
          productIds.has(k.productId) &&
          string(k.value) &&
          k.value.startsWith("DEMO-") &&
          typeof k.disabled === "boolean" &&
          (k.orderId === null || string(k.orderId)),
      )
    )
      return false;
    if (new Set(value.keys.map((k) => k.value)).size !== value.keys.length)
      return false;
    if (
      !value.users.every(
        (u) =>
          record(u) &&
          string(u.id) &&
          string(u.email) &&
          string(u.nickname) &&
          string(u.discord) &&
          ["USER", "ADMIN"].includes(String(u.role)) &&
          typeof u.active === "boolean",
      )
    )
      return false;
    if (!value.users.some((u) => u.role === "ADMIN" && u.active)) return false;
    if (
      value.currentUserId !== null &&
      !value.users.some((u) => u.id === value.currentUserId && u.active)
    )
      return false;
    if (
      !Object.values(value.carts).every(
        (cart) =>
          Array.isArray(cart) &&
          cart.every(
            (i) =>
              record(i) &&
              productIds.has(i.productId) &&
              Number.isSafeInteger(i.quantity) &&
              Number(i.quantity) > 0 &&
              Number(i.quantity) <= 1000,
          ),
      )
    )
      return false;
    if (
      !value.orders.every(
        (o) =>
          record(o) &&
          string(o.id) &&
          string(o.reference) &&
          string(o.userId) &&
          string(o.customer) &&
          string(o.date) &&
          Number.isFinite(Date.parse(o.date)) &&
          money(o.total) &&
          ["completed", "failed"].includes(String(o.status)) &&
          string(o.discord) &&
          string(o.idempotency) &&
          Array.isArray(o.events) &&
          o.events.every(string) &&
          Array.isArray(o.items) &&
          o.items.every(
            (i) =>
              record(i) &&
              string(i.productId) &&
              localized(i.name) &&
              string(i.platform) &&
              money(i.unitPrice) &&
              Number.isSafeInteger(i.quantity) &&
              Number(i.quantity) > 0 &&
              Array.isArray(i.keys) &&
              i.keys.every(string) &&
              string(i.download) &&
              safeDownload(i.download),
          ),
      )
    )
      return false;
    return true;
  } catch {
    return false;
  }
}
