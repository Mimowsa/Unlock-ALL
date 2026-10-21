import { test } from "node:test";
import assert from "node:assert/strict";
import { initialState } from "../src/demo/fixtures.ts";
import {
  availableKeys,
  mergeCarts,
  simulateOrder,
} from "../src/demo/engine.ts";
const now = "2026-10-20T12:00:00.000Z";
function prepared() {
  const state = initialState();
  state.currentUserId = "demo-customer";
  state.carts["demo-customer"] = [
    { productId: "unlock-0", quantity: 2 },
    { productId: "camos-2", quantity: 1 },
  ];
  return state;
}
test("each unit gets a distinct key; totals and product snapshots are preserved", () => {
  const state = prepared();
  const result = simulateOrder(state, "player.demo", "token-1", "id-1", now);
  assert.equal(result.order?.status, "completed");
  assert.equal(result.order.total, 6470);
  assert.equal(new Set(result.order.items.flatMap((i) => i.keys)).size, 3);
  assert.equal(availableKeys(result.state, "unlock-0").length, 6);
  assert.equal(availableKeys(state, "unlock-0").length, 8);
  assert.deepEqual(result.state.carts["demo-customer"], []);
  result.state.products[0].name.fr = "Modified";
  result.state.products[0].price = 100;
  assert.equal(result.order.items[0].name.fr, "Unlock All");
  assert.equal(result.order.items[0].unitPrice, 2490);
});
test("same idempotency token returns the same order without consuming more keys", () => {
  const first = simulateOrder(prepared(), "player.demo", "token", "id-1", now);
  const retry = simulateOrder(first.state, "player.demo", "token", "id-2", now);
  assert.equal(retry.order?.id, "id-1");
  assert.equal(retry.state.orders.length, 1);
  assert.equal(availableKeys(retry.state, "unlock-0").length, 6);
});
test("insufficient stock rolls back all key allocations and retains the cart", () => {
  const state = prepared();
  state.carts["demo-customer"][1].quantity = 999;
  const result = simulateOrder(state, "player.demo", "token", "id", now);
  assert.equal(result.order?.status, "failed");
  assert.equal(result.order?.items.flatMap((i) => i.keys).length, 0);
  assert.equal(availableKeys(result.state, "unlock-0").length, 8);
  assert.equal(result.state.carts["demo-customer"].length, 2);
});
test("guest and invalid Discord cannot create an order", () => {
  assert.equal(
    simulateOrder(initialState(), "player.demo", "t", "i", now).error,
    "signInRequired",
  );
  assert.equal(
    simulateOrder(prepared(), "invalid..name", "t", "i", now).error,
    "discordRequired",
  );
});
test("inactive products and disabled keys cannot be delivered", () => {
  const state = prepared();
  state.products[0].published = false;
  assert.equal(
    simulateOrder(state, "player.demo", "t", "i", now).order?.status,
    "failed",
  );
  state.products[0].published = true;
  state.keys
    .filter((k) => k.productId === "unlock-0")
    .forEach((k) => (k.disabled = true));
  assert.equal(
    simulateOrder(state, "player.demo", "t", "i", now).order?.status,
    "failed",
  );
});
test("sign-in merges guest and account carts and bounds quantities to inventory", () => {
  const state = prepared();
  state.carts.guest = [{ productId: "unlock-0", quantity: 8 }];
  const merged = mergeCarts(state, "demo-customer");
  assert.equal(
    merged.carts["demo-customer"].find((i) => i.productId === "unlock-0")
      ?.quantity,
    8,
  );
  assert.deepEqual(merged.carts.guest, []);
});
test("sequential orders never receive a previously assigned key", () => {
  const first = simulateOrder(prepared(), "player.demo", "t1", "i1", now);
  first.state.carts["demo-customer"] = [{ productId: "unlock-0", quantity: 2 }];
  const second = simulateOrder(first.state, "player.demo", "t2", "i2", now);
  const values = [...first.order!.items, ...second.order!.items].flatMap(
    (i) => i.keys,
  );
  assert.equal(new Set(values).size, values.length);
});
