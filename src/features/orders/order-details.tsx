"use client";
import Link from "next/link";
import { useState, useEffect } from "react";
import { Check, XCircle, Copy, Download, ArrowUpRight } from "lucide-react";
import { useCopy } from "@/i18n/client";
import { useDemo } from "@/demo/provider";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/layout/site-shell";
import { AdminDataState } from "@/features/administration/data-state";
import { useOrders } from "./use-orders";
import type { OrderView } from "@/types/orders";
export function RemoteOrderDetails(props: {
  id: string;
  confirmation?: boolean;
  admin?: boolean;
}) {
  const { user } = useDemo();
  return <Details key={`${user?.id}:${props.admin}:${props.id}`} {...props} />;
}
function Details({
  id,
  confirmation = false,
  admin = false,
}: {
  id: string;
  confirmation?: boolean;
  admin?: boolean;
}) {
  const { t, href, locale, money, date } = useCopy();
  const { setNotice } = useDemo();
  const [copied, setCopied] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const resource = useOrders<{ order: OrderView }>(
    admin ? `/api/admin/orders/${id}` : `/api/orders/${id}`,
  );
  useEffect(() => {
    if (resource.data?.order.email.status !== "queued") return;
    const timer = setTimeout(resource.refresh, 3000);
    return () => clearTimeout(timer);
  }, [resource.data, resource.refresh]);
  async function retryEmail() {
    setEmailBusy(true);
    try {
      const response = await fetch(
        `/api/admin/orders/${encodeURIComponent(id)}/emails/retry`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      setNotice(response.ok ? "emailRetryScheduled" : "emailRetryUnavailable");
      resource.refresh();
    } catch {
      setNotice("emailRetryUnavailable");
    } finally {
      setEmailBusy(false);
    }
  }
  if (!resource.data)
    return (
      <div className="container page-space">
        <AdminDataState error={resource.error} retry={resource.retry} />
      </div>
    );
  const order = resource.data.order;
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      setNotice("copied");
    } catch {
      setNotice("copyFailed");
    }
  }
  return (
    <div className="container page-space">
      <div className={`order-success ${order.status}`}>
        {order.status === "completed" ? (
          <Check size={30} />
        ) : (
          <XCircle size={30} />
        )}
      </div>
      <PageHeading
        eyebrow={t("demo")}
        title={t(
          order.status === "failed"
            ? "orderFailed"
            : confirmation
              ? "successTitle"
              : "orderDetails",
        )}
        description={t(
          order.status === "failed" ? "orderFailedText" : "successText",
        )}
      />
      {order.paypal && (
        <p className="demo-callout">
          {t(
            ["REFUNDED", "PARTIALLY_REFUNDED", "REVERSED"].includes(
              order.paypal.status,
            )
              ? "paypalRefunded"
              : "paypalPayment",
          )}
          {admin && (
            <span>
              {" "}
              · {order.paypal.account} · {order.paypal.status} ·{" "}
              {order.paypal.captureId}
            </span>
          )}
        </p>
      )}
      <div className="order-info">
        <div>
          <span>{t("reference")}</span>
          <strong>{order.reference}</strong>
        </div>
        <div>
          <span>{t("date")}</span>
          <strong>{date(order.date)}</strong>
        </div>
        <div>
          <span>{t("total")}</span>
          <strong>{money(order.total)}</strong>
        </div>
        <div>
          <span>{t("status")}</span>
          <strong className={`badge ${order.status}`}>{t(order.status)}</strong>
        </div>
      </div>
      {order.items.map((item, i) => (
        <section className="panel order-delivery" key={i}>
          <div className="delivery-heading">
            <div>
              <h2>{item.name[locale]}</h2>
              <p>
                {item.platform} · {t("qty")} : {item.quantity} ·{" "}
                {money(item.unitPrice)}
              </p>
            </div>
            {order.status === "completed" && item.download && (
              <Button variant="outline" asChild size="sm">
                <a href={item.download!} download>
                  <Download size={15} />
                  {t("download")}
                </a>
              </Button>
            )}
          </div>
          {item.keys.length > 0 && (
            <>
              <h3>{t("keys")}</h3>
              {item.keys.map((key) => (
                <div className="key-row" key={key}>
                  <code>{key}</code>
                  <button aria-label={t("copy")} onClick={() => copy(key)}>
                    {copied === key ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                </div>
              ))}
            </>
          )}
        </section>
      ))}
      <section className="demo-callout" aria-live="polite">
        <p>
          {t(
            order.email.status === "accepted"
              ? "emailAccepted"
              : order.email.status === "queued"
                ? "emailQueued"
                : order.email.status === "failed"
                  ? "emailFailed"
                  : order.email.status === "restricted"
                    ? "emailRestricted"
                    : "emailNotSent",
          )}
        </p>
        {admin &&
          order.email.jobs?.map((job) => (
            <p className="micro-copy" key={job.kind}>
              {job.kind} · {job.status} · {job.attempts}
              {job.lastErrorCode ? ` · ${job.lastErrorCode}` : ""}
            </p>
          ))}
        {admin && order.email.status === "failed" && (
          <Button
            variant="outline"
            size="sm"
            disabled={emailBusy}
            onClick={retryEmail}
          >
            {t(emailBusy ? "loading" : "retryEmail")}
          </Button>
        )}
      </section>
      <p className="micro-copy">{t("demoDetails")}</p>
      <Button variant="outline" asChild>
        <Link href={href(admin ? "admin/commandes" : "compte/commandes")}>
          {t("orders")}
          <ArrowUpRight size={16} />
        </Link>
      </Button>
    </div>
  );
}
