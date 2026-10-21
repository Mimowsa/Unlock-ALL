"use client";
import { useEffect, useState } from "react";
import type { CopyKey } from "@/i18n/messages";
export function adminError(code?: string): CopyKey {
  return code === "conflict"
    ? "catalogConflict"
    : code === "lastAdmin"
      ? "lastAdmin"
      : code === "invalidInput"
        ? "saveError"
        : code === "forbidden"
          ? "adminForbidden"
          : "catalogUnavailable";
}
export async function adminWrite(url: string, method: string, data: unknown) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "unavailable");
  return result;
}
export function useAdminData<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<CopyKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(url, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        if (!controller.signal.aborted) setData(result);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(adminError(error.message));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [url, revision]);
  return { data, error, loading, reload: () => setRevision((n) => n + 1) };
}
