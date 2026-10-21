"use client";
import { useState } from "react";
import { Search } from "lucide-react";
import { useCopy } from "@/i18n/client";
import { useDemo } from "@/demo/provider";
import { useIdentity } from "@/features/authentication/session-provider";
import { Button } from "@/components/ui/button";
import type { DemoUser } from "@/demo/types";
import type { CopyKey } from "@/i18n/messages";
import { adminError, adminWrite, useAdminData } from "./use-admin-data";
import { AdminDataState } from "./data-state";
type ManagedUser = DemoUser & { isDemo: boolean; updatedAt: string };
export function UsersAdmin() {
  const { t } = useCopy();
  const { setNotice } = useDemo();
  const identity = useIdentity();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const resource = useAdminData<{
    users: ManagedUser[];
    total: number;
    page: number;
  }>(`/api/admin/users?q=${encodeURIComponent(query)}&page=${page}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CopyKey | null>(null);
  async function save(
    user: ManagedUser,
    patch: Partial<Pick<ManagedUser, "active" | "role">>,
  ) {
    if (!window.confirm(t("roleConfirm"))) return;
    setBusy(true);
    setError(null);
    try {
      await adminWrite(`/api/admin/users/${user.id}`, "PATCH", {
        role: user.role,
        active: user.active,
        updatedAt: user.updatedAt,
        ...patch,
      });
      setNotice("catalogSaved");
      resource.reload();
      await identity.refresh();
      if (user.id === identity.user?.id)
        window.location.assign(`/${document.documentElement.lang}/compte`);
    } catch (error) {
      setError(adminError(error instanceof Error ? error.message : undefined));
      resource.reload();
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <form
        className="admin-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQuery(search.trim());
        }}
      >
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label={t("searchUsers")}
            placeholder={t("searchUsers")}
            value={search}
            maxLength={254}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <Button type="submit" size="sm">
          {t("searchAction")}
        </Button>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {t(error)}
        </p>
      )}
      {resource.error || resource.loading ? (
        <AdminDataState error={resource.error} retry={resource.reload} />
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {(
                    ["nickname", "email", "discord", "role", "status"] as const
                  ).map((k) => (
                    <th key={k}>{t(k)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {resource.data?.users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.nickname}</strong>
                      {u.isDemo && <span className="badge">{t("demo")}</span>}
                    </td>
                    <td>{u.email}</td>
                    <td>{u.discord || "—"}</td>
                    <td>
                      <select
                        aria-label={`${t("role")} ${u.nickname}`}
                        value={u.role}
                        disabled={busy || u.isDemo}
                        onChange={(e) =>
                          void save(u, {
                            role: e.target.value as "USER" | "ADMIN",
                          })
                        }
                      >
                        <option value="USER">{t("user")}</option>
                        <option value="ADMIN">{t("administrator")}</option>
                      </select>
                    </td>
                    <td>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy || u.isDemo}
                        onClick={() => void save(u, { active: !u.active })}
                      >
                        {t(u.active ? "deactivate" : "activate")}
                      </Button>
                      <span className="badge">
                        {t(u.active ? "active" : "disabled")}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!resource.data?.users.length && (
              <p className="table-empty">{t("noUsers")}</p>
            )}
          </div>
          <div className="admin-toolbar">
            <Button
              variant="outline"
              disabled={page === 1}
              onClick={() => setPage((n) => n - 1)}
            >
              {t("previousPage")}
            </Button>
            <span>
              {page} /{" "}
              {Math.max(1, Math.ceil((resource.data?.total ?? 0) / 25))}
            </span>
            <Button
              variant="outline"
              disabled={page * 25 >= (resource.data?.total ?? 0)}
              onClick={() => setPage((n) => n + 1)}
            >
              {t("nextPage")}
            </Button>
          </div>
        </>
      )}
      <p className="micro-copy">{t("managedUsersNote")}</p>
    </>
  );
}
