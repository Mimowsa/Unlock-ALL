"use client";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowLeft,
  ArrowUpRight,
  Minus,
  Plus,
  Trash2,
  ShieldCheck,
} from "lucide-react";
import { useCopy } from "@/i18n/client";
import { useDemo } from "@/demo/provider";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeading } from "@/components/layout/site-shell";
export function CartSummary({ children }: { children?: React.ReactNode }) {
  const { t, money } = useCopy();
  const { cartTotal } = useDemo();
  const total = cartTotal;
  return (
    <aside className="summary-panel">
      <h2>{t("summary")}</h2>
      <div className="summary-line">
        <span>{t("subtotal")}</span>
        <span>{money(total)}</span>
      </div>
      <div className="summary-total">
        <span>{t("total")}</span>
        <strong>{money(total)}</strong>
      </div>
      {children}
      <p className="secure-note">
        <ShieldCheck size={16} />
        {t("free")}
      </p>
      <p className="micro-copy">{t("demoDetails")}</p>
    </aside>
  );
}
export function Cart() {
  const { t, href, locale, money } = useCopy();
  const { state, cart, stock, quantity, user, cartBusy, cartError, cartValid } =
    useDemo();
  return (
    <div className="container page-space">
      <PageHeading
        eyebrow={t("demo")}
        title={t("cart")}
        description={t("free")}
      />
      <p className="micro-copy">{t("cartNoReservation")}</p>
      {cartError ? (
        <p className="form-error" role="alert">
          {t("cartUnavailable")}
        </p>
      ) : !cart.length ? (
        <EmptyState
          title={t("emptyCart")}
          description={t("emptyCartDescription")}
        />
      ) : (
        <div className="checkout-layout">
          <div className="cart-lines">
            {cart.map((item) => {
              const product = state.products.find(
                (p) => p.id === item.productId,
              );
              if (!product) return null;
              const count = stock(product.id);
              return (
                <article className="cart-item" key={product.id}>
                  <Link
                    href={href(`produits/${product.slug}`)}
                    className="cart-art"
                  >
                    <Image
                      src={product.image ?? `/images/${product.art}.svg`}
                      unoptimized={!!product.image}
                      fill
                      sizes="100px"
                      alt={product.name[locale]}
                    />
                  </Link>
                  <div className="cart-item-info">
                    <p className="eyebrow">CALL OF DUTY / {product.platform}</p>
                    <Link href={href(`produits/${product.slug}`)}>
                      <h2>{product.name[locale]}</h2>
                    </Link>
                    <span
                      className={
                        count && product.published
                          ? "stock-positive"
                          : "stock-empty"
                      }
                    >
                      {t(
                        count && product.published ? "available" : "outOfStock",
                      )}
                    </span>
                    <div className="quantity-control">
                      <button
                        disabled={cartBusy || item.quantity <= 1}
                        aria-label={t("decrease")}
                        onClick={() => quantity(product.id, item.quantity - 1)}
                      >
                        <Minus size={14} />
                      </button>
                      <span>{item.quantity}</span>
                      <button
                        disabled={cartBusy || item.quantity >= count}
                        aria-label={t("increase")}
                        onClick={() => quantity(product.id, item.quantity + 1)}
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                    {item.quantity > count && (
                      <p className="form-error">{t("stockError")}</p>
                    )}
                  </div>
                  <div className="cart-item-end">
                    <strong>{money(product.price * item.quantity)}</strong>
                    <button
                      disabled={cartBusy}
                      aria-label={`${t("remove")} ${product.name[locale]}`}
                      onClick={() => quantity(product.id, 0)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </article>
              );
            })}
            <Link className="back-link" href={href("boutique")}>
              <ArrowLeft size={15} />
              {t("continue")}
            </Link>
          </div>
          <CartSummary>
            {!cartValid && (
              <p className="form-error" role="alert">
                {t("stockError")}
              </p>
            )}
            <Button asChild>
              <Link href={href(user ? "commande" : "connexion?next=commande")}>
                {t("checkout")}
                <ArrowUpRight size={17} />
              </Link>
            </Button>
          </CartSummary>
        </div>
      )}
    </div>
  );
}
