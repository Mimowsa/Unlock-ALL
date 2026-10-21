"use client";
import { useCopy } from "@/i18n/client";
import { Button } from "@/components/ui/button";
import type { CopyKey } from "@/i18n/messages";
export function AdminDataState({
  error,
  retry,
}: {
  error?: CopyKey | null;
  retry: () => void;
}) {
  const { t } = useCopy();
  return (
    <div className="panel" role={error ? "alert" : "status"} aria-busy={!error}>
      <p>{t(error ?? "loading")}</p>
      {error && (
        <Button variant="outline" onClick={retry}>
          {t("tryAgain")}
        </Button>
      )}
    </div>
  );
}
