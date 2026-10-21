"use client";
import Link from "next/link";
import { useIdentity } from "@/features/authentication/session-provider";
import { useOrders } from "@/features/orders/use-orders";
import { useCopy } from "@/i18n/client";
export function PendingPayPal() {
  const { user } = useIdentity();
  return <Pending key={user?.id} />;
}
function Pending() {
  const { t, href, money } = useCopy();
  const resource = useOrders<{
    checkouts: { id: string; status: string; amountCents: number }[];
  }>("/api/paypal/checkouts");
  if (!resource.data?.checkouts.length) return null;
  return (
    <section className="panel paypal-pending">
      <h2>{t("paypalPendingTitle")}</h2>
      <p className="micro-copy">{t("paypalSandboxNote")}</p>
      {resource.data.checkouts.map((c) => (
        <p key={c.id}>
          <Link className="text-link" href={href(`commande/paypal/${c.id}`)}>
            {t("paypalResume")} · {money(c.amountCents)}
          </Link>
        </p>
      ))}
    </section>
  );
}
