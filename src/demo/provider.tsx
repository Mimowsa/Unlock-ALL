"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { initialState } from "./fixtures";
import { withCatalog } from "./catalog-state";
import { isDemoState, STORAGE_KEY } from "./storage";
import type { DemoState, DemoUser, Product } from "./types";
import type { CopyKey } from "@/i18n/messages";
import { useIdentity } from "@/features/authentication/session-provider";
import { useServerCart } from "@/features/cart/use-server-cart";
import type { OrderInput } from "@/validation/orders";
function useDemoStore(initialProducts: Product[]) {
  const pathname = usePathname();
  const identity = useIdentity();
  const authenticated = identity.user;
  const catalog = useRef(initialProducts);
  const requestSequence = useRef(0);
  const fresh = () =>
    ({
      ...withCatalog(initialState(), catalog.current),
      keys: [],
      carts: {},
    }) as DemoState;
  const [state, setState] = useState<DemoState>(fresh);
  const snapshot = useRef(state);
  const [hydrated, setHydrated] = useState(false);
  const [notice, setNotice] = useState<CopyKey | null>(null);
  const [storageWarning, setStorageWarning] = useState(false);
  const blocked = useRef(false);
  const serverCart = useServerCart(
    authenticated?.id,
    identity.loading,
    setNotice,
  );
  function commit(next: DemoState) {
    snapshot.current = next;
    setState(next);
    if (!blocked.current)
      try {
        // Server carts and inventory, including revealed keys, are never persisted here.
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            ...next,
            products: catalog.current,
            keys: [],
            carts: {},
            currentUserId: null,
            users: next.users.filter(
              (u) => u.id === "demo-admin" || u.id === "demo-customer",
            ),
            orders: [],
          }),
        );
      } catch {
        blocked.current = true;
        setStorageWarning(true);
      }
  }
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data: unknown = JSON.parse(raw);
        if (isDemoState(data))
          commit({
            ...withCatalog(data, catalog.current),
            orders: [],
            keys: [],
            carts: {},
          });
        else {
          blocked.current = true;
          setStorageWarning(true);
        }
      }
    } catch {
      blocked.current = true;
      setStorageWarning(true);
    }
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    catalog.current = initialProducts;
    commit({
      ...snapshot.current,
      products: initialProducts,
      keys: [],
      carts: {},
    });
  }, [initialProducts]);
  async function refreshCatalog() {
    const sequence = ++requestSequence.current;
    const response = await fetch("/api/catalog", { cache: "no-store" });
    if (!response.ok) throw new Error("catalogue");
    const { products } = (await response.json()) as { products: Product[] };
    if (sequence !== requestSequence.current) return;
    catalog.current = products;
    commit({ ...snapshot.current, products });
  }
  useEffect(() => {
    const sync = () => {
      if (!document.hidden)
        void refreshCatalog().catch(() => setNotice("catalogUnavailable"));
    };
    sync();
    const interval = setInterval(sync, 15000);
    window.addEventListener("focus", sync);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", sync);
    };
  }, [pathname]);
  const user: DemoUser | null = authenticated
    ? {
        id: authenticated.id,
        email: authenticated.email,
        nickname: authenticated.name || "Player",
        discord: authenticated.discord,
        role: authenticated.role,
        active: true,
      }
    : null;
  useEffect(() => {
    if (!hydrated || identity.loading) return;
    const users = snapshot.current.users.filter(
      (u) => u.id === "demo-admin" || u.id === "demo-customer",
    );
    commit({
      ...snapshot.current,
      currentUserId: authenticated?.id ?? null,
      users: authenticated
        ? [
            ...users,
            {
              id: authenticated.id,
              email: authenticated.email,
              nickname: authenticated.name || "Player",
              discord: authenticated.discord,
              role: authenticated.role,
              active: true,
            },
          ]
        : users,
    });
  }, [
    hydrated,
    identity.loading,
    authenticated?.id,
    authenticated?.name,
    authenticated?.email,
    authenticated?.discord,
    authenticated?.role,
  ]);
  const products = [...state.products];
  for (const product of serverCart.data?.products ?? []) {
    const index = products.findIndex((p) => p.id === product.id);
    if (index < 0) products.push(product);
    else products[index] = product;
  }
  const cart = serverCart.data?.items ?? [];
  async function checkout(input: OrderInput) {
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status >= 500) throw new Error("unavailable");
      await serverCart.refresh().catch(() => {});
      await refreshCatalog().catch(() => {});
      return {
        error: (result.error === "demoDisabled"
          ? "demoDisabled"
          : result.error === "cartConflict"
            ? "cartConflict"
            : result.error === "emptyError"
              ? "emptyError"
              : result.error === "orderConflict"
                ? "orderConflict"
                : result.error === "forbidden"
                  ? "signInRequired"
                  : "saveError") as CopyKey,
      };
    }
    await serverCart.refresh().catch(() => {});
    await refreshCatalog().catch(() => {});
    await identity.refresh();
    return {
      order: result.order as { id: string; status: "completed" | "failed" },
    };
  }
  function reset() {
    blocked.current = false;
    setStorageWarning(false);
    const next = fresh();
    if (user) {
      next.users.push(user);
      next.currentUserId = user.id;
    }
    commit(next);
    setNotice("resetDone");
  }
  return {
    state: { ...state, products },
    ready:
      hydrated &&
      !identity.loading &&
      !serverCart.loading &&
      (!user || state.currentUserId === user.id),
    notice,
    setNotice,
    storageWarning,
    user,
    cart,
    cartBusy: serverCart.busy,
    cartError: serverCart.error,
    cartValid: serverCart.data?.valid ?? true,
    cartTotal: serverCart.data?.totalCents ?? 0,
    cartRevision: serverCart.data?.revision ?? 0,
    cartFingerprint: serverCart.data?.fingerprint ?? "",
    refreshCart: serverCart.refresh,
    quantity: serverCart.quantity,
    add: serverCart.add,
    refreshCatalog,
    checkout,
    reset,
    signOut: async () => {
      try {
        await identity.signOut();
      } catch {
        setNotice("authUnavailable");
      }
    },
    stock: (id: string) =>
      products.find((p) => p.id === id)?.availableStock ?? 0,
  };
}
const DemoContext = createContext<ReturnType<typeof useDemoStore> | null>(null);
export function DemoProvider({
  children,
  initialProducts,
}: {
  children: ReactNode;
  initialProducts: Product[];
}) {
  const value = useDemoStore(initialProducts);
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}
export function useDemo() {
  const value = useContext(DemoContext);
  if (!value) throw new Error("DemoProvider missing");
  return value;
}
