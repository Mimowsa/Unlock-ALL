"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useEffect, type FormEvent } from "react";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { useCopy } from "@/i18n/client";
import { useDemo } from "@/demo/provider";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeading } from "@/components/layout/site-shell";
import { CartSummary } from "@/features/cart/cart";
import type { OrderInput } from "@/validation/orders";
import type { CopyKey } from "@/i18n/messages";
export function Checkout() {
  const { t, href, locale, money } = useCopy();
  const {
    user,
    cart,
    state,
    checkout,
    cartBusy,
    cartError,
    cartValid,
    cartRevision,
    cartFingerprint,
  } = useDemo();
  const router = useRouter();
  const [error, setError] = useState<CopyKey | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const attempt = useRef<OrderInput | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [paypalReady, setPaypalReady] = useState(false);
  const paymentAttempt = useRef<"simulation" | "paypal">("simulation");
  useEffect(() => {
    fetch("/api/paypal/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((body) => setPaypalReady(body.enabled === true))
      .catch(() => {});
  }, []);
  if (!user)
    return (
      <div className="container page-space">
        <PageHeading title={t("signInRequired")} />
        <Button asChild>
          <Link href={href("connexion?next=commande")}>{t("login")}</Link>
        </Button>
      </div>
    );
  if (cartError)
    return (
      <div className="container page-space">
        <p role="alert">{t("cartUnavailable")}</p>
      </div>
    );
  if (!cart.length && !busy && !uncertain)
    return (
      <div className="container page-space">
        <EmptyState
          title={t("emptyCart")}
          description={t("emptyCartDescription")}
        />
      </div>
    );
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting.current) return;
    const data = new FormData(e.currentTarget);
    if (!uncertain && !data.get("consent")) {
      setError("consentError");
      return;
    }
    if (!attempt.current)
      paymentAttempt.current =
        (e.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ===
        "paypal"
          ? "paypal"
          : "simulation";
    submitting.current = true;
    setBusy(true);
    setError(null);
    attempt.current ||= {
      idempotencyKey: crypto.randomUUID(),
      cartRevision,
      cartFingerprint,
      discord: String(data.get("discord")).trim(),
      locale: locale.toUpperCase() as "FR" | "EN",
      consent: true,
    };
    let result;
    try {
      if (paymentAttempt.current === "paypal") {
        const response = await fetch("/api/paypal/checkouts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(attempt.current),
        });
        const body = await response.json();
        if (!response.ok) {
          if (response.status >= 500 || body.error === "paypalBusy")
            throw new Error();
          result = {
            error: (body.error === "stockError"
              ? "stockError"
              : body.error === "cartConflict"
                ? "cartConflict"
                : "paypalUnavailable") as CopyKey,
          };
        } else {
          router.push(href(`commande/paypal/${body.checkout.id}`));
          return;
        }
      } else result = await checkout(attempt.current);
    } catch {
      setError(
        paymentAttempt.current === "paypal"
          ? "paypalUncertain"
          : "orderUncertain",
      );
      setUncertain(true);
      submitting.current = false;
      setBusy(false);
      return;
    }
    if (result.order) router.push(href(`confirmation/${result.order.id}`));
    else {
      setError(result.error ?? "stockError");
      if (result.error !== "orderConflict") {
        attempt.current = null;
        setUncertain(false);
      }
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="container page-space">
      <PageHeading
        eyebrow={t("demo")}
        title={t("checkoutTitle")}
        description={t("checkoutText")}
      />
      <form onSubmit={submit} className="checkout-layout">
        <div className="panel">
          <h2>{t("products")}</h2>
          {cart.map((i) => {
            const p = state.products.find((p) => p.id === i.productId)!;
            return (
              <div className="checkout-product" key={p.id}>
                <div>
                  <strong>{p.name[locale]}</strong>
                  <p>
                    {p.platform} · {t("qty")} : {i.quantity}
                  </p>
                </div>
                <strong>{money(p.price * i.quantity)}</strong>
              </div>
            );
          })}
          <div className="form-stack checkout-discord">
            <label>
              {t("discord")}
              <input
                name="discord"
                disabled={busy || uncertain}
                defaultValue={user.discord}
                required
                minLength={2}
                maxLength={32}
                pattern="[a-z0-9_][a-z0-9_.]{1,31}"
                placeholder="player.demo"
                aria-describedby="discord-hint"
              />
            </label>
            <p id="discord-hint" className="field-hint">
              {t("discordHelp")} {t("discordRequired")}
            </p>
            <label className="checkbox-label">
              <input
                name="consent"
                type="checkbox"
                required
                disabled={busy || uncertain}
              />
              {t("demoConsent")}
            </label>
          </div>
          {!cartValid && (
            <p role="alert" className="form-error">
              {t("stockError")}
            </p>
          )}
          {error && (
            <p role="alert" className="form-error">
              {t(error)}
            </p>
          )}
          <p className="micro-copy">{t("refreshDisclaimer")}</p>
        </div>
        <CartSummary>
          {(!uncertain || paymentAttempt.current === "simulation") && (
            <Button
              type="submit"
              value="simulation"
              disabled={busy || cartBusy || (!uncertain && !cartValid)}
            >
              <ShieldCheck size={17} />
              {t(busy ? "simulating" : uncertain ? "retryOrder" : "simulate")}
              <ArrowUpRight size={17} />
            </Button>
          )}
          {paypalReady &&
            (!uncertain || paymentAttempt.current === "paypal") && (
              <>
                <p className="micro-copy">{t("paypalSandboxNote")}</p>
                <Button
                  type="submit"
                  value="paypal"
                  variant="outline"
                  disabled={busy || cartBusy || (!uncertain && !cartValid)}
                >
                  {t(uncertain ? "retryOrder" : "paypalTest")}
                </Button>
              </>
            )}
        </CartSummary>
      </form>
    </div>
  );
}
