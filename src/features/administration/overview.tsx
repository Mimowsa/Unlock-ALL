"use client";
import Link from "next/link";
import { useCopy } from "@/i18n/client";
import { useAdminData } from "./use-admin-data";
import { AdminDataState } from "./data-state";
import type { overview } from "@/server/administration/service";
type Overview = Awaited<ReturnType<typeof overview>>;
export function AdminOverview() {
  const { t, money, date, href } = useCopy();
  const resource = useAdminData<Overview>("/api/admin/overview");
  if (resource.loading || resource.error || !resource.data)
    return <AdminDataState error={resource.error} retry={resource.reload} />;
  const data = resource.data;
  const stats = [
    ["usersCount", data.users],
    ["ordersCount", data.orders],
    ["completedCount", data.completed],
    ["failedCount", data.failed],
    ["availableCount", data.available],
    ["soldOutCount", data.soldOut],
  ] as const;
  return (
    <>
      <div className="stats-grid">
        {stats.map(([label, value]) => (
          <div className="stat-card" key={label}>
            <span>{t(label)}</span>
            <strong>{value.toString().padStart(2, "0")}</strong>
            <span className="stat-rule" />
          </div>
        ))}
      </div>
      <div className="value-card">
        <div>
          <span>{t("simulatedValue")}</span>
          <p>{t("notRevenue")}</p>
        </div>
        <strong>{money(Number(data.valueCents))}</strong>
      </div>
      <h2 className="admin-section-heading">{t("recentOrders")}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {(
                ["reference", "customer", "date", "status", "total"] as const
              ).map((k) => (
                <th key={k}>{t(k)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.recentOrders.map((o) => (
              <tr key={o.id}>
                <td>
                  <Link
                    className="text-link"
                    href={href(`admin/commandes/${o.id}`)}
                  >
                    {o.reference}
                  </Link>
                </td>
                <td>{o.customer}</td>
                <td>{date(o.date)}</td>
                <td>
                  <span className="badge">
                    {o.status === "COMPLETED"
                      ? t("completed")
                      : o.status === "FAILED"
                        ? t("failed")
                        : t("processingOrder")}
                  </span>
                </td>
                <td>{money(Number(o.totalCents))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.recentOrders.length && (
          <p className="table-empty">{t("emptyOrders")}</p>
        )}
      </div>
      <p className="micro-copy">{t("serverStatsNote")}</p>
    </>
  );
}
