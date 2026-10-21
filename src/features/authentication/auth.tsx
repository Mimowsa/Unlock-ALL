"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { signIn, useSession } from "next-auth/react";
import { ArrowUpRight, LockKeyhole } from "lucide-react";
import { useCopy } from "@/i18n/client";
import type { CopyKey } from "@/i18n/messages";
import { Button } from "@/components/ui/button";
export { PasswordReset } from "./password-reset";
export function Auth({ register = false }: { register?: boolean }) {
  const { t, href, locale } = useCopy();
  const router = useRouter();
  const params = useSearchParams();
  const { update } = useSession();
  const [error, setError] = useState<CopyKey | null>(null);
  const [busy, setBusy] = useState(false);
  const submitted = useRef(false);
  const next = params.get("next");
  const destination =
    next === "commande" ? "commande" : next === "admin" ? "admin" : "compte";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitted.current) return;
    submitted.current = true;
    setBusy(true);
    setError(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email"));
    const password = String(data.get("password"));
    try {
      if (register) {
        const response = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            nickname: String(data.get("nickname")),
            locale: locale.toUpperCase(),
          }),
        });
        if (!response.ok) {
          const result = await response.json();
          setError(
            result.error === "rateLimited"
              ? "authRateLimited"
              : result.error === "accountUnavailable"
                ? "authAccountUnavailable"
                : result.error === "invalidInput"
                  ? "authInvalidInput"
                  : "authUnavailable",
          );
          return;
        }
      }
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
        callbackUrl: href(destination),
      });
      if (!result?.ok || result.error) {
        setError("authInvalidCredentials");
        return;
      }
      form.reset();
      await update();
      router.push(href(destination));
      router.refresh();
    } catch {
      setError("authUnavailable");
    } finally {
      submitted.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="container auth-layout page-space">
      <div className="auth-editorial">
        <p className="eyebrow">
          <span className="tiny-square" />
          UNLOCK-ALL / {t("account")}
        </p>
        <h1>{t(register ? "registerTitle" : "authTitle")}</h1>
        <p>{t("authText")}</p>
        <div className="auth-graphic">
          <LockKeyhole size={72} strokeWidth={0.8} />
          <span>
            {t("authChapter")
              .split("\n")
              .map((line) => (
                <span key={line}>
                  {line}
                  <br />
                </span>
              ))}
          </span>
        </div>
        <p className="micro-copy">{t("authScope")}</p>
      </div>
      <div className="panel auth-panel">
        <h2>{t(register ? "register" : "login")}</h2>
        <form onSubmit={submit} className="form-stack">
          {register && (
            <label>
              {t("nickname")}
              <input
                name="nickname"
                required
                minLength={2}
                maxLength={40}
                autoComplete="nickname"
                placeholder="Player One"
              />
            </label>
          )}
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
          <label>
            {t("password")}
            <input
              name="password"
              type="password"
              required
              minLength={register ? 15 : 1}
              maxLength={128}
              autoComplete={register ? "new-password" : "current-password"}
              aria-describedby={register ? "password-policy" : undefined}
            />
          </label>
          {register && (
            <p id="password-policy" className="field-hint">
              {t("authPasswordPolicy")}
            </p>
          )}
          <Link
            className="text-link forgot-link"
            href={href("mot-de-passe-oublie")}
          >
            {t("forgot")}
          </Link>
          {error && (
            <p role="alert" className="form-error">
              {t(error)}
            </p>
          )}
          <Button type="submit" disabled={busy}>
            {t(busy ? "authWorking" : register ? "register" : "login")}
            <ArrowUpRight size={17} />
          </Button>
        </form>
        <p className="auth-switch">
          {t(register ? "hasAccount" : "noAccount")}{" "}
          <Link
            href={`${href(register ? "connexion" : "inscription")}${destination !== "compte" ? `?next=${destination}` : ""}`}
          >
            {t(register ? "login" : "register")}
          </Link>
        </p>
        {register && <p className="micro-copy">{t("authNoWelcomeEmail")}</p>}
      </div>
    </div>
  );
}
