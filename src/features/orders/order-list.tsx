"use client";
import Link from "next/link";
import { useIdentity } from "@/features/authentication/session-provider";
import { useState } from "react";
import { Search, ArrowUpRight } from "lucide-react";
import { useCopy } from "@/i18n/client";
import { Button } from "@/components/ui/button";
import { useOrders } from "./use-orders";
import { AdminDataState } from "@/features/administration/data-state";
import type { OrderSummary } from "@/types/orders";
export function OrderList(props: { admin?: boolean; compact?: boolean }) {
  const { user } = useIdentity();
  return <List key={`${user?.id}:${props.admin}`} {...props} />;
}
function List({
  admin = false,
  compact = false,
}: {
  admin?: boolean;
  compact?: boolean;
}) {
  const { t, href, date, money } = useCopy();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const resource = useOrders<{
    orders: OrderSummary[];
    total: number;
    page: number;
  }>(
    admin
      ? `/api/admin/orders?q=${encodeURIComponent(query)}&status=${status}&page=${page}`
      : `/api/orders?page=${page}`,
  );
  return (
    <>
      {admin && !compact && (
        <form
          className="admin-toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            setQuery(search.trim());
            setPage(1);
          }}
        >
          <label className="search-field">
            <Search size={16} />
            <input
              aria-label={t("searchOrders")}
              placeholder={t("searchOrders")}
              maxLength={254}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <Button type="submit" size="sm">
            {t("searchAction")}
          </Button>
          <select
            aria-label={t("status")}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">{t("all")}</option>
            <option value="completed">{t("completed")}</option>
            <option value="failed">{t("failed")}</option>
          </select>
        </form>
      )}
      {!resource.data ? (
        <AdminDataState error={resource.error} retry={resource.retry} />
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t("reference")}</th>
                  {admin && <th>{t("customer")}</th>}
                  <th>{t("date")}</th>
                  <th>{t("status")}</th>
                  <th>{t("total")}</th>
                  <th>
                    <span className="sr-only">{t("viewOrder")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {resource.data.orders
                  .slice(0, compact ? 5 : undefined)
                  .map((order) => (
                    <tr key={order.id}>
                      <td>
                        <strong>{order.reference}</strong>
                      </td>
                      {admin && <td>{order.customer}</td>}
                      <td>{date(order.date)}</td>
                      <td>
                        <span className={`badge ${order.status}`}>
                          {t(order.status)}
                        </span>
                      </td>
                      <td>{money(order.total)}</td>
                      <td>
                        <Link
                          className="text-link"
                          aria-label={`${t("viewOrder")} ${order.reference}`}
                          href={href(
                            `${admin ? "admin" : "compte"}/commandes/${order.id}`,
                          )}
                        >
                          {t("viewOrder")}
                          <ArrowUpRight size={15} />
                        </Link>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {!resource.data.orders.length && (
              <p className="table-empty">{t("emptyOrders")}</p>
            )}
          </div>
          {!compact && resource.data.total > 25 && (
            <div className="admin-toolbar">
              <Button
                variant="outline"
                disabled={page === 1}
                onClick={() => setPage((n) => n - 1)}
              >
                {t("previousPage")}
              </Button>
              <span>
                {page} / {Math.ceil(resource.data.total / 25)}
              </span>
              <Button
                variant="outline"
                disabled={page * 25 >= resource.data.total}
                onClick={() => setPage((n) => n + 1)}
              >
                {t("nextPage")}
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
