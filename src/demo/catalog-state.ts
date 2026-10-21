import type { DemoState, Product } from "./types.ts";
// Phase 5 replaces browser product metadata with the published server catalogue.
// Only synthetic stock, carts and order snapshots remain local until phases 6–7.
export function withCatalog(state: DemoState, products: Product[]): DemoState {
  const ids = new Set(products.map((p) => p.id));
  const id = (old: string) => (ids.has(old) ? old : `demo-product-${old}`);
  return {
    ...state,
    products,
    keys: state.keys
      .map((k) => ({ ...k, productId: id(k.productId) }))
      .filter((k) => ids.has(k.productId)),
    carts: Object.fromEntries(
      Object.entries(state.carts).map(([owner, items]) => [
        owner,
        items
          .map((i) => ({ ...i, productId: id(i.productId) }))
          .filter((i) => ids.has(i.productId)),
      ]),
    ),
    orders: state.orders.map((o) => ({
      ...o,
      items: o.items.map((i) => ({ ...i, productId: id(i.productId) })),
    })),
  };
}
