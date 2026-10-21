"use client";
import { useState } from "react";
import { useCopy } from "@/i18n/client";
import { Button } from "@/components/ui/button";
export function TransferInstructions({
  recipient,
  reference,
  payUntil,
  allowPayment = true,
}: {
  recipient: string;
  reference: string;
  payUntil: string;
  allowPayment?: boolean;
}) {
  const { t, locale } = useCopy();
  const [copied, setCopied] = useState(""),
    [failed, setFailed] = useState(false);
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }
  const closed = new Date(payUntil) <= new Date();
  return (
    <section
      className="transfer-instructions"
      aria-label={t("transferInstructions")}
    >
      <h2>{t("transferInstructions")}</h2>
      <p>
        {t(
          closed
            ? "transferWindowClosed"
            : allowPayment
              ? "transferHowTo"
              : "paypalReviewText",
        )}
      </p>
      <dl className="transfer-facts">
        <div>
          <dt>{t("transferRecipient")}</dt>
          <dd>
            <span>{recipient}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void copy(recipient)}
            >
              {t(
                copied === recipient
                  ? "transferCopied"
                  : "transferCopyRecipient",
              )}
            </Button>
          </dd>
        </div>
        <div>
          <dt>{t("transferReference")}</dt>
          <dd>
            <code>{reference}</code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void copy(reference)}
            >
              {t(
                copied === reference
                  ? "transferCopied"
                  : "transferCopyReference",
              )}
            </Button>
          </dd>
        </div>
        <div>
          <dt>{t("transferPayBefore")}</dt>
          <dd>
            <time dateTime={payUntil}>
              {new Date(payUntil).toLocaleString(locale, {
                timeZone: "Europe/Paris",
              })}
            </time>
          </dd>
        </div>
      </dl>
      <p className="micro-copy">{t("transferDelay")}</p>
      {failed && (
        <p role="alert" className="form-error">
          {t("transferCopyFailed")}
        </p>
      )}
      {!closed && allowPayment && (
        <Button variant="outline" asChild>
          <a
            href="https://www.sandbox.paypal.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("transferOpenPaypal")}
          </a>
        </Button>
      )}
    </section>
  );
}
