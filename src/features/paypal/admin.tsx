"use client";
import Link from "next/link";
import { useState } from "react";
import { useCopy } from "@/i18n/client";
import { useOrders } from "@/features/orders/use-orders";
import { AdminDataState } from "@/features/administration/data-state";
import { Button } from "@/components/ui/button";
export function PayPalAdmin() {
  const { t, href, money, date } = useCopy(),
    [busy, setBusy] = useState(""),
    [failed, setFailed] = useState(false);
  const resource = useOrders<{
    payments: {
      id: string;
      status: string;
      createdAt: string;
      amountCents: number;
      customerEmail: string;
      paypalOrderId: string | null;
      captureId: string | null;
      errorCode: string | null;
      merchant: { label: string };
      order: { id: string } | null;
    }[];
  }>("/api/admin/paypal");
  async function check(id: string) {
    setBusy(id);
    setFailed(false);
    try {
      const response = await fetch("/api/admin/paypal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) throw new Error();
      resource.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <p className="demo-callout">{t("paypalSandboxNote")}</p>
      {failed && (
        <p role="alert" className="form-error">
          {t("paypalUncertain")}
        </p>
      )}
      {!resource.data ? (
        <AdminDataState error={resource.error} retry={resource.retry} />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {(
                  [
                    "customer",
                    "date",
                    "total",
                    "status",
                    "paypalAccount",
                    "reference",
                    "actions",
                  ] as const
                ).map((k) => (
                  <th key={k}>{t(k)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {resource.data.payments.map((p) => (
                <tr key={p.id}>
                  <td>{p.customerEmail}</td>
                  <td>{date(p.createdAt)}</td>
                  <td>{money(p.amountCents)}</td>
                  <td>
                    <span className="badge">{p.status}</span>
                    {p.errorCode && <p className="micro-copy">{p.errorCode}</p>}
                  </td>
                  <td>{p.merchant.label}</td>
                  <td>
                    {p.paypalOrderId ?? "—"}
                    {p.captureId && <p className="micro-copy">{p.captureId}</p>}
                  </td>
                  <td>
                    {p.order && (
                      <Link
                        className="text-link"
                        href={href(`admin/commandes/${p.order.id}`)}
                      >
                        {t("viewOrder")}
                      </Link>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!!busy}
                      onClick={() => void check(p.id)}
                    >
                      {t(busy === p.id ? "loading" : "paypalCheck")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!resource.data.payments.length && (
            <p className="table-empty">{t("emptyOrders")}</p>
          )}
        </div>
      )}
    </>
  );
}
