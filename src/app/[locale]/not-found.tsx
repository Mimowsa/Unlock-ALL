"use client";
import Link from "next/link";
import { useCopy } from "@/i18n/client";
import { PageHeading } from "@/components/layout/site-shell";
import { Button } from "@/components/ui/button";
export default function NotFound() {
  const { t, href } = useCopy();
  return (
    <div className="container page-space">
      <PageHeading eyebrow="404" title={t("notFound")} />
      <Button asChild>
        <Link href={href("boutique")}>{t("backShop")}</Link>
      </Button>
    </div>
  );
}
