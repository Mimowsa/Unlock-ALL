"use client";
import { PayPalAdmin } from "@/features/paypal/admin";
import Link from "next/link";
import {
  LayoutDashboard,
  Package,
  KeyRound,
  ShoppingBag,
  Users,
  RotateCcw,
  ArrowUpRight,
} from "lucide-react";
import { useCopy } from "@/i18n/client";
import { useDemo } from "@/demo/provider";
import { PageHeading } from "@/components/layout/site-shell";
import { Button } from "@/components/ui/button";
import { ProductsAdmin } from "./products";
import { StockAdmin } from "./stock";
import { OrdersAdmin } from "./records";
import { UsersAdmin } from "./users";
import { AdminOverview } from "./overview";
export function Admin({ section = "" }: { section?: string }) {
  const { t, href } = useCopy();
  const { user, reset } = useDemo();
  if (user?.role !== "ADMIN")
    return (
      <div className="container page-space">
        <PageHeading
          eyebrow={t("demo")}
          title={t("admin")}
          description={t("adminProfileNote")}
        />
        <Button asChild>
          <Link href={href("connexion")}>
            {t("adminProfile")}
            <ArrowUpRight size={16} />
          </Link>
        </Button>
      </div>
    );
  const nav = [
    { path: "", key: "overview", icon: LayoutDashboard },
    { path: "produits", key: "manageProducts", icon: Package },
    { path: "stocks", key: "manageStock", icon: KeyRound },
    { path: "commandes", key: "manageOrders", icon: ShoppingBag },
    { path: "paiements", key: "paypalPayments", icon: ShoppingBag },
    { path: "utilisateurs", key: "manageUsers", icon: Users },
  ] as const;
  return (
    <div className="container page-space">
      <PageHeading
        eyebrow={t("backOffice")}
        title={t(
          section
            ? (nav.find((n) => n.path === section)?.key ?? "admin")
            : "adminTitle",
        )}
        description={t("adminText")}
      >
        <span className="local-badge">
          {t(
            !section ||
              section === "produits" ||
              section === "utilisateurs" ||
              section === "stocks" ||
              section === "commandes"
              ? "databaseBadge"
              : "localOnly",
          )}
        </span>
      </PageHeading>
      <div className="admin-layout">
        <aside className="admin-sidebar">
          <nav aria-label={t("admin")}>
            {nav.map(({ path, key, icon: Icon }) => (
              <Link
                key={path}
                href={href(`admin${path ? `/${path}` : ""}`)}
                className={section === path ? "selected" : ""}
              >
                <Icon size={17} />
                {t(key)}
              </Link>
            ))}
          </nav>
          <button
            className="reset-button"
            onClick={() => {
              if (window.confirm(t("resetConfirm"))) reset();
            }}
          >
            <RotateCcw size={15} />
            {t("resetDemo")}
          </button>
          <p>{t("adminProfileNote")}</p>
        </aside>
        <div className="admin-content">
          {!section ? (
            <AdminOverview />
          ) : section === "produits" ? (
            <ProductsAdmin />
          ) : section === "stocks" ? (
            <>
              <p className="micro-copy">{t("localStockNote")}</p>
              <StockAdmin />
            </>
          ) : section === "commandes" ? (
            <>
              <OrdersAdmin admin />
            </>
          ) : section === "paiements" ? (
            <PayPalAdmin />
          ) : section === "utilisateurs" ? (
            <UsersAdmin />
          ) : (
            <p>{t("notFound")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
