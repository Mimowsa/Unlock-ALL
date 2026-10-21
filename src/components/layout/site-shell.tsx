"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  ShoppingBag,
  Menu,
  X,
  UserRound,
  ArrowDownRight,
  Gamepad2,
  ShieldCheck,
} from "lucide-react";
import { useCopy } from "@/i18n/client";
import { useDemo } from "@/demo/provider";
import { Button } from "@/components/ui/button";

export function Brand({ footer = false }: { footer?: boolean }) {
  const { href, t } = useCopy();
  return (
    <Link
      className={`brand ${footer ? "brand-footer" : ""}`}
      href={href()}
      aria-label={t("brandLabel")}
    >
      <span className="brand-mark">
        <ArrowUpRight strokeWidth={3} />
      </span>
      <span>
        UNLOCK<span className="brand-dash">-</span>ALL
        <span className="brand-dot">®</span>
      </span>
    </Link>
  );
}
function Header() {
  const { t, locale, href } = useCopy();
  const { cart, user, signOut } = useDemo();
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
  }, [path]);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return (
    <>
      <div className="announcement">
        <span className="announcement-label">{t("demo")}</span>
        <span>{t("demoBanner")}</span>
        <ArrowUpRight size={13} />
      </div>
      <header className="site-header">
        <div className="container header-inner">
          <Brand />
          <nav className="desktop-nav" aria-label={t("navigation")}>
            {[
              ["", "home"],
              ["boutique", "shop"],
              ["support", "support"],
            ].map(([url, key]) => (
              <Link
                key={key}
                href={href(url)}
                className={path === href(url) ? "active" : ""}
              >
                {t(key as "home" | "shop" | "support")}
              </Link>
            ))}
          </nav>
          <div className="header-actions">
            <label className="language-select">
              <span className="sr-only">FR / EN</span>
              <select
                aria-label="FR / EN"
                value={locale}
                onChange={(e) =>
                  router.push(path.replace(/^\/(fr|en)/, `/${e.target.value}`))
                }
              >
                <option value="fr">FR</option>
                <option value="en">EN</option>
              </select>
            </label>
            <Link
              className="cart-link"
              href={href("panier")}
              aria-label={`${t("cart")} (${cart.reduce((n, i) => n + i.quantity, 0)})`}
            >
              <ShoppingBag size={19} />
              <span>{cart.reduce((n, i) => n + i.quantity, 0)}</span>
            </Link>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="desktop-account"
            >
              <Link href={href(user ? "compte" : "connexion")}>
                <UserRound size={15} />
                {user ? user.nickname : t("login")}
              </Link>
            </Button>
            <button
              className="mobile-menu button button-ghost button-icon"
              aria-expanded={open}
              aria-controls="mobile-navigation"
              aria-label={t(open ? "close" : "menu")}
              onClick={() => setOpen(!open)}
            >
              {open ? <X /> : <Menu />}
            </button>
          </div>
        </div>
        {open && (
          <nav
            id="mobile-navigation"
            className="mobile-navigation"
            aria-label={t("navigation")}
          >
            <Link href={href()}>{t("home")}</Link>
            <Link href={href("boutique")}>{t("shop")}</Link>
            <Link href={href("support")}>{t("support")}</Link>
            <Link href={href(user ? "compte" : "connexion")}>
              {t(user ? "account" : "login")}
            </Link>
            {user && <button onClick={signOut}>{t("logout")}</button>}
          </nav>
        )}
      </header>
    </>
  );
}
function Footer() {
  const { t, href } = useCopy();
  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div>
          <Brand footer />
          <p>{t("footerText")}</p>
          <span className="eyebrow footer-demo">
            <span className="status-dot" />
            {t("demoProduct")}
          </span>
        </div>
        <div>
          <h2>{t("navigation")}</h2>
          <Link href={href("boutique")}>{t("shop")}</Link>
          <Link href={href("compte")}>{t("account")}</Link>
          <Link href={href("support")}>{t("support")}</Link>
        </div>
        <div>
          <h2>{t("information")}</h2>
          <Link href={href("mentions")}>{t("legal")}</Link>
          <Link href={href("conditions")}>{t("terms")}</Link>
          <Link href={href("confidentialite")}>{t("privacy")}</Link>
        </div>
        <div className="footer-statement">
          <Gamepad2 size={25} />
          <span>
            {t("chapter")
              .split("\n")
              .map((line) => (
                <span key={line}>
                  {line}
                  <br />
                </span>
              ))}
          </span>
          <ArrowDownRight size={28} />
        </div>
      </div>
      <div className="container footer-bottom">
        <span>
          © {new Date().getFullYear()} {t("rights")}
        </span>
        <span>{t("unaffiliated")}</span>
      </div>
    </footer>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && (
          <p className="eyebrow">
            <span className="tiny-square" />
            {eyebrow}
          </p>
        )}
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {children}
    </div>
  );
}
export function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  const { t, href } = useCopy();
  return (
    <div className="empty-state">
      <ShoppingBag size={34} />
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      <Button asChild>
        <Link href={href("boutique")}>
          {t("browse")}
          <ArrowRight size={17} />
        </Link>
      </Button>
    </div>
  );
}
export function SiteShell({ children }: { children: ReactNode }) {
  const { t } = useCopy();
  const { notice, ready, storageWarning, cartError, refreshCart } = useDemo();
  return (
    <>
      <a className="skip-link" href="#main">
        {t("skip")}
      </a>
      <Header />
      {storageWarning && (
        <div className="storage-warning" role="alert">
          {t("storageError")}
        </div>
      )}
      {cartError && (
        <div className="storage-warning" role="alert">
          {t("cartUnavailable")}{" "}
          <button
            className="text-link"
            onClick={() => void refreshCart().catch(() => {})}
          >
            {t("tryAgain")}
          </button>
        </div>
      )}
      <main id="main" tabIndex={-1}>
        {ready ? (
          children
        ) : (
          <div className="container page-space">
            <div className="loading-state" role="status">
              <ShieldCheck size={30} />
              {t("loading")}
            </div>
          </div>
        )}
      </main>
      <Footer />
      {notice && (
        <div className="toast" role="status">
          <ShieldCheck size={18} />
          {t(notice)}
        </div>
      )}
    </>
  );
}
