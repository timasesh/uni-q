import {
  Routes,
  Route,
  Navigate,
  NavLink,
  useLocation,
  useNavigate,
  Outlet,
} from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import {
  LogOut,
  BarChart3,
  Users,
  Settings,
  HelpCircle,
  Download,
  Star,
  Activity,
  CalendarClock,
  LayoutGrid,
  LineChart,
  Trash2,
  X,
  Home,
} from "lucide-react";
import { fetchJSON, readJSON } from "../api";
import { useI18n, type Lang } from "../i18n";
import { useAdminContext, type AdminUser } from "../context/AdminContext";
import { useManagerContext } from "../context/ManagerContext";
import { cn } from "../lib/cn";
import { SCHEME_WINDOW_COUNT, parseDeskWindowNumber } from "../lib/deskWindow";
import SchemeImage from "../components/SchemeImage";
import { AppLogo } from "../lib/brand";
import { parseBackendDateTime } from "../lib/backendDateTime";
import { SCHOOL_NAMES } from "../schools";
import { formatStudyDuration, parseStudyDuration } from "../lib/studyDuration";

function formatHm(ms: number) {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function presetRangeBtnClass(active: boolean) {
  return cn(
    "rounded-xl border px-3 py-2 text-xs font-extrabold transition",
    active
      ? "border-violet-500 bg-violet-600 text-white shadow-md shadow-violet-600/25 dark:border-violet-400 dark:bg-violet-500 dark:text-white"
      : "border-violet-200 text-violet-800 hover:bg-violet-50 dark:border-white/15 dark:text-violet-200 dark:hover:bg-white/5"
  );
}

function formatLocalDateTime(raw: string | null | undefined, options?: Intl.DateTimeFormatOptions): string {
  const d = parseBackendDateTime(raw);
  if (!d) return "—";
  return d.toLocaleString([], options ?? { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatMinDisplay(value: number | null | undefined, minShort: string): string {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const n = Number(value);
  const shown = n > 0 && n < 1 ? 1 : n;
  return `${shown} ${minShort}`;
}

function ticketStatusLabel(status: string, t: (k: string) => string): string {
  const s = String(status || "").toUpperCase();
  if (s === "WAITING") return t("waiting");
  if (s === "CALLED") return t("called");
  if (s === "IN_SERVICE") return t("inService");
  if (s === "MISSED") return t("missed");
  if (s === "DONE") return t("done");
  if (s === "CANCELLED") return t("cancelled");
  return s || "—";
}

type AdvisorRow = {
  id: number;
  name: string;
  faculty: string | null;
  department: string | null;
  desk_number: string | null;
  login: string | null;
  assigned_schools_json: string | null;
  assigned_languages_json: string | null;
  assigned_courses_json: string | null;
  assigned_specialties_json: string | null;
  assigned_study_years_json?: string | null;
  work_ms_today: number;
};

function safeParseArray<T>(raw: string | null | undefined, fallback: T[]): T[] {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function formatReception(row: AdvisorRow): string {
  const schools = safeParseArray<string>(row.assigned_schools_json, []);
  const courses = safeParseArray<number>(row.assigned_courses_json, [1, 2, 3, 4])
    .map((x) => Number(x))
    .filter((n) => n >= 1 && n <= 4);
  let langs: string[] | null = null;
  if (row.assigned_languages_json) {
    try {
      const j = JSON.parse(row.assigned_languages_json) as unknown;
      if (Array.isArray(j) && j.length > 0) langs = j.map((x) => String(x));
    } catch {
      langs = null;
    }
  }
  const specs = safeParseArray<string>(row.assigned_specialties_json, []);
  const studyYears = safeParseArray<number>(row.assigned_study_years_json, [])
    .map((x) => parseStudyDuration(x))
    .filter((n): n is number => n != null);
  const parts: string[] = [];
  if (schools.length) parts.push(`Школы: ${schools.join(", ")}`);
  parts.push(langs?.length ? `Языки: ${langs.join(", ")}` : "Языки: любые");
  parts.push(`Курсы: ${(courses.length ? courses : [1, 2, 3, 4]).join(", ")}`);
  if (studyYears.length) parts.push(`ТиПО: ${studyYears.map((n) => formatStudyDuration(n)).join(", ")}`);
  if (specs.length) parts.push(`Спец.: ${specs.join(", ")}`);
  return parts.join(" · ");
}

function AdminLogin() {
  const { t } = useI18n();
  const { setAdminUser } = useAdminContext();
  const { setManagerId } = useManagerContext();
  const nav = useNavigate();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const res = await fetchJSON("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login, password }),
    });
    if (!res.ok) {
      const j = await readJSON<{ error?: string }>(res);
      setErr(j?.error || "Ошибка входа");
      setBusy(false);
      return;
    }
    const j = await readJSON<AdminUser>(res);
    setManagerId(null);
    setAdminUser({ id: j.id, login: j.login, name: j.name });
    nav("/admin/dashboard", { replace: true });
    setBusy(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-16 dark:bg-slate-900">
      <div className="w-full max-w-md rounded-2xl border border-violet-200/80 bg-white p-8 shadow-xl shadow-violet-900/10 dark:border-white/10 dark:bg-slate-950">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-12 shrink-0 items-center justify-center rounded-xl border border-violet-200/80 bg-violet-50/80 px-2 py-1 dark:border-white/10 dark:bg-white/5">
            <AppLogo className="h-10 w-auto max-h-10 max-w-[140px] object-contain" />
          </div>
          <div>
            <h1 className="text-lg font-black text-violet-950 dark:text-white">{t("adminLoginTitle")}</h1>
            <p className="text-xs font-semibold text-violet-700 dark:text-violet-200">{t("adminPanel")}</p>
          </div>
        </div>
        <form className="space-y-4" onSubmit={submit}>
          {err && (
            <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800 dark:bg-rose-950/50 dark:text-rose-200">
              {err}
            </div>
          )}
          <label className="block">
            <span className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-violet-800 dark:text-violet-200">
              {t("login")}
            </span>
            <input
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              autoComplete="username"
              className="w-full rounded-xl border border-violet-200 bg-white px-3 py-2.5 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-violet-800 dark:text-violet-200">
              {t("password")}
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full rounded-xl border border-violet-200 bg-white px-3 py-2.5 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 py-3 text-sm font-black text-white shadow-lg shadow-violet-600/25 transition hover:from-violet-500 hover:to-indigo-500 disabled:opacity-60"
          >
            {busy ? t("loading") : t("signIn")}
          </button>
        </form>
      </div>
    </div>
  );
}

function AdminTabNav() {
  const { t } = useI18n();
  const tabCls = ({ isActive }: { isActive: boolean }) =>
    cn(
      "flex items-center gap-2 rounded-t-xl px-4 py-3 text-sm font-extrabold transition-colors",
      isActive
        ? "border-b-2 border-sky-500 bg-sky-50 text-sky-800 dark:bg-sky-950/50 dark:text-sky-100"
        : "text-violet-800 hover:bg-violet-50 dark:text-violet-200 dark:hover:bg-white/5"
    );
  return (
    <nav className="flex flex-wrap gap-1 border-b border-violet-100 bg-white px-2 shadow-sm dark:border-white/10 dark:bg-slate-900/80">
      <NavLink to="/admin/dashboard" className={tabCls}>
        <Home className="h-4 w-4 opacity-80" aria-hidden />
        Главная
      </NavLink>
      <NavLink to="/admin/stats" className={tabCls}>
        <BarChart3 className="h-4 w-4 opacity-80" aria-hidden />
        {t("adminStats")}
      </NavLink>
      <NavLink to="/admin/load" className={tabCls}>
        <LineChart className="h-4 w-4 opacity-80" aria-hidden />
        {t("adminLoad")}
      </NavLink>
      <NavLink to="/admin/windows" className={tabCls}>
        <LayoutGrid className="h-4 w-4 opacity-80" aria-hidden />
        {t("adminWindows")}
      </NavLink>
      <NavLink to="/admin/settings" className={tabCls}>
        <Settings className="h-4 w-4 opacity-80" aria-hidden />
        {t("settings")}
      </NavLink>
    </nav>
  );
}

export function AdminEmployees() {
  const { t } = useI18n();
  const [rows, setRows] = useState<AdvisorRow[] | null>(null);
  const [err, setErr] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [newLogin, setNewLogin] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createErr, setCreateErr] = useState("");
  const [createOk, setCreateOk] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteBusyId, setDeleteBusyId] = useState<number | null>(null);

  const load = async () => {
    const res = await fetchJSON(`/api/admin/managers?day=${encodeURIComponent(localYmdToday())}`);
    if (!res.ok) {
      setErr("Нет доступа");
      return;
    }
    const js = await readJSON<{ rows: AdvisorRow[] }>(res);
    setRows(js.rows || []);
    setErr("");
  };

  useEffect(() => {
    let c = false;
    void (async () => {
      const res = await fetchJSON(`/api/admin/managers?day=${encodeURIComponent(localYmdToday())}`);
      if (!res.ok) {
        if (!c) setErr("Нет доступа");
        return;
      }
      const js = await readJSON<{ rows: AdvisorRow[] }>(res);
      if (!c) {
        setRows(js.rows || []);
        setErr("");
      }
    })();
    return () => {
      c = true;
    };
  }, []);

  const createEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateBusy(true);
    setCreateErr("");
    setCreateOk("");
    const res = await fetchJSON("/api/admin/managers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        login: newLogin.trim(),
        password: newPassword,
      }),
    });
    if (!res.ok) {
      const j = (await readJSON<{ error?: string }>(res).catch(() => ({}))) as { error?: string };
      setCreateErr(j.error || "Ошибка");
      setCreateBusy(false);
      return;
    }
    setFirstName("");
    setLastName("");
    setNewLogin("");
    setNewPassword("");
    setCreateOk(t("adminEmployeeCreated"));
    setCreateBusy(false);
    setCreateOpen(false);
    await load();
  };

  const removeEmployee = async (id: number) => {
    if (!window.confirm(t("adminDeleteEmployeeConfirm"))) return;
    setDeleteBusyId(id);
    setErr("");
    const res = await fetchJSON(`/api/admin/managers/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = (await readJSON<{ error?: string }>(res).catch(() => ({}))) as { error?: string };
      setErr(j.error || t("adminDeleteEmployeeError"));
      setDeleteBusyId(null);
      return;
    }
    await load();
    setDeleteBusyId(null);
  };

  return (
    <div className="rounded-2xl border border-violet-100 bg-white p-4 shadow-md shadow-violet-900/5 dark:border-white/10 dark:bg-slate-950 md:p-6">
      <h2 className="mb-4 text-base font-black text-violet-950 dark:text-white">{t("adminStaffList")}</h2>

      <div className="mb-8 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="rounded-xl bg-violet-50 px-4 py-2.5 text-sm font-extrabold text-violet-950 shadow-sm transition hover:bg-violet-100 dark:bg-violet-950/40 dark:text-violet-100"
        >
          {t("adminAddEmployee")}
        </button>
        {createOpen && createErr ? <span className="text-sm font-semibold text-rose-600">{createErr}</span> : null}
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-2xl rounded-2xl border border-violet-100 bg-white p-4 shadow-xl shadow-violet-900/20 dark:border-white/10 dark:bg-slate-950 md:p-6"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="text-sm font-black text-violet-950 dark:text-white">{t("adminAddEmployee")}</h3>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-violet-200 bg-white/70 text-violet-900 transition hover:bg-white dark:border-white/10 dark:bg-white/5 dark:text-violet-100"
                aria-label="Close"
                title="Close"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <form
              onSubmit={(e) => void createEmployee(e)}
              className="grid gap-4 md:grid-cols-2"
            >
              <label className="block">
                <span className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">
                  {t("adminColFirstName")}
                </span>
                <input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  autoComplete="given-name"
                  className="w-full rounded-xl border border-violet-200 bg-white px-3 py-2.5 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-white"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">
                  {t("adminColLastName")}
                </span>
                <input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  autoComplete="family-name"
                  className="w-full rounded-xl border border-violet-200 bg-white px-3 py-2.5 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-white"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">
                  {t("adminColLogin")}
                </span>
                <input
                  value={newLogin}
                  onChange={(e) => setNewLogin(e.target.value)}
                  autoComplete="username"
                  className="w-full rounded-xl border border-violet-200 bg-white px-3 py-2.5 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-white"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">
                  {t("adminColPassword")}
                </span>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  className="w-full rounded-xl border border-violet-200 bg-white px-3 py-2.5 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-white"
                />
              </label>

              <div className="flex flex-wrap items-center gap-3 md:col-span-2">
                <button
                  type="submit"
                  disabled={createBusy}
                  className="rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-2.5 text-sm font-black text-white shadow-md shadow-violet-600/25 transition hover:from-violet-500 hover:to-indigo-500 disabled:opacity-60"
                >
                  {createBusy ? t("loading") : t("adminEmployeeCreate")}
                </button>
                {createErr ? <span className="text-sm font-semibold text-rose-600">{createErr}</span> : null}
                {createOk ? <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">{createOk}</span> : null}
              </div>
            </form>
          </div>
        </div>
      )}

      {err && <div className="mb-3 text-sm font-semibold text-rose-600">{err}</div>}
      {!rows ? (
        <div className="py-12 text-center text-sm font-semibold text-violet-600 dark:text-violet-300">{t("loading")}</div>
      ) : rows.length === 0 ? (
        <div className="py-12 text-center text-sm text-violet-600 dark:text-violet-300">—</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-violet-100 text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:border-white/10 dark:text-violet-300">
                <th className="py-3 pr-3">ID</th>
                <th className="py-3 pr-3">{t("adminColName")}</th>
                <th className="py-3 pr-3">{t("adminColLogin")}</th>
                <th className="py-3 pr-3">{t("adminColFaculty")}</th>
                <th className="py-3 pr-3">{t("adminColDesk")}</th>
                <th className="py-3 pr-3">{t("adminColReception")}</th>
                <th className="py-3">{t("adminColWorkedToday")}</th>
                <th className="py-3 text-right">{t("adminColActions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-violet-50 align-top font-medium text-slate-800 last:border-0 dark:border-white/5 dark:text-slate-200"
                >
                  <td className="py-3 pr-3 font-mono tabular-nums text-violet-600 dark:text-violet-300">{r.id}</td>
                  <td className="py-3 pr-3 font-semibold">{r.name}</td>
                  <td className="py-3 pr-3 text-violet-800 dark:text-violet-200">{r.login || "—"}</td>
                  <td className="py-3 pr-3 text-xs leading-snug">
                    {[r.faculty, r.department].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="py-3 pr-3">{r.desk_number || "—"}</td>
                  <td className="max-w-md py-3 pr-3 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                    {formatReception(r)}
                  </td>
                  <td className="py-3 font-mono tabular-nums font-bold text-emerald-700 dark:text-emerald-400">
                    {formatHm(Number(r.work_ms_today) || 0)}
                  </td>
                  <td className="py-3 text-right">
                    <button
                      type="button"
                      onClick={() => void removeEmployee(r.id)}
                      disabled={deleteBusyId === r.id}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-extrabold text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      {deleteBusyId === r.id ? t("loading") : t("adminDeleteEmployee")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AdminWindows() {
  const { t } = useI18n();
  const [rows, setRows] = useState<AdvisorRow[] | null>(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const res = await fetchJSON(`/api/admin/managers?day=${encodeURIComponent(localYmdToday())}`);
    if (!res.ok) {
      setErr("Нет доступа");
      return;
    }
    const js = await readJSON<{ rows: AdvisorRow[] }>(res);
    setRows(js.rows || []);
    setErr("");
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetchJSON(`/api/admin/managers?day=${encodeURIComponent(localYmdToday())}`);
      if (cancelled) return;
      if (!res.ok) {
        setErr("Нет доступа");
        return;
      }
      const js = await readJSON<{ rows: AdvisorRow[] }>(res);
      if (!cancelled) {
        setRows(js.rows || []);
        setErr("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const advisorAtWindow = (w: number) =>
    rows?.find((r) => parseDeskWindowNumber(r.desk_number) === w) ?? null;

  const onSelectWindow = async (windowNum: number, nextAdvisorId: string) => {
    if (!rows) return;
    const prev = advisorAtWindow(windowNum);
    const prevId = prev?.id;
    const nextId = nextAdvisorId === "" ? null : Number(nextAdvisorId);

    setSaving(true);
    setErr("");
    try {
      if (nextId === null) {
        if (prevId != null) {
          const res = await fetchJSON(`/api/admin/managers/${prevId}/desk`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ window: null }),
          });
          if (!res.ok) {
            const j = await readJSON<{ error?: string }>(res);
            setErr(j?.error || "Ошибка сохранения");
            return;
          }
        }
      } else {
        const res = await fetchJSON(`/api/admin/managers/${nextId}/desk`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ window: windowNum }),
        });
        if (!res.ok) {
          const j = await readJSON<{ error?: string }>(res);
          setErr(j?.error || "Ошибка сохранения");
          return;
        }
      }
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-violet-100 bg-white p-4 shadow-md shadow-violet-900/5 dark:border-white/10 dark:bg-slate-950 md:p-6">
      <h2 className="mb-2 text-base font-black text-violet-950 dark:text-white">{t("adminWindowsTitle")}</h2>
      <p className="mb-6 text-sm font-medium leading-relaxed text-violet-700 dark:text-violet-300">{t("adminWindowsHint")}</p>
      {err && <div className="mb-3 text-sm font-semibold text-rose-600">{err}</div>}
      {!rows ? (
        <div className="py-12 text-center text-sm font-semibold text-violet-600 dark:text-violet-300">{t("loading")}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-violet-100 text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:border-white/10 dark:text-violet-300">
                <th className="py-3 pr-3">{t("adminWindowsColWindow")}</th>
                <th className="py-3 pr-3">{t("adminWindowsColEmployee")}</th>
                <th className="py-3">{t("adminWindowsColPreview")}</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: SCHEME_WINDOW_COUNT }, (_, i) => i + 1).map((w) => {
                const assigned = advisorAtWindow(w);
                return (
                  <tr
                    key={w}
                    className="border-b border-violet-50 align-middle last:border-0 dark:border-white/5"
                  >
                    <td className="py-3 pr-3 font-black text-violet-900 dark:text-violet-100">
                      {t("officeSchemeWindow").replace("{n}", String(w))}
                    </td>
                    <td className="py-3 pr-3">
                      <select
                        value={assigned?.id ?? ""}
                        disabled={saving}
                        onChange={(e) => void onSelectWindow(w, e.target.value)}
                        className="w-full max-w-md rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-white"
                      >
                        <option value="">{t("adminWindowsEmpty")}</option>
                        {rows.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                            {r.login ? ` (${r.login})` : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-3">
                      <SchemeImage
                        windowNumber={w}
                        alt=""
                        className="h-[72px] w-auto max-w-[min(100%,200px)] rounded-lg border border-violet-100 bg-slate-50 object-contain dark:border-white/10 dark:bg-slate-900"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {saving && (
            <p className="mt-3 text-xs font-bold text-violet-600 dark:text-violet-400">{t("adminWindowsSaving")}</p>
          )}
        </div>
      )}
    </div>
  );
}

type AdminLoadResponse = {
  year: number;
  month: number;
  daily: { day: number; registrations: number; calls: number }[];
  monthly: { month: number; registrations: number; calls: number }[];
};

function localYmdDaysAgo(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function localYmdToday(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function firstDayOfMonthYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function AdminLoad() {
  const { t } = useI18n();
  const [date, setDate] = useState(() => localYmdToday());
  const [status, setStatus] = useState("");
  const [managerId, setManagerId] = useState("");
  const [managers, setManagers] = useState<{ id: number; name: string; login?: string | null }[]>([]);
  const [data, setData] = useState<AdminLoadResponse | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const modeOptions = [
    { id: "daily", label: "По дням (1-31)" },
    { id: "monthly", label: "По месяцам (1-12)" },
  ] as const;
  const [mode, setMode] = useState<(typeof modeOptions)[number]["id"]>("daily");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const qs = new URLSearchParams({ date });
      if (status.trim()) qs.set("status", status.trim().toUpperCase());
      if (managerId.trim()) qs.set("managerId", managerId.trim());
      const res = await fetchJSON(`/api/admin/stats/load?${qs}`);
      if (cancelled) return;
      if (!res.ok) {
        const j = (await readJSON<{ error?: string }>(res).catch(() => ({}))) as { error?: string };
        setErr(j.error || "Ошибка загрузки");
        setData(null);
        setLoading(false);
        return;
      }
      const js = await readJSON<AdminLoadResponse>(res);
      if (!cancelled) {
        setData(js);
        setErr("");
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date, status, managerId]);

  useEffect(() => {
    void (async () => {
      const res = await fetchJSON(`/api/admin/managers?day=${encodeURIComponent(localYmdToday())}`);
      if (!res.ok) return;
      const js = await readJSON<{ rows: { id: number; name: string; login?: string | null }[] }>(res);
      setManagers(js.rows || []);
    })();
  }, []);

  const points = useMemo(() => {
    if (!data) return [];
    return mode === "daily"
      ? data.daily.map((p) => ({ key: p.day, label: String(p.day), registrations: p.registrations, calls: p.calls }))
      : data.monthly.map((p) => ({ key: p.month, label: String(p.month), registrations: p.registrations, calls: p.calls }));
  }, [data, mode]);

  const maxCount = useMemo(() => {
    if (!data) return 1;
    let m = 1;
    for (const p of points) m = Math.max(m, p.registrations, p.calls);
    return m;
  }, [data, points]);

  return (
    <div className="rounded-2xl border border-violet-100 bg-white p-4 shadow-md shadow-violet-900/5 dark:border-white/10 dark:bg-slate-950 md:p-6">
      <h2 className="mb-2 text-base font-black text-violet-950 dark:text-white">{t("adminLoadTitle")}</h2>
      <p className="mb-5 text-sm font-medium leading-relaxed text-violet-700 dark:text-violet-300">{t("adminLoadHint")}</p>

      <div className="mb-6 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">
            {t("adminLoadPickDate")}
          </span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-white"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">Режим</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as (typeof modeOptions)[number]["id"])}
            className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-white"
          >
            {modeOptions.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">
            {t("adminWaitFilterStatus")}
          </span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-white"
          >
            <option value="">{t("adminFilterAny")}</option>
            {TICKET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ticketStatusLabel(s, t)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[240px] flex-col gap-1">
          <span className="text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">
            {t("adminVisitsColManager")}
          </span>
          <select
            value={managerId}
            onChange={(e) => setManagerId(e.target.value)}
            className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-white"
          >
            <option value="">{t("adminFilterAny")}</option>
            {managers.map((m) => (
              <option key={m.id} value={String(m.id)}>
                {m.name}
                {m.login ? ` (${m.login})` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      {err && <div className="mb-4 text-sm font-semibold text-rose-600">{err}</div>}

      {loading ? (
        <div className="py-16 text-center text-sm font-semibold text-violet-600 dark:text-violet-300">{t("loading")}</div>
      ) : data ? (
        <>
          <div className="mb-4 flex flex-wrap gap-6 text-xs font-bold">
            <span className="flex items-center gap-2 text-violet-800 dark:text-violet-200">
              <span className="h-3 w-4 rounded-sm bg-violet-500 shadow-sm" aria-hidden />
              {t("adminLoadRegistrations")}
            </span>
            <span className="flex items-center gap-2 text-emerald-800 dark:text-emerald-200">
              <span className="h-3 w-4 rounded-sm bg-emerald-500 shadow-sm" aria-hidden />
              {t("adminLoadCalls")}
            </span>
            <span className="text-violet-500 dark:text-violet-400">
              max: <span className="tabular-nums text-violet-800 dark:text-violet-200">{maxCount}</span>
            </span>
          </div>

          <div
            className="overflow-x-auto pb-2"
            role="img"
            aria-label={t("adminLoadChartAria")}
          >
            <div className="flex min-w-[700px] gap-1 border-b border-violet-200 pb-1 pl-9 dark:border-white/15">
              {points.map((p) => {
                const pctReg = maxCount > 0 ? (p.registrations / maxCount) * 100 : 0;
                const pctCall = maxCount > 0 ? (p.calls / maxCount) * 100 : 0;
                return (
                  <div key={p.key} className="flex min-w-0 flex-1 flex-col">
                    <div className="flex h-48 justify-center gap-0.5 px-0.5">
                      <div
                        className="flex h-full w-1/2 min-w-[10px] flex-col justify-end"
                        title={`${t("adminLoadRegistrations")}: ${p.registrations}`}
                      >
                        <div
                          className="w-full rounded-t-md bg-gradient-to-t from-violet-600 to-violet-400 shadow-sm dark:from-violet-700 dark:to-violet-500"
                          style={{ height: `${p.registrations > 0 ? Math.max(pctReg, 5) : 0}%` }}
                        />
                      </div>
                      <div
                        className="flex h-full w-1/2 min-w-[10px] flex-col justify-end"
                        title={`${t("adminLoadCalls")}: ${p.calls}`}
                      >
                        <div
                          className="w-full rounded-t-md bg-gradient-to-t from-emerald-600 to-emerald-400 shadow-sm dark:from-emerald-700 dark:to-emerald-500"
                          style={{ height: `${p.calls > 0 ? Math.max(pctCall, 5) : 0}%` }}
                        />
                      </div>
                    </div>
                    <div className="mt-1.5 text-center text-[10px] font-black tabular-nums text-violet-600 dark:text-violet-400">
                      {p.label}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        <div className="py-12 text-center text-sm text-violet-600 dark:text-violet-400">—</div>
      )}
    </div>
  );
}

type AdminSummary = {
  events: { event_type: string; count: number }[];
  reviewsTotal: number;
  ticketsToday: number;
  bookedSlotsLive: number;
};

type AdminVisitExportRow = {
  log_id: number;
  ticket_id: number;
  formatted_number: string;
  status: string;
  student_first_name: string | null;
  student_last_name: string | null;
  school: string | null;
  specialty: string | null;
  language_section: string | null;
  course: string | null;
  study_duration_years?: number | null;
  advisor_name: string | null;
  advisor_desk: string | null;
  case_type: string | null;
  comment: string | null;
  student_comment: string | null;
  started_at: string | null;
  finished_at: string | null;
  queue_wait_minutes: number | null;
  desk_service_minutes: number | null;
  total_minutes: number | null;
  is_repeat: number;
};

type AdminReviewExportRow = {
  ticket_id: number;
  formatted_number: string;
  stars: number;
  review_comment: string | null;
  review_at: string | null;
  student_first_name: string | null;
  student_last_name: string | null;
  advisor_name: string | null;
  advisor_desk: string | null;
  school: string | null;
  specialty: string | null;
  visit_finished_at: string | null;
};

type FaqDailyPoint = { day: string; count: number };

function AdminFaqNoQueueStats() {
  const { t } = useI18n();
  const [from, setFrom] = useState(() => firstDayOfMonthYmd());
  const [to, setTo] = useState(() => localYmdToday());
  const [allTime, setAllTime] = useState(false);
  const [rows, setRows] = useState<FaqDailyPoint[] | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const todayRange = localYmdToday();
  const weekFrom = localYmdDaysAgo(6);
  const monthFrom = firstDayOfMonthYmd();
  const isTodayPreset = !allTime && from === todayRange && to === todayRange;
  const isWeekPreset = !allTime && from === weekFrom && to === todayRange;
  const isMonthPreset = !allTime && from === monthFrom && to === todayRange;

  const load = async (override?: Partial<{ from: string; to: string; allTime: boolean }>) => {
    const f = override?.from ?? from;
    const t = override?.to ?? to;
    const a = override?.allTime ?? allTime;
    setLoading(true);
    setErr("");
    const qs = a ? "" : `?from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`;
    const res = await fetchJSON(`/api/admin/stats/faq-no-queue${qs}`);
    if (!res.ok) {
      const j = (await readJSON<{ error?: string }>(res).catch(() => ({}))) as { error?: string };
      setErr(j.error || "Нет доступа");
      setRows(null);
      setLoading(false);
      return;
    }
    const js = await readJSON<{ series: FaqDailyPoint[] }>(res);
    setRows(js.series || []);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const maxCount = useMemo(() => {
    if (!rows || rows.length === 0) return 1;
    let m = 1;
    for (const r of rows) m = Math.max(m, r.count);
    return m;
  }, [rows]);

  const totalHits = useMemo(() => (rows ? rows.reduce((a, r) => a + r.count, 0) : 0), [rows]);

  const downloadCsv = async () => {
    const qs = new URLSearchParams({ format: "csv" });
    if (!allTime) {
      qs.set("from", from);
      qs.set("to", to);
    }
    const res = await fetchJSON(`/api/admin/stats/faq-no-queue?${qs}`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "faq-no-queue.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <NavLink
        to="/admin/stats"
        className="inline-flex items-center gap-2 text-sm font-extrabold text-violet-700 hover:text-violet-900 dark:text-violet-300 dark:hover:text-white"
      >
        ← {t("back")}
      </NavLink>
      <div className="rounded-2xl border border-violet-100 bg-white p-4 shadow-md shadow-violet-900/5 dark:border-white/10 dark:bg-slate-950 md:p-6">
        <h2 className="mb-2 text-base font-black text-violet-950 dark:text-white">{t("adminFaqStatsTitle")}</h2>
        <p className="mb-4 text-sm font-medium text-violet-700 dark:text-violet-300">{t("adminFaqStatsHint")}</p>
        <div className="mb-5 flex flex-wrap items-end gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-bold text-violet-800 dark:text-violet-200">
            <input
              type="checkbox"
              checked={allTime}
              onChange={(e) => {
                const v = e.target.checked;
                setAllTime(v);
                void load({ allTime: v });
              }}
              className="rounded border-violet-300"
            />
            {t("adminFaqAllTime")}
          </label>
          {!allTime ? (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">
                  {t("adminVisitsFrom")}
                </span>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  disabled={allTime}
                  className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-white"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">
                  {t("adminVisitsTo")}
                </span>
                <input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  disabled={allTime}
                  className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-white"
                />
              </label>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-black text-white shadow-md shadow-violet-600/25 transition hover:bg-violet-500 disabled:opacity-60 dark:bg-violet-500 dark:hover:bg-violet-400"
          >
            {t("adminVisitsShow")}
          </button>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                const d0 = localYmdToday();
                setAllTime(false);
                setFrom(d0);
                setTo(d0);
                void load({ from: d0, to: d0, allTime: false });
              }}
              className={presetRangeBtnClass(isTodayPreset)}
            >
              {t("adminPresetToday")}
            </button>
            <button
              type="button"
              onClick={() => {
                const f0 = localYmdDaysAgo(6);
                const t0 = localYmdToday();
                setAllTime(false);
                setFrom(f0);
                setTo(t0);
                void load({ from: f0, to: t0, allTime: false });
              }}
              className={presetRangeBtnClass(isWeekPreset)}
            >
              {t("adminPresetWeek")}
            </button>
            <button
              type="button"
              onClick={() => {
                const f0 = firstDayOfMonthYmd();
                const t0 = localYmdToday();
                setAllTime(false);
                setFrom(f0);
                setTo(t0);
                void load({ from: f0, to: t0, allTime: false });
              }}
              className={presetRangeBtnClass(isMonthPreset)}
            >
              {t("adminPresetMonth")}
            </button>
          </div>
          <button
            type="button"
            onClick={() => void downloadCsv()}
            className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-extrabold text-violet-950 shadow-sm transition hover:bg-violet-100 dark:border-white/10 dark:bg-violet-950/40 dark:text-violet-100"
          >
            <Download className="h-4 w-4" aria-hidden />
            {t("adminFaqStatsDownload")}
          </button>
        </div>
        {err && <div className="mb-3 text-sm font-semibold text-rose-600">{err}</div>}
        {rows && rows.length > 0 ? (
          <p className="mb-3 text-sm font-bold text-violet-800 dark:text-violet-200">
            {t("adminFaqTotal")}: <span className="tabular-nums">{totalHits}</span>
          </p>
        ) : null}
        {loading ? (
          <div className="py-12 text-center text-sm font-semibold text-violet-600 dark:text-violet-300">{t("loading")}</div>
        ) : !rows || rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-violet-600 dark:text-violet-400">{t("adminFaqStatsEmpty")}</div>
        ) : (
          <>
            <div className="mb-6 overflow-x-auto rounded-xl border border-violet-100 dark:border-white/10">
              <table className="min-w-[320px] w-full text-left text-sm">
                <thead className="bg-violet-50 text-violet-900 dark:bg-slate-900 dark:text-violet-200">
                  <tr>
                    <th className="px-3 py-2.5 font-black uppercase tracking-wider text-[10px]">{t("adminFaqColDate")}</th>
                    <th className="px-3 py-2.5 font-black uppercase tracking-wider text-[10px]">{t("adminFaqColCount")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-violet-100 dark:divide-white/10">
                  {rows.map((r) => (
                    <tr key={r.day} className="bg-white dark:bg-slate-950/50">
                      <td className="px-3 py-2 font-mono tabular-nums text-violet-800 dark:text-violet-200">{r.day}</td>
                      <td className="px-3 py-2 font-bold tabular-nums text-violet-950 dark:text-white">{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="overflow-x-auto pb-2" role="img" aria-label={t("adminFaqStatsChartAria")}>
              <div className="flex gap-1 border-b border-violet-200 pb-1 dark:border-white/15">
                {rows.map((r) => {
                  const pct = maxCount > 0 ? (r.count / maxCount) * 100 : 0;
                  return (
                    <div key={r.day} className="flex w-8 shrink-0 flex-col">
                      <div className="flex h-48 flex-col justify-end">
                        <div
                          className="w-full rounded-t-md bg-gradient-to-t from-sky-600 to-sky-400 shadow-sm dark:from-sky-700 dark:to-sky-500"
                          style={{ height: `${r.count > 0 ? Math.max(pct, 5) : 0}%` }}
                          title={`${r.day}: ${r.count}`}
                        />
                      </div>
                      <div className="mt-1 text-center text-[9px] font-bold tabular-nums leading-tight text-violet-600 dark:text-violet-400">
                        {r.day.slice(5)}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-[10px] font-semibold text-violet-500 dark:text-violet-400">{t("adminFaqStatsAxisHint")}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AdminVisitsExport() {
  const { t } = useI18n();
  const [from, setFrom] = useState(() => firstDayOfMonthYmd());
  const [to, setTo] = useState(() => localYmdToday());
  const [visitStatus, setVisitStatus] = useState("");
  const [visitSchool, setVisitSchool] = useState("");
  const [rows, setRows] = useState<AdminVisitExportRow[] | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const todayRange = localYmdToday();
  const weekFrom = localYmdDaysAgo(6);
  const monthFrom = firstDayOfMonthYmd();
  const isTodayPreset = from === todayRange && to === todayRange;
  const isWeekPreset = from === weekFrom && to === todayRange;
  const isMonthPreset = from === monthFrom && to === todayRange;

  const visitQuery = () => {
    const qs = new URLSearchParams({ from, to });
    if (visitStatus.trim()) qs.set("status", visitStatus.trim().toUpperCase());
    if (visitSchool.trim()) qs.set("school", visitSchool.trim());
    return qs;
  };

  const load = async () => {
    setLoading(true);
    setErr("");
    const qs = visitQuery();
    const res = await fetchJSON(`/api/admin/visits/history?${qs}`);
    if (!res.ok) {
      const j = (await readJSON<{ error?: string }>(res).catch(() => ({}))) as { error?: string };
      setErr(j.error || "Ошибка");
      setRows(null);
      setLoading(false);
      return;
    }
    const js = await readJSON<{ rows: AdminVisitExportRow[] }>(res);
    setRows(js.rows || []);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const downloadCsv = async () => {
    const qs = visitQuery();
    qs.set("format", "csv");
    const res = await fetchJSON(`/api/admin/visits/history?${qs}`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "visits-history.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <NavLink
        to="/admin/stats"
        className="inline-flex items-center gap-2 text-sm font-extrabold text-violet-700 hover:text-violet-900 dark:text-violet-300 dark:hover:text-white"
      >
        ← {t("back")}
      </NavLink>
      <div className="rounded-2xl border border-violet-100 bg-white p-4 shadow-md shadow-violet-900/5 dark:border-white/10 dark:bg-slate-950 md:p-6">
        <h2 className="mb-2 text-base font-black text-violet-950 dark:text-white">{t("adminVisitsTitle")}</h2>
        <p className="mb-5 text-sm font-medium text-violet-700 dark:text-violet-300">{t("adminVisitsHint")}</p>

        <div className="mb-5 flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">
              {t("adminVisitsFrom")}
            </span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">
              {t("adminVisitsTo")}
            </span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
          </label>
          <label className="flex min-w-[140px] flex-col gap-1.5">
            <span className="text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">
              {t("adminFilterVisitStatus")}
            </span>
            <select
              value={visitStatus}
              onChange={(e) => setVisitStatus(e.target.value)}
              className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-white"
            >
              <option value="">{t("adminFilterAny")}</option>
              <option value="DONE">{ticketStatusLabel("DONE", t)}</option>
              <option value="MISSED">{ticketStatusLabel("MISSED", t)}</option>
              <option value="CANCELLED">{ticketStatusLabel("CANCELLED", t)}</option>
            </select>
          </label>
          <label className="flex min-w-[240px] flex-col gap-1.5">
            <span className="text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">
              {t("adminFilterSchool")}
            </span>
            <select
              value={visitSchool}
              onChange={(e) => setVisitSchool(e.target.value)}
              className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-white"
            >
              <option value="">{t("adminFilterAny")}</option>
              {SCHOOL_NAMES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-black text-white shadow-md shadow-violet-600/25 transition hover:bg-violet-500 disabled:opacity-60 dark:bg-violet-500 dark:hover:bg-violet-400"
          >
            {t("adminVisitsShow")}
          </button>
          <button
            type="button"
            onClick={() => void downloadCsv()}
            className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-extrabold text-violet-950 shadow-sm transition hover:bg-violet-100 dark:border-white/10 dark:bg-violet-950/40 dark:text-violet-100"
          >
            <Download className="h-4 w-4" aria-hidden />
            {t("adminVisitsDownloadCsv")}
          </button>
        </div>
        <div className="mb-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              const d0 = localYmdToday();
              setFrom(d0);
              setTo(d0);
            }}
            className={presetRangeBtnClass(isTodayPreset)}
          >
            {t("adminPresetToday")}
          </button>
          <button
            type="button"
            onClick={() => {
              setFrom(localYmdDaysAgo(6));
              setTo(localYmdToday());
            }}
            className={presetRangeBtnClass(isWeekPreset)}
          >
            {t("adminPresetWeek")}
          </button>
          <button
            type="button"
            onClick={() => {
              setFrom(firstDayOfMonthYmd());
              setTo(localYmdToday());
            }}
            className={presetRangeBtnClass(isMonthPreset)}
          >
            {t("adminPresetMonth")}
          </button>
        </div>

        {err && <div className="mb-4 text-sm font-semibold text-rose-600">{err}</div>}

        {loading ? (
          <div className="py-12 text-center text-sm font-semibold text-violet-600 dark:text-violet-300">{t("loading")}</div>
        ) : !rows || rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-violet-600 dark:text-violet-400">{t("adminVisitsEmpty")}</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-violet-100 dark:border-white/10">
            <table className="min-w-[1100px] w-full text-left text-xs">
              <thead className="bg-violet-50 text-violet-900 dark:bg-slate-900 dark:text-violet-200">
                <tr>
                  {[
                    t("adminVisitsColTicket"),
                    t("adminVisitsColQueue"),
                    "Начало консультации",
                    "Окончание консультации",
                    t("historyQueueWait"),
                    t("historyServiceTime"),
                    t("historyTotalTime"),
                    t("adminVisitsColStudent"),
                    t("adminVisitsColSchool"),
                    "ТиПО (годы)",
                    t("adminVisitsColManager"),
                    t("adminVisitsColDesk"),
                    t("adminVisitsColStatus"),
                    t("adminVisitsColRepeat"),
                    t("adminVisitsColCategory"),
                    t("adminVisitsColComment"),
                    t("historyStudentComment"),
                  ].map((h) => (
                    <th key={h} className="px-3 py-3 font-black uppercase tracking-widest text-[10px]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-violet-100 dark:divide-white/10">
                {rows.map((r) => (
                  <tr key={r.log_id} className="bg-white dark:bg-slate-950/50">
                    <td className="px-3 py-2.5 font-mono text-[11px] text-violet-800 dark:text-violet-200">{r.ticket_id}</td>
                    <td className="px-3 py-2.5 font-black tabular-nums text-violet-950 dark:text-white">{r.formatted_number}</td>
                    <td className="px-3 py-2.5 text-violet-800 dark:text-violet-200">{formatLocalDateTime(r.started_at)}</td>
                    <td className="px-3 py-2.5 text-violet-800 dark:text-violet-200">{formatLocalDateTime(r.finished_at)}</td>
                    <td className="px-3 py-2.5 text-violet-800 dark:text-violet-200">
                      {formatMinDisplay(r.queue_wait_minutes, t("minShort"))}
                    </td>
                    <td className="px-3 py-2.5 text-violet-800 dark:text-violet-200">
                      {formatMinDisplay(r.desk_service_minutes, t("minShort"))}
                    </td>
                    <td className="px-3 py-2.5 text-violet-800 dark:text-violet-200">
                      {formatMinDisplay(r.total_minutes, t("minShort"))}
                    </td>
                    <td className="px-3 py-2.5 font-semibold text-violet-950 dark:text-white">
                      {String(r.student_last_name || "").trim()} {String(r.student_first_name || "").trim()}
                    </td>
                    <td className="max-w-[200px] px-3 py-2.5 text-violet-800 dark:text-violet-200">
                      <div className="font-semibold">{r.school || "—"}</div>
                      <div className="text-[11px]">{r.specialty || ""}</div>
                    </td>
                    <td className="px-3 py-2.5 text-violet-800 dark:text-violet-200">
                      {formatStudyDuration(r.study_duration_years)}
                    </td>
                    <td className="px-3 py-2.5 text-violet-800 dark:text-violet-200">{r.advisor_name || "—"}</td>
                    <td className="px-3 py-2.5 text-violet-800 dark:text-violet-200">{r.advisor_desk || "—"}</td>
                    <td className="px-3 py-2.5 text-violet-800 dark:text-violet-200">{ticketStatusLabel(r.status, t)}</td>
                    <td className="px-3 py-2.5 text-violet-800 dark:text-violet-200">
                      {Number(r.is_repeat) === 1 ? t("adminVisitsYes") : t("adminVisitsNo")}
                    </td>
                    <td className="px-3 py-2.5 text-violet-800 dark:text-violet-200">{r.case_type || "—"}</td>
                    <td className="max-w-[240px] px-3 py-2.5 break-words text-violet-800 dark:text-violet-200">
                      {r.comment || "—"}
                    </td>
                    <td className="max-w-[240px] px-3 py-2.5 break-words text-violet-800 dark:text-violet-200">
                      {r.student_comment || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function starsLabel(n: number): string {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  const s = Math.min(5, Math.max(1, Math.round(x)));
  return "★".repeat(s) + "☆".repeat(5 - s);
}

function AdminReviewsExport() {
  const { t } = useI18n();
  const [from, setFrom] = useState(() => firstDayOfMonthYmd());
  const [to, setTo] = useState(() => localYmdToday());
  const [reviewStars, setReviewStars] = useState("");
  const [reviewSchool, setReviewSchool] = useState("");
  const [rows, setRows] = useState<AdminReviewExportRow[] | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const reviewsQuery = () => {
    const qs = new URLSearchParams({ from, to });
    if (reviewStars.trim()) qs.set("stars", reviewStars.trim());
    if (reviewSchool.trim()) qs.set("school", reviewSchool.trim());
    return qs;
  };

  const load = async () => {
    setLoading(true);
    setErr("");
    const qs = reviewsQuery();
    const res = await fetchJSON(`/api/admin/stats/reviews?${qs}`);
    if (!res.ok) {
      const j = (await readJSON<{ error?: string }>(res).catch(() => ({}))) as { error?: string };
      setErr(j.error || "Ошибка");
      setRows(null);
      setLoading(false);
      return;
    }
    const js = await readJSON<{ rows: AdminReviewExportRow[] }>(res);
    setRows(js.rows || []);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const downloadCsv = async () => {
    const qs = reviewsQuery();
    qs.set("format", "csv");
    const res = await fetchJSON(`/api/admin/stats/reviews?${qs}`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "student-reviews.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <NavLink
        to="/admin/stats"
        className="inline-flex items-center gap-2 text-sm font-extrabold text-violet-700 hover:text-violet-900 dark:text-violet-300 dark:hover:text-white"
      >
        ← {t("back")}
      </NavLink>
      <div className="rounded-2xl border border-violet-100 bg-white p-4 shadow-md shadow-violet-900/5 dark:border-white/10 dark:bg-slate-950 md:p-6">
        <h2 className="mb-2 text-base font-black text-violet-950 dark:text-white">{t("adminReviewsTitle")}</h2>
        <p className="mb-5 text-sm font-medium text-violet-700 dark:text-violet-300">{t("adminReviewsHint")}</p>

        <div className="mb-5 flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">
              {t("adminVisitsFrom")}
            </span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">
              {t("adminVisitsTo")}
            </span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
          </label>
          <label className="flex min-w-[120px] flex-col gap-1.5">
            <span className="text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">
              {t("adminFilterStars")}
            </span>
            <select
              value={reviewStars}
              onChange={(e) => setReviewStars(e.target.value)}
              className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-white"
            >
              <option value="">{t("adminFilterAny")}</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={String(n)}>
                  {n}★
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[240px] flex-col gap-1.5">
            <span className="text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">
              {t("adminFilterSchool")}
            </span>
            <select
              value={reviewSchool}
              onChange={(e) => setReviewSchool(e.target.value)}
              className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-white"
            >
              <option value="">{t("adminFilterAny")}</option>
              {SCHOOL_NAMES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-black text-white shadow-md shadow-violet-600/25 transition hover:bg-violet-500 disabled:opacity-60 dark:bg-violet-500 dark:hover:bg-violet-400"
          >
            {t("adminVisitsShow")}
          </button>
          <button
            type="button"
            onClick={() => void downloadCsv()}
            className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-extrabold text-violet-950 shadow-sm transition hover:bg-violet-100 dark:border-white/10 dark:bg-violet-950/40 dark:text-violet-100"
          >
            <Download className="h-4 w-4" aria-hidden />
            {t("adminVisitsDownloadCsv")}
          </button>
        </div>

        {err && <div className="mb-4 text-sm font-semibold text-rose-600">{err}</div>}

        {loading ? (
          <div className="py-12 text-center text-sm font-semibold text-violet-600 dark:text-violet-300">{t("loading")}</div>
        ) : !rows || rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-violet-600 dark:text-violet-400">{t("adminReviewsEmpty")}</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-violet-100 dark:border-white/10">
            <table className="min-w-[960px] w-full text-left text-xs">
              <thead className="bg-violet-50 text-violet-900 dark:bg-slate-900 dark:text-violet-200">
                <tr>
                  {[
                    t("adminReviewsColSubmitted"),
                    t("adminReviewsColStudent"),
                    t("adminReviewsColManager"),
                    t("adminReviewsColStars"),
                    t("adminReviewsColSchool"),
                    t("adminReviewsColVisitDone"),
                    t("adminReviewsColReview"),
                  ].map((h) => (
                    <th key={h} className="px-3 py-3 font-black uppercase tracking-widest text-[10px]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-violet-100 dark:divide-white/10">
                {rows.map((r) => (
                  <tr key={`${r.ticket_id}-${r.review_at}`} className="bg-white dark:bg-slate-950/50">
                    <td className="whitespace-nowrap px-3 py-2.5 text-violet-800 dark:text-violet-200">{formatLocalDateTime(r.review_at)}</td>
                    <td className="px-3 py-2.5 font-semibold text-violet-950 dark:text-white">
                      {String(r.student_last_name || "").trim()} {String(r.student_first_name || "").trim()}
                    </td>
                    <td className="px-3 py-2.5 text-violet-800 dark:text-violet-200">
                      <div>{r.advisor_name || "—"}</div>
                      {r.advisor_desk ? (
                        <div className="text-[11px] font-medium text-violet-500 dark:text-violet-400">{r.advisor_desk}</div>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono text-sm text-amber-700 dark:text-amber-300">
                      <span title={String(r.stars)}>{starsLabel(r.stars)}</span>
                      <span className="ml-2 text-[11px] font-bold text-violet-600 dark:text-violet-400">({r.stars}/5)</span>
                    </td>
                    <td className="max-w-[200px] px-3 py-2.5 text-violet-800 dark:text-violet-200">
                      <div className="font-semibold">{r.school || "—"}</div>
                      <div className="text-[11px]">{r.specialty || ""}</div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-violet-800 dark:text-violet-200">{formatLocalDateTime(r.visit_finished_at)}</td>
                    <td className="max-w-[280px] px-3 py-2.5 break-words text-violet-800 dark:text-violet-200">
                      {r.review_comment?.trim() ? r.review_comment : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

type AdminWaitRow = {
  ticket_id: number;
  formatted_number: string;
  queue_number: number;
  student_first_name: string | null;
  student_last_name: string | null;
  school: string | null;
  specialty?: string | null;
  language_section?: string | null;
  course?: string | null;
  study_duration_years?: number | null;
  status: string;
  created_at: string;
  called_at: string | null;
  started_at: string | null;
  wait_minutes: number;
};

type AdminWaitResponse = {
  from: string;
  to: string;
  summary: { count: number; avgMin: number; medianMin: number };
  rows: AdminWaitRow[];
};

type AdminQueueRow = {
  id: number;
  formatted_number: string;
  status: string;
  student_first_name: string | null;
  student_last_name: string | null;
  school: string | null;
  specialty: string | null;
  specialty_code: string | null;
  language_section: string | null;
  course: string | null;
  study_duration_years: number | null;
  owner_manager_name: string | null;
  owner_manager_desk: string | null;
  created_at: string;
};

type AdminQueuesResponse = { rows: AdminQueueRow[] };

type AdminSchoolsServedRow = { school: string; count: number };
type AdminSchoolsServedResponse = { from: string; to: string; rows: AdminSchoolsServedRow[] };

const TICKET_STATUSES = ["WAITING", "CALLED", "IN_SERVICE", "MISSED", "DONE", "CANCELLED"] as const;

export function AdminWaitStats() {
  const { t } = useI18n();
  const [from, setFrom] = useState(() => firstDayOfMonthYmd());
  const [to, setTo] = useState(() => localYmdToday());
  const [status, setStatus] = useState("");
  const [school, setSchool] = useState("");
  const [minWait, setMinWait] = useState("");
  const [maxWait, setMaxWait] = useState("");
  const [data, setData] = useState<AdminWaitResponse | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const todayRange = localYmdToday();
  const weekFrom = localYmdDaysAgo(6);
  const monthFrom = firstDayOfMonthYmd();
  const isTodayPreset = from === todayRange && to === todayRange;
  const isWeekPreset = from === weekFrom && to === todayRange;
  const isMonthPreset = from === monthFrom && to === todayRange;

  const buildQs = (csv: boolean) => {
    const qs = new URLSearchParams({ from, to });
    if (status.trim()) qs.set("status", status.trim().toUpperCase());
    if (school.trim()) qs.set("school", school.trim());
    const mn = Number(minWait);
    const mx = Number(maxWait);
    if (minWait.trim() !== "" && Number.isFinite(mn)) qs.set("minWait", String(mn));
    if (maxWait.trim() !== "" && Number.isFinite(mx)) qs.set("maxWait", String(mx));
    if (csv) qs.set("format", "csv");
    return qs;
  };

  const load = async () => {
    setLoading(true);
    setErr("");
    const res = await fetchJSON(`/api/admin/stats/wait-times?${buildQs(false)}`);
    if (!res.ok) {
      const j = (await readJSON<{ error?: string }>(res).catch(() => ({}))) as { error?: string };
      setErr(j.error || "Ошибка");
      setData(null);
      setLoading(false);
      return;
    }
    setData(await readJSON<AdminWaitResponse>(res));
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const downloadCsv = async () => {
    const res = await fetchJSON(`/api/admin/stats/wait-times?${buildQs(true)}`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "wait-times.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <NavLink
        to="/admin/stats"
        className="inline-flex items-center gap-2 text-sm font-extrabold text-violet-700 hover:text-violet-900 dark:text-violet-300 dark:hover:text-white"
      >
        ← {t("back")}
      </NavLink>
      <div className="rounded-2xl border border-violet-100 bg-white p-4 shadow-md shadow-violet-900/5 dark:border-white/10 dark:bg-slate-950 md:p-6">
        <h2 className="mb-2 text-base font-black text-violet-950 dark:text-white">{t("adminWaitTitle")}</h2>
        <p className="mb-5 text-sm font-medium text-violet-700 dark:text-violet-300">{t("adminWaitHint")}</p>

        <div className="mb-5 flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">
              {t("adminVisitsFrom")}
            </span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">
              {t("adminVisitsTo")}
            </span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
          </label>
          <label className="flex min-w-[160px] flex-col gap-1.5">
            <span className="text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">
              {t("adminWaitFilterStatus")}
            </span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-white"
            >
              <option value="">{t("adminFilterAny")}</option>
              {TICKET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ticketStatusLabel(s, t)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[240px] flex-col gap-1.5">
            <span className="text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">
              {t("adminFilterSchool")}
            </span>
            <select
              value={school}
              onChange={(e) => setSchool(e.target.value)}
              className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-white"
            >
              <option value="">{t("adminFilterAny")}</option>
              {SCHOOL_NAMES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex w-[100px] flex-col gap-1.5">
            <span className="text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">
              {t("adminWaitMinMin")}
            </span>
            <input
              type="number"
              min={0}
              step={1}
              value={minWait}
              onChange={(e) => setMinWait(e.target.value)}
              className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
          </label>
          <label className="flex w-[100px] flex-col gap-1.5">
            <span className="text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">
              {t("adminWaitMaxMin")}
            </span>
            <input
              type="number"
              min={0}
              step={1}
              value={maxWait}
              onChange={(e) => setMaxWait(e.target.value)}
              className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
          </label>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-black text-white shadow-md shadow-violet-600/25 transition hover:bg-violet-500 disabled:opacity-60 dark:bg-violet-500 dark:hover:bg-violet-400"
          >
            {t("adminVisitsShow")}
          </button>
          <button
            type="button"
            onClick={() => void downloadCsv()}
            className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-extrabold text-violet-950 shadow-sm transition hover:bg-violet-100 dark:border-white/10 dark:bg-violet-950/40 dark:text-violet-100"
          >
            <Download className="h-4 w-4" aria-hidden />
            {t("adminVisitsDownloadCsv")}
          </button>
        </div>
        <div className="mb-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              const d0 = localYmdToday();
              setFrom(d0);
              setTo(d0);
            }}
            className={presetRangeBtnClass(isTodayPreset)}
          >
            {t("adminPresetToday")}
          </button>
          <button
            type="button"
            onClick={() => {
              setFrom(localYmdDaysAgo(6));
              setTo(localYmdToday());
            }}
            className={presetRangeBtnClass(isWeekPreset)}
          >
            {t("adminPresetWeek")}
          </button>
          <button
            type="button"
            onClick={() => {
              setFrom(firstDayOfMonthYmd());
              setTo(localYmdToday());
            }}
            className={presetRangeBtnClass(isMonthPreset)}
          >
            {t("adminPresetMonth")}
          </button>
        </div>

        {err && <div className="mb-4 text-sm font-semibold text-rose-600">{err}</div>}

        {loading ? (
          <div className="py-12 text-center text-sm font-semibold text-violet-600 dark:text-violet-300">{t("loading")}</div>
        ) : data ? (
          <>
            <div className="mb-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-violet-100 bg-violet-50/80 px-4 py-3 dark:border-white/10 dark:bg-slate-900/80">
                <div className="text-[10px] font-black uppercase tracking-wider text-violet-600 dark:text-violet-400">
                  {t("adminWaitAvgShort")}
                </div>
                <div className="mt-1 text-2xl font-black tabular-nums text-violet-950 dark:text-white">
                  {data.summary.count ? data.summary.avgMin.toFixed(1) : "—"}
                </div>
              </div>
              <div className="rounded-xl border border-violet-100 bg-violet-50/80 px-4 py-3 dark:border-white/10 dark:bg-slate-900/80">
                <div className="text-[10px] font-black uppercase tracking-wider text-violet-600 dark:text-violet-400">
                  {t("adminWaitMedianShort")}
                </div>
                <div className="mt-1 text-2xl font-black tabular-nums text-violet-950 dark:text-white">
                  {data.summary.count ? data.summary.medianMin.toFixed(1) : "—"}
                </div>
              </div>
              <div className="rounded-xl border border-violet-100 bg-violet-50/80 px-4 py-3 dark:border-white/10 dark:bg-slate-900/80">
                <div className="text-[10px] font-black uppercase tracking-wider text-violet-600 dark:text-violet-400">
                  {t("adminWaitCountShort")}
                </div>
                <div className="mt-1 text-2xl font-black tabular-nums text-violet-950 dark:text-white">{data.summary.count}</div>
              </div>
            </div>
            {data.rows.length > 0 && (
              <div className="mb-6 rounded-xl border border-violet-100 bg-violet-50/60 px-4 py-3 dark:border-white/10 dark:bg-slate-900/70">
                <div className="mb-2 text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">
                  Распределение ожидания
                </div>
                {(() => {
                  const buckets = [
                    { label: "0-5", min: 0, max: 5 },
                    { label: "6-10", min: 6, max: 10 },
                    { label: "11-20", min: 11, max: 20 },
                    { label: "21-30", min: 21, max: 30 },
                    { label: "31-60", min: 31, max: 60 },
                    { label: "60+", min: 61, max: Number.POSITIVE_INFINITY },
                  ];
                  const counts = buckets.map((bucket) =>
                    data.rows.filter((r) => {
                      const w = Number(r.wait_minutes);
                      return Number.isFinite(w) && w >= bucket.min && w <= bucket.max;
                    }).length
                  );
                  const maxCount = Math.max(1, ...counts);
                  return (
                    <div className="flex flex-wrap items-end gap-3">
                      {buckets.map((bucket, idx) => {
                        const count = counts[idx] || 0;
                        const pct = (count / maxCount) * 100;
                        return (
                          <div key={bucket.label} className="flex w-[68px] flex-col items-center">
                            <div className="flex h-28 items-end">
                              <div
                                className="w-10 rounded-t-md bg-gradient-to-t from-violet-600 to-fuchsia-500"
                                style={{ height: `${count > 0 ? Math.max(8, pct) : 0}%` }}
                                title={`${bucket.label}: ${count}`}
                              />
                            </div>
                            <div className="mt-1 text-[10px] font-bold text-violet-700 dark:text-violet-300">{bucket.label}</div>
                            <div className="text-[10px] font-black text-violet-900 dark:text-white">{count}</div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            )}
            {data.rows.length === 0 ? (
              <div className="py-12 text-center text-sm text-violet-600 dark:text-violet-400">{t("adminWaitEmpty")}</div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-violet-100 dark:border-white/10">
                <table className="min-w-[1000px] w-full text-left text-xs">
                  <thead className="bg-violet-50 text-violet-900 dark:bg-slate-900 dark:text-violet-200">
                    <tr>
                      {[
                        t("adminVisitsColTicket"),
                        t("adminVisitsColQueue"),
                        t("adminWaitColRegistered"),
                        t("adminWaitColCalled"),
                        t("adminWaitColServiceStart"),
                        t("adminWaitColMinutes"),
                        t("adminVisitsColStatus"),
                        t("adminVisitsColStudent"),
                        t("adminVisitsColSchool"),
                      ].map((h) => (
                        <th key={h} className="px-3 py-3 font-black uppercase tracking-widest text-[10px]">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-violet-100 dark:divide-white/10">
                    {data.rows.map((r) => (
                      <tr key={r.ticket_id} className="bg-white dark:bg-slate-950/50">
                        <td className="px-3 py-2.5 font-mono text-[11px] text-violet-800 dark:text-violet-200">{r.ticket_id}</td>
                        <td className="px-3 py-2.5 font-black tabular-nums text-violet-950 dark:text-white">{r.formatted_number}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-violet-800 dark:text-violet-200">{formatLocalDateTime(r.created_at)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-violet-800 dark:text-violet-200">{formatLocalDateTime(r.called_at)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-violet-800 dark:text-violet-200">{formatLocalDateTime(r.started_at)}</td>
                        <td className="px-3 py-2.5 font-mono tabular-nums font-bold text-amber-700 dark:text-amber-300">
                          {formatMinDisplay(r.wait_minutes, t("minShort"))}
                        </td>
                        <td className="px-3 py-2.5 text-violet-800 dark:text-violet-200">{ticketStatusLabel(r.status, t)}</td>
                        <td className="px-3 py-2.5 font-semibold text-violet-950 dark:text-white">
                          {String(r.student_last_name || "").trim()} {String(r.student_first_name || "").trim()}
                        </td>
                        <td className="max-w-[180px] px-3 py-2.5 text-violet-800 dark:text-violet-200">{r.school || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}

function AdminQueuesBoard() {
  const { t } = useI18n();
  const loc = useLocation();
  const [rows, setRows] = useState<AdminQueueRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const load = async () => {
    setLoading(true);
    setErr("");
    const res = await fetchJSON("/api/admin/queues/all");
    const j = (await readJSON<AdminQueuesResponse & { error?: string }>(res).catch(() => ({ rows: [] }))) as
      | (AdminQueuesResponse & { error?: string })
      | { error?: string };
    if (!res.ok) {
      setErr((j as any)?.error || "Ошибка загрузки");
      setRows([]);
      setLoading(false);
      return;
    }
    setRows(Array.isArray((j as any).rows) ? (j as any).rows : []);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const filteredRows = useMemo(() => {
    if (!statusFilter.trim()) return rows;
    const statusQ = statusFilter.trim().toUpperCase();
    return rows.filter((r) => String(r.status || "").toUpperCase() === statusQ);
  }, [rows, statusFilter]);

  return (
    <div className="space-y-6">
      {loc.pathname.startsWith("/admin/stats/") ? (
        <NavLink
          to="/admin/stats"
          className="inline-flex items-center gap-2 text-sm font-extrabold text-violet-700 hover:text-violet-900 dark:text-violet-300 dark:hover:text-white"
        >
          ← {t("back")}
        </NavLink>
      ) : null}
      <div className="rounded-2xl border border-violet-100 bg-white p-4 shadow-md shadow-violet-900/5 dark:border-white/10 dark:bg-slate-950 md:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-black text-violet-950 dark:text-white">Все очереди по менеджерам</h2>
            <p className="mt-1 text-sm font-medium text-violet-700 dark:text-violet-300">
              Общий список активных талонов (WAITING/CALLED/IN_SERVICE) и их текущий менеджер.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-[180px] flex-col gap-1">
              <span className="text-[10px] font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">
                {t("adminWaitFilterStatus")}
              </span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-white"
              >
                <option value="">{t("adminFilterAny")}</option>
                {TICKET_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {ticketStatusLabel(s, t)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-black text-white shadow-md shadow-violet-600/25 transition hover:bg-violet-500"
            >
              {t("refresh")}
            </button>
          </div>
        </div>
        {err && <div className="mb-4 text-sm font-semibold text-rose-600">{err}</div>}
        {loading ? (
          <div className="py-12 text-center text-sm font-semibold text-violet-600 dark:text-violet-300">{t("loading")}</div>
        ) : filteredRows.length === 0 ? (
          <div className="py-12 text-center text-sm text-violet-600 dark:text-violet-400">{t("adminWaitEmpty")}</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-violet-100 dark:border-white/10">
            <table className="min-w-[1200px] w-full text-left text-xs">
              <thead className="bg-violet-50 text-violet-900 dark:bg-slate-900 dark:text-violet-200">
                <tr>
                  {["№", "Талон", "Статус", "Студент", "Профиль", "Менеджер", "Создан"].map((h) => (
                    <th key={h} className="px-3 py-3 font-black uppercase tracking-widest text-[10px]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-violet-100 dark:divide-white/10">
                {filteredRows.map((r) => (
                  <tr key={r.id} className="bg-white dark:bg-slate-950/50">
                    <td className="px-3 py-2.5 font-mono text-[11px] text-violet-800 dark:text-violet-200">{r.id}</td>
                    <td className="px-3 py-2.5 font-black tabular-nums text-violet-950 dark:text-white">{r.formatted_number}</td>
                    <td className="px-3 py-2.5 text-violet-800 dark:text-violet-200">{ticketStatusLabel(r.status, t)}</td>
                    <td className="px-3 py-2.5 font-semibold text-violet-950 dark:text-white">
                      {String(r.student_last_name || "").trim()} {String(r.student_first_name || "").trim()}
                    </td>
                    <td className="max-w-[340px] px-3 py-2.5 text-violet-800 dark:text-violet-200">
                      {r.school || "—"} · {r.language_section || "—"} · {r.course || "—"}
                      {r.study_duration_years != null ? ` · ${formatStudyDuration(r.study_duration_years)}` : ""}
                      <div className="mt-0.5 text-[11px] opacity-80">
                        {r.specialty || "—"} {r.specialty_code ? `(${r.specialty_code})` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-violet-800 dark:text-violet-200">
                      <div className="font-semibold text-violet-950 dark:text-white">{r.owner_manager_name || "—"}</div>
                      {r.owner_manager_desk ? <div className="text-[11px] opacity-80">{r.owner_manager_desk}</div> : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-violet-800 dark:text-violet-200">{formatLocalDateTime(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function AdminSchoolsServedStats() {
  const { t } = useI18n();
  const [from, setFrom] = useState(() => firstDayOfMonthYmd());
  const [to, setTo] = useState(() => localYmdToday());
  const [data, setData] = useState<AdminSchoolsServedResponse | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const todayRange = localYmdToday();
  const weekFrom = localYmdDaysAgo(6);
  const monthFrom = firstDayOfMonthYmd();
  const isTodayPreset = from === todayRange && to === todayRange;
  const isWeekPreset = from === weekFrom && to === todayRange;
  const isMonthPreset = from === monthFrom && to === todayRange;

  const qs = (csv: boolean) => {
    const s = new URLSearchParams({ from, to });
    if (csv) s.set("format", "csv");
    return s;
  };

  const load = async () => {
    setLoading(true);
    setErr("");
    const res = await fetchJSON(`/api/admin/stats/schools-served?${qs(false)}`);
    if (!res.ok) {
      const j = (await readJSON<{ error?: string }>(res).catch(() => ({}))) as { error?: string };
      setErr(j.error || "Ошибка");
      setData(null);
      setLoading(false);
      return;
    }
    setData(await readJSON<AdminSchoolsServedResponse>(res));
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const downloadCsv = async () => {
    const res = await fetchJSON(`/api/admin/stats/schools-served?${qs(true)}`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "schools-served.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const rows = data?.rows ?? [];
  const maxCount = rows.reduce((m, r) => Math.max(m, r.count), 0);
  const totalCount = rows.reduce((sum, r) => sum + Number(r.count || 0), 0);

  return (
    <div className="space-y-6">
      <NavLink
        to="/admin/stats"
        className="inline-flex items-center gap-2 text-sm font-extrabold text-violet-700 hover:text-violet-900 dark:text-violet-300 dark:hover:text-white"
      >
        ← {t("back")}
      </NavLink>
      <div className="rounded-2xl border border-violet-100 bg-white p-4 shadow-md shadow-violet-900/5 dark:border-white/10 dark:bg-slate-950 md:p-6">
        <h2 className="mb-2 text-base font-black text-violet-950 dark:text-white">{t("adminSchoolsTitle")}</h2>
        <p className="mb-5 text-sm font-medium text-violet-700 dark:text-violet-300">{t("adminSchoolsHint")}</p>

        <div className="mb-5 flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">
              {t("adminVisitsFrom")}
            </span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">
              {t("adminVisitsTo")}
            </span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
          </label>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-black text-white shadow-md shadow-violet-600/25 transition hover:bg-violet-500 disabled:opacity-60 dark:bg-violet-500 dark:hover:bg-violet-400"
          >
            {t("adminVisitsShow")}
          </button>
          <button
            type="button"
            onClick={() => void downloadCsv()}
            className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-extrabold text-violet-950 shadow-sm transition hover:bg-violet-100 dark:border-white/10 dark:bg-violet-950/40 dark:text-violet-100"
          >
            <Download className="h-4 w-4" aria-hidden />
            {t("adminVisitsDownloadCsv")}
          </button>
        </div>

        <div className="mb-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              const d0 = localYmdToday();
              setFrom(d0);
              setTo(d0);
            }}
            className={presetRangeBtnClass(isTodayPreset)}
          >
            {t("adminPresetToday")}
          </button>
          <button
            type="button"
            onClick={() => {
              setFrom(localYmdDaysAgo(6));
              setTo(localYmdToday());
            }}
            className={presetRangeBtnClass(isWeekPreset)}
          >
            {t("adminPresetWeek")}
          </button>
          <button
            type="button"
            onClick={() => {
              setFrom(firstDayOfMonthYmd());
              setTo(localYmdToday());
            }}
            className={presetRangeBtnClass(isMonthPreset)}
          >
            {t("adminPresetMonth")}
          </button>
        </div>

        {err && <div className="mb-4 text-sm font-semibold text-rose-600">{err}</div>}

        {loading ? (
          <div className="py-12 text-center text-sm font-semibold text-violet-600 dark:text-violet-300">{t("loading")}</div>
        ) : !data || rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-violet-600 dark:text-violet-400">{t("adminSchoolsEmpty")}</div>
        ) : (
          <>
            <div className="mb-4 inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-black text-violet-900 dark:border-white/10 dark:bg-slate-900 dark:text-violet-200">
              Итого по всем школам: <span className="tabular-nums text-violet-950 dark:text-white">{totalCount}</span>
            </div>
            <div className="mb-6 overflow-x-auto rounded-xl border border-violet-100 dark:border-white/10">
              <table className="min-w-[420px] w-full text-left text-sm">
                <thead className="bg-violet-50 text-violet-900 dark:bg-slate-900 dark:text-violet-200">
                  <tr>
                    <th className="px-3 py-2.5 font-black uppercase tracking-wider text-[10px]">{t("adminSchoolsColSchool")}</th>
                    <th className="px-3 py-2.5 font-black uppercase tracking-wider text-[10px]">{t("adminSchoolsColCount")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-violet-100 dark:divide-white/10">
                  {rows.map((r) => (
                    <tr key={r.school} className="bg-white dark:bg-slate-950/50">
                      <td className="px-3 py-2 text-violet-800 dark:text-violet-200">{r.school}</td>
                      <td className="px-3 py-2 font-bold tabular-nums text-violet-950 dark:text-white">{r.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div role="img" aria-label={t("adminSchoolsChartAria")} className="space-y-2">
              {rows.map((r) => {
                const pct = maxCount > 0 ? (r.count / maxCount) * 100 : 0;
                return (
                  <div key={r.school} className="flex items-center gap-3">
                    <div className="w-48 max-w-[40%] truncate text-xs font-semibold text-violet-800 dark:text-violet-200" title={r.school}>
                      {r.school}
                    </div>
                    <div className="relative h-8 flex-1 overflow-hidden rounded-xl border border-violet-100 bg-violet-50 dark:border-white/10 dark:bg-slate-900/60">
                      <div
                        className="absolute inset-y-0 left-0 rounded-xl bg-gradient-to-r from-sky-600 to-blue-600 shadow-sm dark:from-sky-700 dark:to-blue-600"
                        style={{ width: `${Math.max(2, pct)}%` }}
                        title={`${r.school}: ${r.count}`}
                      />
                      <div className="relative z-10 flex h-full items-center justify-end px-3 text-xs font-black tabular-nums text-violet-950 dark:text-white">
                        {r.count}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

type AdminBookingRow = {
  ticket_id: number;
  formatted_number: string;
  queue_number: number;
  student_first_name: string | null;
  student_last_name: string | null;
  school: string | null;
  specialty: string | null;
  preferred_slot_at: string;
  status: string;
  created_at: string;
  advisor_name: string | null;
  advisor_desk: string | null;
};

function AdminBookingsStats() {
  const { t } = useI18n();
  const [from, setFrom] = useState(() => localYmdToday());
  const [to, setTo] = useState(() => localYmdToday());
  const [status, setStatus] = useState("");
  const [school, setSchool] = useState("");
  const [managerId, setManagerId] = useState("");
  const [managers, setManagers] = useState<{ id: number; name: string; login?: string | null }[]>([]);
  const [rows, setRows] = useState<AdminBookingRow[] | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const todayRange = localYmdToday();
  const weekFrom = localYmdDaysAgo(6);
  const monthFrom = firstDayOfMonthYmd();
  const isTodayPreset = from === todayRange && to === todayRange;
  const isWeekPreset = from === weekFrom && to === todayRange;
  const isMonthPreset = from === monthFrom && to === todayRange;

  const buildQs = (csv: boolean) => {
    const qs = new URLSearchParams({ from, to });
    if (status.trim()) qs.set("status", status.trim().toUpperCase());
    if (school.trim()) qs.set("school", school.trim());
    if (managerId.trim()) qs.set("managerId", managerId.trim());
    if (csv) qs.set("format", "csv");
    return qs;
  };

  const load = async () => {
    setLoading(true);
    setErr("");
    const res = await fetchJSON(`/api/admin/stats/bookings?${buildQs(false)}`);
    if (!res.ok) {
      const j = (await readJSON<{ error?: string }>(res).catch(() => ({}))) as { error?: string };
      setErr(j.error || "Ошибка");
      setRows(null);
      setLoading(false);
      return;
    }
    const js = await readJSON<{ rows: AdminBookingRow[] }>(res);
    setRows(js.rows || []);
    setLoading(false);
  };

  useEffect(() => {
    void load();
    void (async () => {
      const res = await fetchJSON(`/api/admin/managers?day=${encodeURIComponent(localYmdToday())}`);
      if (!res.ok) return;
      const js = await readJSON<{ rows: { id: number; name: string; login?: string | null }[] }>(res);
      setManagers(js.rows || []);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const downloadCsv = async () => {
    const res = await fetchJSON(`/api/admin/stats/bookings?${buildQs(true)}`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bookings-by-slot.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <NavLink
        to="/admin/stats"
        className="inline-flex items-center gap-2 text-sm font-extrabold text-violet-700 hover:text-violet-900 dark:text-violet-300 dark:hover:text-white"
      >
        ← {t("back")}
      </NavLink>
      <div className="rounded-2xl border border-violet-100 bg-white p-4 shadow-md shadow-violet-900/5 dark:border-white/10 dark:bg-slate-950 md:p-6">
        <h2 className="mb-2 text-base font-black text-violet-950 dark:text-white">{t("adminBookingsTitle")}</h2>
        <p className="mb-5 text-sm font-medium text-violet-700 dark:text-violet-300">{t("adminBookingsHint")}</p>

        <div className="mb-5 flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">
              {t("adminVisitsFrom")}
            </span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">
              {t("adminVisitsTo")}
            </span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-white"
            />
          </label>
          <label className="flex min-w-[160px] flex-col gap-1.5">
            <span className="text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">
              {t("adminWaitFilterStatus")}
            </span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-white"
            >
              <option value="">{t("adminFilterAny")}</option>
              {TICKET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {ticketStatusLabel(s, t)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[160px] flex-col gap-1.5">
            <span className="text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">
              {t("adminFilterSchool")}
            </span>
            <select
              value={school}
              onChange={(e) => setSchool(e.target.value)}
              className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-white"
            >
              <option value="">{t("adminFilterAny")}</option>
              {SCHOOL_NAMES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[240px] flex-col gap-1.5">
            <span className="text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">
              {t("adminVisitsColManager")}
            </span>
            <select
              value={managerId}
              onChange={(e) => setManagerId(e.target.value)}
              className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4 dark:border-white/10 dark:bg-white/5 dark:text-white"
            >
              <option value="">{t("adminFilterAny")}</option>
              {managers.map((m) => (
                <option key={m.id} value={String(m.id)}>
                  {m.name}
                  {m.login ? ` (${m.login})` : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-black text-white shadow-md shadow-violet-600/25 transition hover:bg-violet-500 disabled:opacity-60 dark:bg-violet-500 dark:hover:bg-violet-400"
          >
            {t("adminVisitsShow")}
          </button>
          <button
            type="button"
            onClick={() => void downloadCsv()}
            className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-extrabold text-violet-950 shadow-sm transition hover:bg-violet-100 dark:border-white/10 dark:bg-violet-950/40 dark:text-violet-100"
          >
            <Download className="h-4 w-4" aria-hidden />
            {t("adminVisitsDownloadCsv")}
          </button>
        </div>
        <div className="mb-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              const d0 = localYmdToday();
              setFrom(d0);
              setTo(d0);
            }}
            className={presetRangeBtnClass(isTodayPreset)}
          >
            {t("adminPresetToday")}
          </button>
          <button
            type="button"
            onClick={() => {
              setFrom(localYmdDaysAgo(6));
              setTo(localYmdToday());
            }}
            className={presetRangeBtnClass(isWeekPreset)}
          >
            {t("adminPresetWeek")}
          </button>
          <button
            type="button"
            onClick={() => {
              setFrom(firstDayOfMonthYmd());
              setTo(localYmdToday());
            }}
            className={presetRangeBtnClass(isMonthPreset)}
          >
            {t("adminPresetMonth")}
          </button>
        </div>

        {err && <div className="mb-4 text-sm font-semibold text-rose-600">{err}</div>}

        {loading ? (
          <div className="py-12 text-center text-sm font-semibold text-violet-600 dark:text-violet-300">{t("loading")}</div>
        ) : !rows || rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-violet-600 dark:text-violet-400">{t("adminBookingsEmpty")}</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-violet-100 dark:border-white/10">
            <table className="min-w-[1100px] w-full text-left text-xs">
              <thead className="bg-violet-50 text-violet-900 dark:bg-slate-900 dark:text-violet-200">
                <tr>
                  {[
                    t("adminBookingsColSlot"),
                    t("adminVisitsColTicket"),
                    t("adminVisitsColQueue"),
                    t("adminVisitsColStudent"),
                    t("adminVisitsColSchool"),
                    t("adminVisitsColStatus"),
                    t("adminBookingsColRegistered"),
                    t("adminVisitsColManager"),
                    t("adminVisitsColDesk"),
                  ].map((h) => (
                    <th key={h} className="px-3 py-3 font-black uppercase tracking-widest text-[10px]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-violet-100 dark:divide-white/10">
                {rows.map((r) => (
                  <tr key={r.ticket_id} className="bg-white dark:bg-slate-950/50">
                    <td className="whitespace-nowrap px-3 py-2.5 font-bold tabular-nums text-violet-950 dark:text-white">
                      {formatLocalDateTime(String(r.preferred_slot_at || ""))}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-[11px] text-violet-800 dark:text-violet-200">{r.ticket_id}</td>
                    <td className="px-3 py-2.5 font-black tabular-nums text-violet-950 dark:text-white">{r.formatted_number}</td>
                    <td className="px-3 py-2.5 font-semibold text-violet-950 dark:text-white">
                      {String(r.student_last_name || "").trim()} {String(r.student_first_name || "").trim()}
                    </td>
                    <td className="max-w-[200px] px-3 py-2.5 text-violet-800 dark:text-violet-200">
                      <div className="font-semibold">{r.school || "—"}</div>
                      <div className="text-[11px]">{r.specialty || ""}</div>
                    </td>
                    <td className="px-3 py-2.5 text-violet-800 dark:text-violet-200">{ticketStatusLabel(r.status, t)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-violet-800 dark:text-violet-200">
                      {formatLocalDateTime(String(r.created_at || ""), { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </td>
                    <td className="px-3 py-2.5 text-violet-800 dark:text-violet-200">{r.advisor_name || "—"}</td>
                    <td className="px-3 py-2.5 text-violet-800 dark:text-violet-200">{r.advisor_desk || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function AdminStats() {
  const { t } = useI18n();
  const [data, setData] = useState<AdminSummary | null>(null);

  useEffect(() => {
    let c = false;
    void (async () => {
      const res = await fetchJSON("/api/admin/stats/summary");
      if (!res.ok || c) return;
      setData(await readJSON<AdminSummary>(res));
    })();
    return () => {
      c = true;
    };
  }, []);

  const faqNoQueue = data?.events.find((e) => e.event_type === "faq_no_queue")?.count ?? 0;

  const tiles: {
    icon: typeof Star;
    title: string;
    desc: string;
    metric: string;
    accent: string;
    linkTo?: string;
  }[] = [
    {
      icon: HelpCircle,
      title: t("adminStatFaq"),
      desc: t("adminStatFaqDesc"),
      metric: `${faqNoQueue} ${t("adminStatCount")}`,
      accent: "from-sky-500/90 to-blue-600",
      linkTo: "/admin/stats/faq",
    },
    {
      icon: Download,
      title: t("adminStatExport"),
      desc: t("adminStatExportDesc"),
      metric: "—",
      accent: "from-violet-500 to-purple-600",
      linkTo: "/admin/stats/visits",
    },
    {
      icon: LineChart,
      title: t("adminStatSchools"),
      desc: t("adminStatSchoolsDesc"),
      metric: "—",
      accent: "from-sky-500 to-indigo-600",
      linkTo: "/admin/stats/schools",
    },
    {
      icon: Star,
      title: t("adminStatReviews"),
      desc: t("adminStatReviewsDesc"),
      metric: data ? `${data.reviewsTotal} ${t("adminStatReviewsCount")}` : "…",
      accent: "from-emerald-500 to-teal-600",
      linkTo: "/admin/stats/reviews",
    },
    {
      icon: Activity,
      title: t("adminStatLoad"),
      desc: t("adminStatLoadDesc"),
      metric: data ? `${data.ticketsToday} ${t("adminStatTicketsToday")}` : "…",
      accent: "from-fuchsia-500 to-pink-600",
      linkTo: "/admin/load",
    },
    {
      icon: CalendarClock,
      title: t("adminStatBooking"),
      desc: t("adminStatBookingDesc"),
      metric: data ? `${data.bookedSlotsLive} ${t("adminStatBookedLive")}` : "…",
      accent: "from-indigo-500 to-violet-600",
      linkTo: "/admin/stats/bookings",
    },
    {
      icon: Users,
      title: "Все очереди",
      desc: "Общий список активных талонов по менеджерам.",
      metric: "Live",
      accent: "from-cyan-500 to-blue-600",
      linkTo: "/admin/stats/queues",
    },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold text-violet-700 dark:text-violet-300">{t("adminStatsHub")}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {tiles.map((tile) => {
          const inner = (
            <>
              <div className="absolute inset-0 bg-white/10 opacity-0 transition group-hover:opacity-100 dark:bg-black/10" />
              <div className="relative flex items-start gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/20 text-white shadow-inner ring-2 ring-white/30 backdrop-blur-sm">
                  <tile.icon className="h-7 w-7" strokeWidth={2.2} aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-base font-black leading-tight text-white">{tile.title}</div>
                  <p className="mt-2 text-sm font-semibold leading-snug text-white/90">{tile.desc}</p>
                  <div className="mt-4 inline-flex rounded-full bg-black/20 px-4 py-1.5 text-xs font-black tabular-nums text-white backdrop-blur-md dark:bg-black/30">
                    {tile.metric}
                  </div>
                </div>
              </div>
            </>
          );
          const tileCls = cn(
            "group relative block overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br p-6 text-left shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl focus:outline-none focus:ring-4 focus:ring-violet-400/40 dark:focus:ring-violet-500/30",
            `bg-gradient-to-br ${tile.accent}`
          );
          if (tile.linkTo) {
            return (
              <NavLink key={tile.title} to={tile.linkTo} className={tileCls}>
                {inner}
              </NavLink>
            );
          }
          return (
            <button key={tile.title} type="button" className={tileCls}>
              {inner}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AdminSettingsInner() {
  const { t, lang, setLang } = useI18n();
  const { adminUser } = useAdminContext();
  const nav = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [nextPassword2, setNextPassword2] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState("");
  const [passwordErr, setPasswordErr] = useState("");
  const langs: { id: Lang; label: string }[] = [
    { id: "rus", label: "Русский" },
    { id: "eng", label: "English" },
    { id: "kaz", label: "Қазақша" },
  ];

  const submitAdminPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordErr("");
    setPasswordMsg("");
    if (!currentPassword || !nextPassword) {
      setPasswordErr(t("adminPasswordFillAll"));
      return;
    }
    if (nextPassword !== nextPassword2) {
      setPasswordErr(t("adminPasswordMismatch"));
      return;
    }
    setPasswordBusy(true);
    const res = await fetchJSON("/api/admin/me/password", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword: nextPassword }),
    });
    const j = (await readJSON<{ error?: string }>(res).catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setPasswordErr(j.error || t("adminPasswordChangeError"));
      setPasswordBusy(false);
      return;
    }
    setCurrentPassword("");
    setNextPassword("");
    setNextPassword2("");
    setPasswordMsg(t("adminPasswordChanged"));
    setPasswordBusy(false);
  };

  return (
    <div className="max-w-xl rounded-2xl border border-violet-200/80 bg-white p-7 shadow-lg shadow-violet-900/5 dark:border-white/10 dark:bg-slate-950 dark:shadow-black/40">
      <h2 className="mb-6 text-lg font-black tracking-tight text-violet-950 dark:text-white">{t("settings")}</h2>
      <div className="space-y-8">
        <div>
          <span className="mb-3 block text-xs font-extrabold uppercase tracking-wider text-violet-700 dark:text-violet-300">
            {t("langUi")}
          </span>
          <div className="grid grid-cols-3 gap-2 rounded-2xl border border-violet-100 bg-slate-50/80 p-1.5 dark:border-white/10 dark:bg-slate-900/80">
            {langs.map((L) => (
              <button
                key={L.id}
                type="button"
                onClick={() => setLang(L.id)}
                className={cn(
                  "rounded-xl py-2.5 text-center text-xs font-extrabold transition",
                  lang === L.id
                    ? "bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-600/25"
                    : "text-violet-800 hover:bg-white dark:text-violet-200 dark:hover:bg-white/5"
                )}
              >
                {L.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] font-medium text-violet-600 dark:text-violet-400">{t("langUiHint")}</p>
        </div>
        <div className="rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-50 to-indigo-50/90 px-5 py-4">
          <div className="mb-2 text-sm font-extrabold text-violet-950">Сотрудники</div>
          <p className="mb-3 text-xs font-semibold text-violet-700">Управление менеджерами перенесено в отдельную страницу.</p>
          <button
            type="button"
            onClick={() => nav("/admin/employees")}
            className="rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2 text-sm font-black text-white"
          >
            Открыть сотрудников
          </button>
        </div>
        <form
          onSubmit={(e) => void submitAdminPassword(e)}
          className="space-y-3 rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-50 to-indigo-50/90 px-5 py-4"
        >
          <div className="text-sm font-extrabold text-violet-950">{t("adminChangePasswordTitle")}</div>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            className="w-full rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4"
            placeholder={t("adminCurrentPassword")}
          />
          <input
            type="password"
            value={nextPassword}
            onChange={(e) => setNextPassword(e.target.value)}
            autoComplete="new-password"
            className="w-full rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4"
            placeholder={t("adminNewPassword")}
          />
          <input
            type="password"
            value={nextPassword2}
            onChange={(e) => setNextPassword2(e.target.value)}
            autoComplete="new-password"
            className="w-full rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm font-semibold text-violet-950 outline-none ring-violet-400/30 focus:ring-4"
            placeholder={t("adminNewPasswordRepeat")}
          />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={passwordBusy}
              className="rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2 text-sm font-black text-white"
            >
              {passwordBusy ? t("loading") : t("adminPasswordSave")}
            </button>
            {passwordErr ? <span className="text-xs font-semibold text-rose-700">{passwordErr}</span> : null}
            {passwordMsg ? <span className="text-xs font-semibold text-emerald-700">{passwordMsg}</span> : null}
          </div>
        </form>
        {adminUser && (
          <p className="text-xs font-semibold text-violet-600 dark:text-violet-400">
            {adminUser.name} · {adminUser.login}
          </p>
        )}
      </div>
    </div>
  );
}

function AdminSettingsPage() {
  return <AdminSettingsInner />;
}

function AdminLayout() {
  const { adminUser, setAdminUser } = useAdminContext();
  const loc = useLocation();
  const nav = useNavigate();
  const { t } = useI18n();

  useEffect(() => {
    let cancelled = false;
    setAdminUser(undefined);
    (async () => {
      const res = await fetchJSON("/api/admin/me");
      if (cancelled) return;
      if (res.ok) {
        const user = await readJSON<AdminUser>(res);
        setAdminUser(user);
      } else {
        setAdminUser(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setAdminUser]);

  const logout = async () => {
    await fetchJSON("/api/admin/logout", { method: "POST" });
    setAdminUser(null);
    nav("/admin", { replace: true });
  };

  if (adminUser === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 dark:bg-slate-900">
        <p className="text-sm font-bold text-violet-700 dark:text-violet-300">{t("loading")}</p>
      </div>
    );
  }

  if (!adminUser) {
    if (loc.pathname !== "/admin" && loc.pathname !== "/admin/") {
      return <Navigate to="/admin" replace />;
    }
    return <AdminLogin />;
  }

  if (loc.pathname === "/admin" || loc.pathname === "/admin/") {
    return <Navigate to="/admin/dashboard" replace />;
  }

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-900">
      <header className="sticky top-0 z-30 shadow-md shadow-violet-900/15">
        <div className="bg-gradient-to-r from-violet-700 via-purple-700 to-indigo-700 px-4 py-3.5 dark:from-violet-950 dark:via-indigo-950 dark:to-slate-950">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 shrink-0 items-center justify-center rounded-xl bg-white/15 px-1.5 py-1 ring-1 ring-white/20">
                <AppLogo className="h-9 w-auto max-h-9 max-w-[120px] object-contain object-center" />
              </div>
              <div className="min-w-0 leading-tight">
                <div className="truncate text-base font-black tracking-tight text-white">{t("adminPanel")}</div>
                <div className="truncate text-[11px] font-medium text-violet-100">{adminUser.name}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void logout()}
              className="flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-4 py-2 text-xs font-extrabold text-white backdrop-blur-sm transition hover:bg-white/20"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              {t("logout")}
            </button>
          </div>
        </div>
        <AdminTabNav />
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

export default function AdminApp() {
  return (
    <Routes>
      <Route path="/admin" element={<AdminLayout />}>
        <Route path="dashboard" element={<AdminQueuesBoard />} />
        <Route path="employees" element={<AdminEmployees />} />
        <Route path="stats" element={<AdminStats />} />
        <Route path="stats/visits" element={<AdminVisitsExport />} />
        <Route path="stats/faq" element={<AdminFaqNoQueueStats />} />
        <Route path="stats/reviews" element={<AdminReviewsExport />} />
        <Route path="stats/queues" element={<AdminQueuesBoard />} />
        <Route path="stats/schools" element={<AdminSchoolsServedStats />} />
        <Route path="stats/bookings" element={<AdminBookingsStats />} />
        <Route path="load" element={<AdminLoad />} />
        <Route path="windows" element={<AdminWindows />} />
        <Route path="settings" element={<AdminSettingsPage />} />
      </Route>
    </Routes>
  );
}
