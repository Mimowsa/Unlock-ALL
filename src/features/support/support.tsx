"use client";
import { MessageSquare, ArrowUpRight, ShieldCheck } from "lucide-react";
import { useCopy } from "@/i18n/client";
import { useDemo } from "@/demo/provider";
import { FAQ } from "@/features/catalog/home";
import { PageHeading } from "@/components/layout/site-shell";
import { Button } from "@/components/ui/button";
export function Support() {
  const { t } = useCopy();
  return (
    <>
      <div className="container page-space support-page">
        <PageHeading
          eyebrow="UNLOCK-ALL / SUPPORT"
          title={t("supportTitle")}
          description={t("supportDescription")}
        />
        <div className="support-cards">
          <div className="panel">
            <MessageSquare size={32} />
            <h2>{t("discordSupport")}</h2>
            <p>{t("discordPending")}</p>
            <Button disabled>
              {t("notConfigured")}
              <ArrowUpRight size={16} />
            </Button>
          </div>
          <div className="panel">
            <ShieldCheck size={32} />
            <h2>{t("demoProduct")}</h2>
            <p>{t("demoDetails")}</p>
            <p>{t("emailNotSent")}</p>
          </div>
        </div>
      </div>
      <FAQ />
    </>
  );
}
export function Legal({ page }: { page: string }) {
  const { t } = useCopy();
  const { reset } = useDemo();
  const title =
    page === "conditions"
      ? "terms"
      : page === "confidentialite"
        ? "privacy"
        : "legalTitle";
  return (
    <div className="container narrow page-space">
      <PageHeading eyebrow={t("demo")} title={t(title)} />
      <div className="panel legal-copy">
        <p>
          {t(
            page === "conditions"
              ? "termsText"
              : page === "confidentialite"
                ? "privacyText"
                : "legalText",
          )}
        </p>
        <p>{t("unaffiliated")}</p>
        {page === "confidentialite" && (
          <Button
            variant="outline"
            onClick={() => {
              if (window.confirm(t("resetConfirm"))) reset();
            }}
          >
            {t("resetDemo")}
          </Button>
        )}
      </div>
    </div>
  );
}
