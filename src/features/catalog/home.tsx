"use client";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  KeyRound,
  Monitor,
  ShieldCheck,
  MousePointer2,
  UserRound,
  PackageCheck,
} from "lucide-react";
import { useCopy } from "@/i18n/client";
import { useDemo } from "@/demo/provider";
import { Button } from "@/components/ui/button";
import { ProductCard } from "./product-card";
export function FAQ() {
  const { t } = useCopy();
  return (
    <section className="faq-section container">
      <div>
        <p className="eyebrow">
          <span className="tiny-square" />
          {t("faqTag")}
        </p>
        <h2>{t("faqTitle")}</h2>
      </div>
      <div className="faq-list">
        {(["1", "2", "3", "4"] as const).map((n) => (
          <details key={n}>
            <summary>
              {t(`faq${n}`)}
              <ChevronDown size={17} />
            </summary>
            <p>{t(`faq${n}a`)}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
export function Home() {
  const { t, href } = useCopy();
  const { state } = useDemo();
  const selected = state.products
    .filter((product) => product.published)
    .slice(0, 20);
  const steps = [MousePointer2, UserRound, ShieldCheck, KeyRound];
  return (
    <>
      <section className="hero">
        <Image
          src="/images/hero.svg"
          alt={t("heroVisual")}
          fill
          priority
          sizes="100vw"
          className="hero-image"
        />
        <div className="hero-shade" />
        <div className="container hero-content">
          <p className="eyebrow">
            <span className="tiny-square" />
            {t("heroTag")}
          </p>
          <h1>
            {t("heroTitle")
              .split("\n")
              .map((line, i) => (
                <span key={line} className={i === 1 ? "hero-accent" : ""}>
                  {line}
                </span>
              ))}
          </h1>
          <p className="hero-description">{t("heroDescription")}</p>
          <div className="hero-buttons">
            <Button asChild>
              <Link href={href("boutique")}>
                {t("browse")}
                <ArrowUpRight size={18} />
              </Link>
            </Button>
            <Button asChild variant="ghost">
              <a href="#fonctionnement">
                {t("how")}
                <ArrowRight size={16} />
              </a>
            </Button>
          </div>
          <div className="hero-note">
            <span className="status-dot" />
            {t("demoProduct")}
            <span className="note-separator" />
            {t("noPayment")}
          </div>
        </div>
        <div className="hero-caption">
          <span>01 / 04</span>
          <div>
            <p>{t("heroLabel")}</p>
            <strong>{t("heroCaption")}</strong>
          </div>
          <ArrowDownRightIcon />
        </div>
        <span className="hero-coordinate">UA — 48°51′ N / 02°21′ E</span>
      </section>
      <div className="trust-strip">
        <div className="container">
          {[
            [KeyRound, "instant"],
            [Monitor, "platforms"],
            [ShieldCheck, "noPayment"],
          ].map(([Icon, key]) => {
            const I = Icon as typeof KeyRound;
            return (
              <div key={String(key)}>
                <I size={18} />
                <span>{t(key as "instant" | "platforms" | "noPayment")}</span>
              </div>
            );
          })}
        </div>
      </div>
      <section className="container collection-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              <span className="tiny-square" />
              {t("collectionTag")}
            </p>
            <h2>{t("featured")}</h2>
            <p>{t("featuredDescription")}</p>
          </div>
        </div>
        <div className="product-grid home-product-grid">
          {selected.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
        <div className="collection-action">
          <Button asChild variant="outline">
            <Link href={href("boutique")}>
              {t("seeAll")}
              <ArrowUpRight size={18} />
            </Link>
          </Button>
        </div>
      </section>
      <section id="fonctionnement" className="how-section">
        <div className="container">
          <p className="eyebrow">
            <span className="tiny-square" />
            {t("howTag")}
          </p>
          <h2>{t("howTitle")}</h2>
          <div className="steps-grid">
            {steps.map((Icon, i) => (
              <article key={i}>
                <div className="step-top">
                  <Icon size={22} />
                  <span>0{i + 1}</span>
                </div>
                <h3>{t(`step${i + 1}` as "step1")}</h3>
                <p>{t(`step${i + 1}Text` as "step1Text")}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <FAQ />
      <section className="container">
        <div className="community-banner">
          <div className="community-icon">
            <PackageCheck size={38} />
          </div>
          <div>
            <p className="eyebrow">UNLOCK-ALL / SUPPORT</p>
            <h2>{t("community")}</h2>
            <p>{t("communityText")}</p>
          </div>
          <Button asChild variant="outline">
            <Link href={href("support")}>
              {t("getSupport")}
              <ArrowUpRight size={17} />
            </Link>
          </Button>
        </div>
      </section>
    </>
  );
}
function ArrowDownRightIcon() {
  return <ArrowUpRight className="caption-arrow" size={31} />;
}
