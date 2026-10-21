"use client";
import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight, Monitor, Gamepad2 } from "lucide-react";
import { useCopy } from "@/i18n/client";
import { useDemo } from "@/demo/provider";
import type { Product } from "@/demo/types";
export function PlatformIcon({
  platform,
  size = 13,
}: {
  platform: string;
  size?: number;
}) {
  return platform === "PC" ? <Monitor size={size} /> : <Gamepad2 size={size} />;
}
export function ProductCard({
  product,
  eager = false,
  headingLevel = 3,
}: {
  product: Product;
  eager?: boolean;
  headingLevel?: 2 | 3;
}) {
  const { t, href, locale, money } = useCopy();
  const { stock } = useDemo();
  const count = stock(product.id);
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <article className="product-card">
      <Link
        className="product-art"
        href={href(`produits/${product.slug}`)}
        tabIndex={-1}
        aria-hidden="true"
      >
        <Image
          src={product.image ?? `/images/${product.art}.svg`}
          unoptimized={!!product.image}
          fill
          loading={eager ? "eager" : "lazy"}
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
          alt=""
        />
        <span className="art-edition">{t("edition")}</span>
        <span className="art-game">
          CALL OF DUTY<span>COLLECTION / 01</span>
        </span>
        <span className="art-arrow">
          <ArrowUpRight size={20} />
        </span>
      </Link>
      <div className="product-meta">
        <span>
          <PlatformIcon platform={product.platform} />
          {product.platform}
        </span>
        <span className={count ? "stock-positive" : "stock-empty"}>
          <span className="status-dot" />
          {t(count ? "available" : "outOfStock")}
        </span>
      </div>
      <Link className="product-name" href={href(`produits/${product.slug}`)}>
        <Heading>{product.name[locale]}</Heading>
        <ArrowUpRight size={17} />
      </Link>
      <p className="product-game">
        Call of Duty <span>· {t("demo")}</span>
      </p>
      <div className="product-price">
        <strong>{money(product.price)}</strong>
        <span>{t("fictionalPrice")}</span>
      </div>
    </article>
  );
}
