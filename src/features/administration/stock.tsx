"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Plus, KeyRound, Eye } from "lucide-react";
import { useCopy } from "@/i18n/client";
import { useDemo } from "@/demo/provider";
import { Button } from "@/components/ui/button";
import type { Product } from "@/demo/types";
import type { CopyKey } from "@/i18n/messages";
import { adminWrite, useAdminData } from "./use-admin-data";
import { AdminDataState } from "./data-state";
import { commerceMessage } from "@/features/cart/use-server-cart";
type Inventory = {
  keys: {
    id: string;
    label: string;
    disabled: boolean;
    assigned: boolean;
    reserved: boolean;
    order: { id: string; reference: string } | null;
  }[];
  total: number;
  available: number;
  page: number;
};
export function StockAdmin() {
  const { t, locale } = useCopy();
  const { refreshCatalog, refreshCart, setNotice } = useDemo();
  const products = useAdminData<{ products: Product[] }>("/api/admin/products");
  const [productId, setProductId] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CopyKey | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const chosen = productId || products.data?.products[0]?.id || "";
  const resource = useAdminData<Inventory>(
    chosen
      ? `/api/admin/keys?productId=${encodeURIComponent(chosen)}&page=${page}`
      : null,
  );
  useEffect(() => {
    setRevealed({});
  }, [chosen, page]);
  useEffect(() => {
    const clear = () => {
      if (document.hidden) setRevealed({});
    };
    const timer = setInterval(() => setRevealed({}), 60000);
    document.addEventListener("visibilitychange", clear);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", clear);
    };
  }, []);
  async function changed() {
    resource.reload();
    await refreshCatalog();
    await refreshCart();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    setBusy(true);
    setError(null);
    try {
      await adminWrite("/api/admin/keys", "POST", {
        productId: chosen,
        value: String(new FormData(form).get("key")),
      });
      form.reset();
      setPage(1);
      await changed();
      setNotice("keyAdded");
    } catch (error) {
      setError(
        commerceMessage(error instanceof Error ? error.message : undefined),
      );
    } finally {
      setBusy(false);
    }
  }
  async function toggle(id: string, disabled: boolean) {
    setBusy(true);
    setError(null);
    try {
      await adminWrite(`/api/admin/keys/${id}`, "PATCH", { disabled });
      await changed();
      setNotice("catalogSaved");
    } catch (error) {
      setError(
        commerceMessage(error instanceof Error ? error.message : undefined),
      );
      resource.reload();
    } finally {
      setBusy(false);
    }
  }
  async function reveal(id: string) {
    if (revealed[id]) {
      setRevealed((values) => {
        const next = { ...values };
        delete next[id];
        return next;
      });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await adminWrite(
        `/api/admin/keys/${id}/reveal`,
        "POST",
        {},
      );
      setRevealed((values) => ({ ...values, [id]: result.value }));
    } catch {
      setError("cartUnavailable");
    } finally {
      setBusy(false);
    }
  }
  if (!products.data)
    return <AdminDataState error={products.error} retry={products.reload} />;
  return (
    <>
      {error && (
        <p className="form-error" role="alert">
          {t(error)}
        </p>
      )}
      <section className="panel stock-editor">
        <label className="form-stack">
          {t("product")}
          <select
            value={chosen}
            onChange={(e) => {
              setProductId(e.target.value);
              setPage(1);
              setError(null);
            }}
          >
            {products.data.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name[locale]} · {p.platform}
                {!p.published ? ` · ${t("disabled")}` : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="inventory-count">
          <KeyRound size={22} />
          <strong>
            {resource.loading ? "…" : (resource.data?.available ?? 0)}
          </strong>
          <span>{t("stock")}</span>
        </div>
        <form className="key-form" onSubmit={submit}>
          <label>
            {t("keyValue")}
            <input
              name="key"
              required
              minLength={8}
              maxLength={85}
              pattern="DEMO-[A-Za-z0-9-]{3,80}"
              placeholder="DEMO-UNLOCK-EXAMPLE-001"
              disabled={busy || !chosen}
            />
          </label>
          <Button type="submit" disabled={busy || !chosen}>
            <Plus size={16} />
            {t(busy ? "authWorking" : "addKey")}
          </Button>
        </form>
        <p className="field-hint">{t("keyHelp")}</p>
        <p className="micro-copy">{t("keyPrivacy")}</p>
      </section>
      {resource.error || resource.loading ? (
        <AdminDataState error={resource.error} retry={resource.reload} />
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("keyValue")}</th>
                  <th>{t("status")}</th>
                  <th>{t("reference")}</th>
                  <th>
                    <span className="sr-only">{t("deactivate")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {resource.data?.keys.map((k) => (
                  <tr key={k.id}>
                    <td>
                      <code>{revealed[k.id] ?? k.label}</code>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        aria-label={`${t(revealed[k.id] ? "hideKey" : "revealKey")} ${k.label}`}
                        onClick={() => void reveal(k.id)}
                      >
                        <Eye size={14} />
                        {t(revealed[k.id] ? "hideKey" : "revealKey")}
                      </Button>
                    </td>
                    <td>
                      <span
                        className={`badge ${k.assigned ? "completed" : ""}`}
                      >
                        {t(
                          k.reserved
                            ? "reserved"
                            : k.assigned
                              ? "assigned"
                              : k.disabled
                                ? "keyDisabled"
                                : "keyAvailable",
                        )}
                      </span>
                    </td>
                    <td>{k.order?.reference ?? "—"}</td>
                    <td>
                      {!k.assigned && !k.reserved && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => void toggle(k.id, !k.disabled)}
                        >
                          {t(k.disabled ? "activate" : "deactivate")}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!resource.data?.keys.length && (
              <p className="table-empty">{t("noKeys")}</p>
            )}
          </div>
          <div className="admin-toolbar">
            <Button
              variant="outline"
              disabled={page === 1}
              onClick={() => setPage((n) => n - 1)}
            >
              {t("previousPage")}
            </Button>
            <span>
              {page} /{" "}
              {Math.max(1, Math.ceil((resource.data?.total ?? 0) / 25))}
            </span>
            <Button
              variant="outline"
              disabled={page * 25 >= (resource.data?.total ?? 0)}
              onClick={() => setPage((n) => n + 1)}
            >
              {t("nextPage")}
            </Button>
          </div>
        </>
      )}
    </>
  );
}
