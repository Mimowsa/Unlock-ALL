"use client";
import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  KeyRound,
  ShoppingBag,
} from "lucide-react";
import { useCopy } from "@/i18n/client";
import { useDemo } from "@/demo/provider";
import { Button } from "@/components/ui/button";
import { ProductCard } from "./product-card";
import { EmptyState } from "@/components/layout/site-shell";
export function ProductPage({ slug }: { slug: string }) {
  const { t, href, locale, money } = useCopy();
  const { state, stock, add, cartBusy, cartError } = useDemo();
  const [quantity, setQuantity] = useState(1);
  const product = state.products.find((p) => p.slug === slug && p.published);
  if (!product)
    return (
      <div className="container page-space">
        <EmptyState title={t("notFound")} />
      </div>
    );
  const count = stock(product.id);
  const variants = state.products.filter(
    (p) => p.category === product.category && p.published,
  );
  return (
    <div className="container page-space">
      <Link href={href("boutique")} className="back-link">
        <ArrowLeft size={15} />
        {t("backShop")}
      </Link>
      <div className="product-detail">
        <div className="detail-art">
          <Image
            src={product.image ?? `/images/${product.art}.svg`}
            unoptimized={!!product.image}
            fill
            sizes="(max-width: 768px) 100vw, 50vw"
            alt={`${t("imageAlt")} ${product.name[locale]}`}
            priority
          />
          <span className="art-edition">{t("edition")}</span>
          <div className="detail-art-label">
            <span>CALL OF DUTY</span>
            <strong>{product.name[locale]}</strong>
          </div>
        </div>
        <div className="detail-copy">
          <p className="eyebrow">
            <span className="tiny-square" />
            CALL OF DUTY / {t("demo")}
          </p>
          <h1>{product.name[locale]}</h1>
          <p>{product.description[locale]}</p>
          <div className="detail-price">
            <strong>{money(product.price)}</strong>
            <span>{t("fictionalPrice")}</span>
          </div>
          <label className="field-label">{t("platform")}</label>
          <div className="platform-options">
            {variants.map((p) => (
              <Link
                key={p.id}
                aria-current={p.id === product.id ? "page" : undefined}
                className={p.id === product.id ? "selected" : ""}
                href={href(`produits/${p.slug}`)}
              >
                {p.platform}
              </Link>
            ))}
          </div>
          <div
            className={`detail-stock ${count ? "stock-positive" : "stock-empty"}`}
          >
            <span className="status-dot" />
            {count ? `${count} ${t("stock")}` : t("restock")}
          </div>
          <div className="add-row">
            <label>
              <span className="sr-only">{t("qty")}</span>
              <input
                type="number"
                min="1"
                max={Math.max(count, 1)}
                value={quantity}
                disabled={!count}
                onChange={(e) =>
                  setQuantity(
                    Math.max(1, Math.min(Number(e.target.value), count)),
                  )
                }
              />
            </label>
            <Button
              disabled={
                cartBusy || cartError || !count || !Number.isInteger(quantity)
              }
              onClick={() => add(product.id, quantity)}
            >
              <ShoppingBag size={17} />
              {t("add")}
              <ArrowUpRight size={18} />
            </Button>
          </div>
          <div className="demo-callout">
            <KeyRound size={18} />
            <p>{t("productDisclaimer")}</p>
          </div>
          <h2>{t("included")}</h2>
          <ul className="included-list">
            {(["included1", "included2", "included3"] as const).map((k) => (
              <li key={k}>
                <Check size={16} />
                {t(k)}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <section className="related-section">
        <div className="section-heading">
          <h2>{t("related")}</h2>
        </div>
        <div className="product-grid">
          {state.products
            .filter(
              (p) =>
                p.published &&
                p.category !== product.category &&
                p.platform === product.platform,
            )
            .slice(0, 3)
            .map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
        </div>
      </section>
    </div>
  );
}
