"use client";
import { useCopy } from "@/i18n/client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useCopy();
  return (
    <div className="container page-space">
      <div className="empty-state" role="alert">
        <h1>{t("errorTitle")}</h1>
        <Button onClick={reset}>{t("tryAgain")}</Button>
      </div>
    </div>
  );
}
