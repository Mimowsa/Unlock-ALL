"use client";
import Link from "next/link";
import { useEffect, useState, useRef, type FormEvent } from "react";
import { useCopy } from "@/i18n/client";
import type { CopyKey } from "@/i18n/messages";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
export function PasswordReset({ complete = false }: { complete?: boolean }) {
  const { update } = useSession();
  const { t, locale, href } = useCopy();
  const [token, setToken] = useState("");
  const [message, setMessage] = useState<CopyKey | null>(null);
  const [error, setError] = useState<CopyKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const submitted = useRef(false);
  const loaded = useRef(false);
  useEffect(() => {
    if (complete && !loaded.current) {
      loaded.current = true;
      setToken(window.location.hash.slice(1));
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [complete]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitted.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    if (complete && data.get("password") !== data.get("confirmation")) {
      setError("authPasswordMismatch");
      return;
    }
    submitted.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/auth/password/${complete ? "reset" : "forgot"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            complete
              ? { token, password: String(data.get("password")) }
              : {
                  email: String(data.get("email")),
                  locale: locale.toUpperCase(),
                },
          ),
        },
      );
      const result = await response.json();
      if (!response.ok) {
        setError(
          result.error === "rateLimited"
            ? "authRateLimited"
            : result.error === "invalidReset"
              ? "authInvalidReset"
              : result.error === "invalidInput"
                ? "authInvalidInput"
                : "authUnavailable",
        );
        return;
      }
      if (complete) {
        form.reset();
        setToken("");
        setDone(true);
        setMessage("authResetDone");
        await update().catch(() => undefined);
      } else
        setMessage(
          result.delivery === "email"
            ? "authResetEmailQueued"
            : result.delivery === "local"
              ? "authResetLocal"
              : "authResetUnavailable",
        );
    } catch {
      setError("authUnavailable");
    } finally {
      submitted.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="container narrow page-space">
      <div className="panel">
        <p className="eyebrow">{t("account")}</p>
        <h1>{t("resetTitle")}</h1>
        <p>{t(complete ? "authResetCompleteText" : "resetText")}</p>
        {!done && (
          <form className="form-stack" onSubmit={submit}>
            {complete ? (
              <>
                <label>
                  {t("password")}
                  <input
                    name="password"
                    type="password"
                    required
                    minLength={15}
                    maxLength={128}
                    autoComplete="new-password"
                  />
                </label>
                <p className="field-hint">{t("authPasswordPolicy")}</p>
                <label>
                  {t("authPasswordConfirm")}
                  <input
                    name="confirmation"
                    type="password"
                    required
                    minLength={15}
                    maxLength={128}
                    autoComplete="new-password"
                  />
                </label>
              </>
            ) : (
              <label>
                {t("email")}
                <input
                  name="email"
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="email"
                  placeholder="joueur@example.com"
                />
              </label>
            )}
            <Button type="submit" disabled={busy || (complete && !token)}>
              {t(
                busy
                  ? "authWorking"
                  : complete
                    ? "authResetSave"
                    : "resetAction",
              )}
            </Button>
            {complete && !token && (
              <p className="form-error">{t("authInvalidReset")}</p>
            )}
          </form>
        )}
        {error && (
          <p className="form-error" role="alert">
            {t(error)}
          </p>
        )}
        {message && (
          <p className="demo-callout" role="status">
            {t(message)}
          </p>
        )}
        <Link className="text-link" href={href("connexion")}>
          {t("login")}
        </Link>
      </div>
    </div>
  );
}
