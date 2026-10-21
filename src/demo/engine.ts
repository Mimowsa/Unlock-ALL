import type { CartItem, DemoError, DemoOrder, DemoState } from "./types.ts";
export const availableKeys = (state: DemoState, productId: string) =>
  state.keys.filter(
    (k) => k.productId === productId && !k.disabled && !k.orderId,
  );
export const cartOwner = (state: DemoState) => state.currentUserId ?? "guest";
export const getCart = (state: DemoState) =>
  state.carts[cartOwner(state)] ?? [];
export function mergeCarts(state: DemoState, userId: string): DemoState {
  const merged = new Map<string, number>();
  for (const item of [
    ...(state.carts[userId] ?? []),
    ...(state.carts.guest ?? []),
  ])
    merged.set(
      item.productId,
      (merged.get(item.productId) ?? 0) + item.quantity,
    );
  const cart: CartItem[] = [...merged]
    .map(([productId, quantity]) => ({
      productId,
      quantity: Math.min(quantity, availableKeys(state, productId).length),
    }))
    .filter((i) => i.quantity > 0);
  return {
    ...state,
    currentUserId: userId,
    carts: { ...state.carts, guest: [], [userId]: cart },
  };
}
export function simulateOrder(
  state: DemoState,
  discord: string,
  idempotency: string,
  id: string,
  now: string,
): { state: DemoState; order?: DemoOrder; error?: DemoError } {
  const user = state.users.find(
    (u) => u.id === state.currentUserId && u.active,
  );
  if (!user) return { state, error: "signInRequired" };
  const existing = state.orders.find(
    (o) => o.userId === user.id && o.idempotency === idempotency,
  );
  if (existing) return { state, order: existing };
  if (!/^[a-z0-9_](?!.*\.\.)[a-z0-9_.]{1,31}$/.test(discord))
    return { state, error: "discordRequired" };
  const cart = getCart(state);
  if (!cart.length) return { state, error: "emptyError" };
  const stockFailure = cart.some(
    (item) =>
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      !state.products.find((p) => p.id === item.productId && p.published) ||
      availableKeys(state, item.productId).length < item.quantity,
  );
  const items = cart.map((item) => {
    const product = state.products.find((p) => p.id === item.productId)!;
    return {
      productId: item.productId,
      name: { ...product.name },
      platform: product.platform,
      unitPrice: product.price,
      quantity: item.quantity,
      keys: stockFailure
        ? []
        : availableKeys(state, product.id)
            .slice(0, item.quantity)
            .map((k) => k.value),
      download: product.download,
    };
  });
  const order: DemoOrder = {
    id,
    reference: `UA-DEMO-${id.slice(0, 8).toUpperCase()}`,
    userId: user.id,
    customer: user.email,
    date: now,
    total: items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0),
    status: stockFailure ? "failed" : "completed",
    items,
    discord,
    idempotency,
    events: stockFailure
      ? ["created", "failed"]
      : ["created", "validated", "assigned", "delivered"],
    ...(stockFailure ? { error: "stockError" as const } : {}),
  };
  if (stockFailure)
    return { state: { ...state, orders: [order, ...state.orders] }, order };
  const selected = new Set(items.flatMap((i) => i.keys));
  return {
    state: {
      ...state,
      keys: state.keys.map((k) =>
        selected.has(k.value) ? { ...k, orderId: id } : k,
      ),
      users: state.users.map((u) => (u.id === user.id ? { ...u, discord } : u)),
      carts: { ...state.carts, [user.id]: [] },
      orders: [order, ...state.orders],
    },
    order,
  };
}
