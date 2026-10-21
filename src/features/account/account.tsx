"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  LogOut,
  UserRound,
  Package,
  ShieldCheck,
  Copy,
  Download,
  Check,
  XCircle,
} from "lucide-react";
import { useCopy } from "@/i18n/client";
import { useDemo } from "@/demo/provider";
import { useIdentity } from "@/features/authentication/session-provider";
import { PendingPayPal } from "@/features/paypal/pending";
import { OrderList } from "@/features/orders/order-list";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeading } from "@/components/layout/site-shell";
export function AccountNav({ active }: { active: string }) {
  const { t, href } = useCopy();
  const { user, signOut } = useDemo();
  return (
    <nav className="account-nav" aria-label={t("account")}>
      <Link
        className={active === "profile" ? "selected" : ""}
        href={href("compte")}
      >
        <UserRound size={16} />
        {t("profile")}
      </Link>
      <Link
        className={active === "orders" ? "selected" : ""}
        href={href("compte/commandes")}
      >
        <Package size={16} />
        {t("orders")}
      </Link>
      {user?.role === "ADMIN" && (
        <Link href={href("admin")}>
          <ShieldCheck size={16} />
          {t("admin")}
        </Link>
      )}
      <button onClick={signOut}>
        <LogOut size={16} />
        {t("logout")}
      </button>
    </nav>
  );
}
export function Account({ orders = false }: { orders?: boolean }) {
  const { t, href, date, money } = useCopy();
  const { user, setNotice } = useDemo();
  const { refresh } = useIdentity();
  const [saving, setSaving] = useState(false);
  if (!user)
    return (
      <div className="container page-space">
        <PageHeading title={t("signInRequired")} />
        <Button asChild>
          <Link href={href("connexion")}>{t("login")}</Link>
        </Button>
      </div>
    );
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const discord = String(data.get("discord")).trim();
    if (discord && !/^[a-z0-9_](?!.*\.\.)[a-z0-9_.]{1,31}$/.test(discord)) {
      setNotice("discordRequired");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname: String(data.get("nickname")).trim(),
          discord,
        }),
      });
      if (!response.ok) {
        setNotice("authUnavailable");
        return;
      }
      await refresh();
      setNotice("authProfileSaved");
    } catch {
      setNotice("authUnavailable");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="container page-space">
      <PageHeading
        eyebrow={t("account")}
        title={t(orders ? "orderTitle" : "profileTitle")}
        description={t("profileText")}
      />
      <AccountNav active={orders ? "orders" : "profile"} />
      {orders ? (
        <>
          <PendingPayPal />
          <OrderList />
        </>
      ) : (
        <div className="profile-layout">
          <form className="panel form-stack" onSubmit={save}>
            <h2>{t("profile")}</h2>
            <label>
              {t("nickname")}
              <input
                name="nickname"
                required
                minLength={2}
                maxLength={40}
                defaultValue={user.nickname}
              />
            </label>
            <label>
              {t("email")}
              <input
                name="email"
                type="email"
                required
                maxLength={120}
                defaultValue={user.email}
                readOnly
                aria-describedby="email-readonly"
              />
            </label>
            <p id="email-readonly" className="field-hint">
              {t("authEmailReadonly")}
            </p>
            <label>
              {t("discord")}
              <input
                name="discord"
                minLength={2}
                maxLength={32}
                defaultValue={user.discord}
                placeholder="player.demo"
              />
            </label>
            <p className="field-hint">{t("discordHelp")}</p>
            <Button type="submit" disabled={saving}>
              {t("save")}
              <ArrowUpRight size={16} />
            </Button>
          </form>
          <div className="profile-note">
            <ShieldCheck size={30} />
            <h2>{t("welcome")}</h2>
            <p>{t("demoDetails")}</p>
            <Link className="text-link" href={href("compte/commandes")}>
              {t("orders")}
              <ArrowUpRight size={16} />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export { RemoteOrderDetails as OrderDetails } from "@/features/orders/order-details";
