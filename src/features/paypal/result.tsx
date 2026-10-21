"use client";
import Link from "next/link";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useCopy } from "@/i18n/client";
import { useIdentity } from "@/features/authentication/session-provider";
import { Button } from "@/components/ui/button";
import { PageHeading } from "@/components/layout/site-shell";
import { TransferInstructions } from "./transfer-instructions";
type Payment = {
  id: string;
  status: string;
  amountCents: number;
  approvalUrl: string | null;
  orderId: string | null;
  reference: string | null;
  method: "REFERENCE" | "CHECKOUT";
  transferReference: string | null;
  recipient: string | null;
  payUntil: string | null;
};
export function PayPalResult({ id }: { id: string }) {
  const { user } = useIdentity();
  return <Result id={id} key={`${user?.id}:${id}`} />;
}
function Result({ id }: { id: string }) {
  const { t, href, money } = useCopy(),
    router = useRouter();
  const [data, setData] = useState<Payment | null>(null),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false);
  const running = useRef(false);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/paypal/checkouts/${encodeURIComponent(id)}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error();
      const body = await response.json();
      setData(body.checkout);
      setError(false);
    } catch {
      setError(true);
    }
  }, [id]);
  async function verify(cancel = false) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/paypal/checkouts/${encodeURIComponent(id)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cancel }),
        },
      );
      if (!response.ok) throw new Error();
      const body = await response.json();
      setData(body.checkout);
      setError(false);
    } catch {
      setError(true);
      await refresh();
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (
      data?.method !== "REFERENCE" ||
      ["FULFILLED", "EXPIRED"].includes(data.status)
    )
      return;
    const timer = setInterval(() => void verify(), 65000);
    return () => clearInterval(timer);
  }, [data?.method, data?.status]);
  useEffect(() => {
    let canceled = false;
    refresh().then(() => {
      if (!canceled) void verify();
    });
    return () => {
      canceled = true;
    };
  }, [id]);
  useEffect(() => {
    if (data?.orderId) {
      router.replace(href(`confirmation/${data.orderId}`));
      router.refresh();
    }
  }, [data?.orderId]);
  useEffect(() => {
    if (
      !data ||
      ["CANCELED", "EXPIRED", "DECLINED", "NEEDS_REVIEW", "FULFILLED"].includes(
        data.status,
      )
    )
      return;
    const timer = setTimeout(refresh, 5000);
    return () => clearTimeout(timer);
  }, [data, refresh]);
  const terminal =
      !!data && ["CANCELED", "EXPIRED", "DECLINED"].includes(data.status),
    review = data?.status === "NEEDS_REVIEW";
  return (
    <div className="container narrow page-space">
      <PageHeading
        eyebrow="PAYPAL SANDBOX"
        title={t(
          terminal
            ? "paypalStopped"
            : review
              ? "paypalReviewTitle"
              : data?.method === "REFERENCE"
                ? "transferTitle"
                : "paypalPendingTitle",
        )}
        description={t("paypalSandboxNote")}
      />
      <section className="panel form-stack" aria-busy={busy}>
        {!data && !error && <p role="status">{t("loading")}</p>}
        {data && (
          <>
            <strong>{money(data.amountCents)}</strong>
            <p>
              {t(
                terminal
                  ? "paypalStoppedText"
                  : review
                    ? "paypalReviewText"
                    : data.method === "REFERENCE"
                      ? "transferPending"
                      : "paypalPendingText",
              )}
            </p>
            {data.method === "REFERENCE" &&
              data.recipient &&
              data.transferReference &&
              data.payUntil &&
              !terminal && (
                <TransferInstructions
                  recipient={data.recipient}
                  reference={data.transferReference}
                  payUntil={data.payUntil}
                  allowPayment={!review}
                />
              )}
            {data.reference && data.method !== "REFERENCE" && (
              <p className="micro-copy">
                {t("reference")} : {data.reference}
              </p>
            )}
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {t("paypalUncertain")}
          </p>
        )}
        {!terminal && (
          <Button disabled={busy} onClick={() => void verify()}>
            {t(busy ? "loading" : "paypalCheck")}
          </Button>
        )}
        {data?.approvalUrl && !terminal && (
          <Button variant="outline" asChild>
            <a href={data.approvalUrl}>{t("paypalResume")}</a>
          </Button>
        )}
        {data?.status === "APPROVAL_PENDING" && data.method !== "REFERENCE" && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void verify(true)}
          >
            {t("paypalCancel")}
          </Button>
        )}
        <Link
          className="text-link"
          href={href(terminal ? "panier" : "compte/commandes")}
        >
          {t(terminal ? "cart" : "orders")}
        </Link>
      </section>
    </div>
  );
}
