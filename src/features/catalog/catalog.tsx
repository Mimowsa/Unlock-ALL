"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { useCopy } from "@/i18n/client";
import { useDemo } from "@/demo/provider";
import { PageHeading } from "@/components/layout/site-shell";
import { ProductCard } from "./product-card";
import { Button } from "@/components/ui/button";
import type { Product } from "@/demo/types";
export function Catalog() {
  const { t, locale, href } = useCopy();
  const { state } = useDemo();
  const params = useSearchParams();
  const router = useRouter();
  const q = params.get("q") ?? "";
  const category = params.get("category") ?? "";
  const platform = params.get("platform") ?? "";
  const sort = params.get("sort") ?? "";
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${href("boutique")}?${next}`, { scroll: false });
  }
  const products = state.products
    .filter(
      (p) =>
        p.published &&
        (!category || p.category === category) &&
        (!platform || p.platform === platform) &&
        `${p.name[locale]} ${p.platform} Call of Duty`
          .toLowerCase()
          .includes(q.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "asc"
        ? a.price - b.price
        : sort === "desc"
          ? b.price - a.price
          : 0,
    );
  return (
    <div className="container page-space">
      <PageHeading
        eyebrow={t("collectionTag")}
        title={t("catalogTitle")}
        description={t("catalogDescription")}
      />
      <div className="catalog-layout">
        <aside className="catalog-sidebar">
          <div className="filter-heading">
            <SlidersHorizontal size={16} />
            {t("filter")}
          </div>
          <h2>{t("category")}</h2>
          <div className="filter-options">
            {["", "unlock", "camos", "weapons", "fullPack"].map((c) => (
              <button
                key={c}
                aria-pressed={category === c}
                className={category === c ? "selected" : ""}
                onClick={() => filter("category", c)}
              >
                <span className="filter-indicator" />
                {t(c ? (c as Product["category"]) : "allPacks")}
                <span>
                  {
                    state.products.filter(
                      (p) => p.published && (!c || p.category === c),
                    ).length
                  }
                </span>
              </button>
            ))}
          </div>
          <h2>{t("platform")}</h2>
          <div className="filter-options">
            {["", "PC", "PlayStation", "Xbox"].map((p) => (
              <button
                key={p}
                aria-pressed={platform === p}
                className={platform === p ? "selected" : ""}
                onClick={() => filter("platform", p)}
              >
                <span className="filter-indicator" />
                {p || t("all")}
              </button>
            ))}
          </div>
          <p className="sidebar-note">{t("productDisclaimer")}</p>
        </aside>
        <div>
          <div className="catalog-toolbar">
            <label className="search-field">
              <Search size={17} />
              <input
                aria-label={t("searchLabel")}
                placeholder={t("search")}
                value={q}
                onChange={(e) => filter("q", e.target.value)}
              />
              {q && (
                <button
                  aria-label={t("clearFilters")}
                  onClick={() => filter("q", "")}
                >
                  <X size={15} />
                </button>
              )}
            </label>
            <select
              aria-label={t("sort")}
              value={sort}
              onChange={(e) => filter("sort", e.target.value)}
            >
              <option value="">{t("featuredSort")}</option>
              <option value="asc">{t("priceAsc")}</option>
              <option value="desc">{t("priceDesc")}</option>
            </select>
          </div>
          <p className="result-count" aria-live="polite">
            {products.length} {t("products")}
          </p>
          {products.length ? (
            <div className="product-grid catalog-grid">
              {products.map((p, index) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  eager={index < 3}
                  headingLevel={2}
                />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <Search size={30} />
              <h2>{t("noResults")}</h2>
              <Button onClick={() => router.replace(href("boutique"))}>
                {t("clearFilters")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
