"use client";
import { useEffect, useState, useCallback } from "react";
import type { CopyKey } from "@/i18n/messages";
export function useOrders<T>(url: string) {
  const [state, setState] = useState<{
    url: string;
    data: T | null;
    error: CopyKey | null;
  }>({ url: "", data: null, error: null });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok)
          throw new Error(
            response.status === 404 ? "noOrder" : "ordersUnavailable",
          );
        if (!controller.signal.aborted) setState({ url, data, error: null });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({
            url,
            data: null,
            error:
              error.message === "noOrder" ? "noOrder" : "ordersUnavailable",
          });
      });
    return () => controller.abort();
  }, [url, version]);
  const refresh = useCallback(() => setVersion((n) => n + 1), []);
  return {
    refresh,
    data: state.url === url ? state.data : null,
    error: state.url === url ? state.error : null,
    retry: () => {
      setState({ url: "", data: null, error: null });
      setVersion((n) => n + 1);
    },
  };
}
