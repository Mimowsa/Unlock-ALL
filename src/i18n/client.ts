"use client";
import { useLocale, useTranslations } from "next-intl";
import type { CopyKey, Locale } from "./messages";
export function useCopy() {
  const translate = useTranslations();
  const locale = useLocale() as Locale;
  return {
    t: (key: CopyKey) => translate(key),
    locale,
    href: (path = "") => `/${locale}${path ? `/${path}` : ""}`,
    money: (cents: number) =>
      new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-GB", {
        style: "currency",
        currency: "EUR",
      }).format(cents / 100),
    date: (value: string) =>
      new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
        dateStyle: "medium",
      }).format(new Date(value)),
  };
}
