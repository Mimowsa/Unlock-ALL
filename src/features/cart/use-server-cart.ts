"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { CartItem, Product } from "@/demo/types";
import type { CopyKey } from "@/i18n/messages";
export type ServerCart = {
  items: CartItem[];
  products: Product[];
  revision: number;
  fingerprint: string;
  valid: boolean;
  totalCents: number;
  adjusted?: boolean;
};
export function commerceMessage(code?: string): CopyKey {
  return code === "stockLimit" || code === "stockError"
    ? "stockLimit"
    : code === "cartConflict"
      ? "cartConflict"
      : code === "duplicateKey"
        ? "duplicateKey"
        : code === "keyAssigned"
          ? "keyAssigned"
          : code === "invalidInput"
            ? "saveError"
            : code === "forbidden"
              ? "signInRequired"
              : "cartUnavailable";
}
export function useServerCart(
  userId: string | undefined,
  identityLoading: boolean,
  onNotice: (key: CopyKey) => void,
) {
  const pathname = usePathname();
  const tag = userId ?? "guest";
  const current = useRef(tag);
  current.current = tag;
  const [state, setState] = useState<{
    tag: string;
    data: ServerCart | null;
    error: boolean;
  }>({ tag: "", data: null, error: false });
  const [busy, setBusy] = useState(false);
  const queue = useRef(Promise.resolve());
  const channel = useRef<BroadcastChannel | null>(null);
  const schedule = <T>(fn: () => Promise<T>) => {
    const job = queue.current.catch(() => {}).then(fn);
    queue.current = job.then(
      () => {},
      () => {},
    );
    return job;
  };
  async function request(url: string, body?: unknown) {
    const response = await fetch(
      url,
      body === undefined
        ? { cache: "no-store" }
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "unavailable");
    return result as ServerCart;
  }
  function apply(data: ServerCart, owner: string) {
    if (current.current !== owner) return;
    setState({ tag: owner, data, error: false });
  }
  function refresh(merge = false) {
    const owner = tag;
    return schedule(async () => {
      try {
        const data = await request(
          merge ? "/api/cart/merge" : "/api/cart",
          merge ? {} : undefined,
        );
        apply(data, owner);
        if (data.adjusted) onNotice("cartAdjusted");
        return data;
      } catch (error) {
        if (current.current === owner)
          setState((old) => ({
            tag: owner,
            data: old.tag === owner ? old.data : null,
            error: true,
          }));
        throw error;
      }
    });
  }
  useEffect(() => {
    if (identityLoading) return;
    void refresh(!!userId).catch(() => {});
  }, [userId, identityLoading]);
  useEffect(() => {
    if (identityLoading) return;
    void refresh().catch(() => {});
  }, [pathname]);
  useEffect(() => {
    if (identityLoading) return;
    const sync = () => {
      if (!document.hidden) void refresh().catch(() => {});
    };
    const interval = setInterval(sync, 15000);
    window.addEventListener("focus", sync);
    const bus =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel("unlock-all:cart")
        : null;
    channel.current = bus;
    if (bus) bus.onmessage = sync;
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", sync);
      bus?.close();
      channel.current = null;
    };
  }, [userId, identityLoading]);
  async function mutate(
    productId: string,
    quantity: number,
    operation: "add" | "set",
  ) {
    const owner = tag;
    const expectedRevision =
      state.tag === tag ? (state.data?.revision ?? 0) : 0;
    setBusy(true);
    try {
      return await schedule(async () => {
        if (current.current !== owner) return false;
        try {
          const data = await request("/api/cart", {
            productId,
            quantity,
            operation,
            ...(operation === "set" ? { revision: expectedRevision } : {}),
          });
          apply(data, owner);
          channel.current?.postMessage("changed");
          if (operation === "add") onNotice("added");
          return true;
        } catch (error) {
          onNotice(
            commerceMessage(error instanceof Error ? error.message : undefined),
          );
          try {
            apply(await request("/api/cart"), owner);
          } catch {}
          return false;
        }
      });
    } finally {
      if (current.current === owner) setBusy(false);
    }
  }
  const active = state.tag === tag;
  return {
    data: active ? state.data : null,
    error: active && state.error,
    loading: !active,
    busy,
    refresh: () => refresh(),
    add: (id: string, amount = 1) => mutate(id, amount, "add"),
    quantity: (id: string, amount: number) => mutate(id, amount, "set"),
  };
}
