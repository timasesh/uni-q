import {
  Routes,
  Route,
  Navigate,
  NavLink,
  useLocation,
  useNavigate,
  Outlet,
  useOutletContext,
} from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import {
  LogOut,
  BarChart3,
  Users,
  Settings,
  HelpCircle,
  Download,
  Clock,
  Star,
  Activity,
  CalendarClock,
  LayoutGrid,
  LineChart,
  Moon,
  Sun,
} from "lucide-react";
import { fetchJSON, readJSON } from "../api";
import { useI18n, type Lang } from "../i18n";
import { useAdminContext, type AdminUser } from "../context/AdminContext";
import { useAdvisorContext } from "../context/AdvisorContext";
import { cn } from "../lib/cn";
import { SCHEME_WINDOW_COUNT, parseDeskWindowNumber, schemeImagePathForWindow } from "../lib/deskWindow";

export type AdminOutletCtx = { adminDark: boolean; setAdminDark: (v: boolean) => void };

function formatHm(ms: number) {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
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
  const parts: string[] = [];
  if (schools.length) parts.push(`Школы: ${schools.join(", ")}`);
  parts.push(langs?.length ? `Языки: ${langs.join(", ")}` : "Языки: любые");
  parts.push(`Курсы: ${(courses.length ? courses : [1, 2, 3, 4]).join(", ")}`);
  if (specs.length) parts.push(`Спец.: ${specs.join(", ")}`);
  return parts.join(" · ");
}

function AdminLogin() {
  const { t } = useI18n();
  const { setAdminUser } = useAdminContext();
  const { setAdvisorId } = useAdvisorContext();
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
    setAdvisorId(null);
    setAdminUser({ id: j.id, login: j.login, name: j.name });
    nav("/admin/employees", { replace: true });
    setBusy(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-16 dark:bg-slate-900">
      <div className="w-full max-w-md rounded-2xl border border-violet-200/80 bg-white p-8 shadow-xl shadow-violet-900/10 dark:border-white/10 dark:bg-slate-950">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-600/30">
            <Settings className="h-6 w-6" aria-hidden />
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
      <NavLink to="/admin/employees" className={tabCls}>
        <Users className="h-4 w-4 opacity-80" aria-hidden />
        {t("adminEmployees")}
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

  useEffect(() => {
    let c = false;
    (async () => {
      const res = await fetchJSON("/api/admin/advisors");
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

  return (
    <div className="rounded-2xl border border-violet-100 bg-white p-4 shadow-md shadow-violet-900/5 dark:border-white/10 dark:bg-slate-950 md:p-6">
      <h2 className="mb-4 text-base font-black text-violet-950 dark:text-white">{t("adminStaffList")}</h2>
      {err && <div className="mb-3 text-sm font-semibold text-rose-600">{err}</div>}
      {!rows ? (
        <div className="py-12 text-center text-sm font-semibold text-violet-600 dark:text-violet-300">{t("loading")}</div>
      ) : rows.length === 0 ? (
        <div className="py-12 text-center text-sm text-violet-600 dark:text-violet-300">—</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-violet-100 text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:border-white/10 dark:text-violet-300">
                <th className="py-3 pr-3">ID</th>
                <th className="py-3 pr-3">{t("adminColName")}</th>
                <th className="py-3 pr-3">{t("adminColLogin")}</th>
                <th className="py-3 pr-3">{t("adminColFaculty")}</th>
                <th className="py-3 pr-3">{t("adminColDesk")}</th>
                <th className="py-3 pr-3">{t("adminColReception")}</th>
                <th className="py-3">{t("adminColWorkedToday")}</th>
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
    const res = await fetchJSON("/api/admin/advisors");
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
      const res = await fetchJSON("/api/admin/advisors");
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
          const res = await fetchJSON(`/api/admin/advisors/${prevId}/desk`, {
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
        const res = await fetchJSON(`/api/admin/advisors/${nextId}/desk`, {
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
                      <img
                        src={schemeImagePathForWindow(w)}
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
  date: string;
  startHour: number;
  endHour: number;
  registrations: { hour: number; count: number }[];
  calls: { hour: number; count: number }[];
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
  const [date, setDate] = useState(() => localYmdDaysAgo(1));
  const [data, setData] = useState<AdminLoadResponse | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const res = await fetchJSON(`/api/admin/stats/load?date=${encodeURIComponent(date)}`);
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
  }, [date]);

  const maxCount = useMemo(() => {
    if (!data) return 1;
    let m = 1;
    for (const p of data.registrations) m = Math.max(m, p.count);
    for (const p of data.calls) m = Math.max(m, p.count);
    return m;
  }, [data]);

  return (
    <div className="rounded-2xl border border-violet-100 bg-white p-4 shadow-md shadow-violet-900/5 dark:border-white/10 dark:bg-slate-950 md:p-6">
      <h2 className="mb-2 text-base font-black text-violet-950 dark:text-white">{t("adminLoadTitle")}</h2>
      <p className="mb-5 text-sm font-medium leading-relaxed text-violet-700 dark:text-violet-300">{t("adminLoadHint")}</p>

      <label className="mb-6 flex flex-wrap items-center gap-3">
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
            <div className="flex min-w-[520px] gap-1 border-b border-violet-200 pb-1 pl-9 dark:border-white/15">
              {data.registrations.map((r, i) => {
                const call = data.calls[i];
                const pctReg = maxCount > 0 ? (r.count / maxCount) * 100 : 0;
                const pctCall = maxCount > 0 && call ? (call.count / maxCount) * 100 : 0;
                return (
                  <div key={r.hour} className="flex min-w-0 flex-1 flex-col">
                    <div className="flex h-48 justify-center gap-0.5 px-0.5">
                      <div
                        className="flex h-full w-1/2 min-w-[10px] flex-col justify-end"
                        title={`${t("adminLoadRegistrations")}: ${r.count}`}
                      >
                        <div
                          className="w-full rounded-t-md bg-gradient-to-t from-violet-600 to-violet-400 shadow-sm dark:from-violet-700 dark:to-violet-500"
                          style={{ height: `${r.count > 0 ? Math.max(pctReg, 5) : 0}%` }}
                        />
                      </div>
                      <div
                        className="flex h-full w-1/2 min-w-[10px] flex-col justify-end"
                        title={`${t("adminLoadCalls")}: ${call?.count ?? 0}`}
                      >
                        <div
                          className="w-full rounded-t-md bg-gradient-to-t from-emerald-600 to-emerald-400 shadow-sm dark:from-emerald-700 dark:to-emerald-500"
                          style={{ height: `${call && call.count > 0 ? Math.max(pctCall, 5) : 0}%` }}
                        />
                      </div>
                    </div>
                    <div className="mt-1.5 text-center text-[10px] font-black tabular-nums text-violet-600 dark:text-violet-400">
                      {r.hour}:00
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
  advisor_name: string | null;
  advisor_desk: string | null;
  case_type: string | null;
  comment: string | null;
  finished_at: string | null;
  is_repeat: number;
};

type FaqDailyPoint = { day: string; count: number };

function AdminFaqNoQueueStats() {
  const { t } = useI18n();
  const [rows, setRows] = useState<FaqDailyPoint[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await fetchJSON("/api/admin/stats/faq-no-queue");
      if (cancelled) return;
      if (!res.ok) {
        setErr("Нет доступа");
        setRows(null);
        return;
      }
      const js = await readJSON<{ series: FaqDailyPoint[] }>(res);
      setRows(js.series || []);
      setErr("");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const maxCount = useMemo(() => {
    if (!rows || rows.length === 0) return 1;
    let m = 1;
    for (const r of rows) m = Math.max(m, r.count);
    return m;
  }, [rows]);

  const downloadCsv = async () => {
    const res = await fetchJSON("/api/admin/stats/faq-no-queue?format=csv");
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
        {err && <div className="mb-3 text-sm font-semibold text-rose-600">{err}</div>}
        <div className="mb-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void downloadCsv()}
            className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-extrabold text-violet-950 shadow-sm transition hover:bg-violet-100 dark:border-white/10 dark:bg-violet-950/40 dark:text-violet-100"
          >
            <Download className="h-4 w-4" aria-hidden />
            {t("adminFaqStatsDownload")}
          </button>
        </div>
        {!rows ? (
          <div className="py-12 text-center text-sm font-semibold text-violet-600 dark:text-violet-300">{t("loading")}</div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-violet-600 dark:text-violet-400">{t("adminFaqStatsEmpty")}</div>
        ) : (
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
        )}
      </div>
    </div>
  );
}

function AdminVisitsExport() {
  const { t } = useI18n();
  const [from, setFrom] = useState(() => firstDayOfMonthYmd());
  const [to, setTo] = useState(() => localYmdToday());
  const [rows, setRows] = useState<AdminVisitExportRow[] | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setErr("");
    const qs = new URLSearchParams({ from, to });
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
    const qs = new URLSearchParams({ from, to, format: "csv" });
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
          <div className="py-12 text-center text-sm text-violet-600 dark:text-violet-400">{t("adminVisitsEmpty")}</div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-violet-100 dark:border-white/10">
            <table className="min-w-[1100px] w-full text-left text-xs">
              <thead className="bg-violet-50 text-violet-900 dark:bg-slate-900 dark:text-violet-200">
                <tr>
                  {[
                    t("adminVisitsColTicket"),
                    t("adminVisitsColQueue"),
                    t("adminVisitsColFinished"),
                    t("adminVisitsColStudent"),
                    t("adminVisitsColSchool"),
                    t("adminVisitsColAdvisor"),
                    t("adminVisitsColDesk"),
                    t("adminVisitsColStatus"),
                    t("adminVisitsColRepeat"),
                    t("adminVisitsColCategory"),
                    t("adminVisitsColComment"),
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
                    <td className="px-3 py-2.5 text-violet-800 dark:text-violet-200">
                      {r.finished_at ? String(r.finished_at).replace("T", " ").slice(0, 19) : "—"}
                    </td>
                    <td className="px-3 py-2.5 font-semibold text-violet-950 dark:text-white">
                      {String(r.student_last_name || "").trim()} {String(r.student_first_name || "").trim()}
                    </td>
                    <td className="max-w-[200px] px-3 py-2.5 text-violet-800 dark:text-violet-200">
                      <div className="font-semibold">{r.school || "—"}</div>
                      <div className="text-[11px]">{r.specialty || ""}</div>
                    </td>
                    <td className="px-3 py-2.5 text-violet-800 dark:text-violet-200">{r.advisor_name || "—"}</td>
                    <td className="px-3 py-2.5 text-violet-800 dark:text-violet-200">{r.advisor_desk || "—"}</td>
                    <td className="px-3 py-2.5 text-violet-800 dark:text-violet-200">{r.status}</td>
                    <td className="px-3 py-2.5 text-violet-800 dark:text-violet-200">
                      {Number(r.is_repeat) === 1 ? t("adminVisitsYes") : t("adminVisitsNo")}
                    </td>
                    <td className="px-3 py-2.5 text-violet-800 dark:text-violet-200">{r.case_type || "—"}</td>
                    <td className="max-w-[240px] px-3 py-2.5 break-words text-violet-800 dark:text-violet-200">
                      {r.comment || "—"}
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
      icon: Clock,
      title: t("adminStatWait"),
      desc: t("adminStatWaitDesc"),
      metric: "—",
      accent: "from-amber-500 to-orange-600",
    },
    {
      icon: Star,
      title: t("adminStatReviews"),
      desc: t("adminStatReviewsDesc"),
      metric: data ? `${data.reviewsTotal} ${t("adminStatReviewsCount")}` : "…",
      accent: "from-emerald-500 to-teal-600",
    },
    {
      icon: Activity,
      title: t("adminStatLoad"),
      desc: t("adminStatLoadDesc"),
      metric: data ? `${data.ticketsToday} ${t("adminStatTicketsToday")}` : "…",
      accent: "from-fuchsia-500 to-pink-600",
    },
    {
      icon: CalendarClock,
      title: t("adminStatBooking"),
      desc: t("adminStatBookingDesc"),
      metric: data ? `${data.bookedSlotsLive} ${t("adminStatBookedLive")}` : "…",
      accent: "from-indigo-500 to-violet-600",
    },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold text-violet-700 dark:text-violet-300">{t("adminStatsSoon")}</p>
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

function AdminSettingsInner({ adminDark, setAdminDark }: AdminOutletCtx) {
  const { t, lang, setLang } = useI18n();
  const { adminUser } = useAdminContext();
  const langs: { id: Lang; label: string }[] = [
    { id: "rus", label: "Русский" },
    { id: "eng", label: "English" },
    { id: "kaz", label: "Қазақша" },
  ];

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
        <div
          className={cn(
            "flex items-center justify-between gap-4 rounded-2xl border px-5 py-4",
            adminDark
              ? "border-indigo-400/40 bg-slate-900 ring-1 ring-indigo-500/25"
              : "border-violet-200 bg-gradient-to-r from-violet-50 to-indigo-50/90"
          )}
        >
          <div>
            <div className={cn("text-sm font-extrabold", adminDark ? "text-white" : "text-violet-950")}>
              {t("darkTheme")}
            </div>
            <div className={cn("mt-0.5 text-xs font-semibold", adminDark ? "text-indigo-200" : "text-violet-700")}>
              {t("darkThemeDesc")}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={adminDark}
            onClick={() => setAdminDark(!adminDark)}
            className={cn(
              "relative h-9 w-16 shrink-0 rounded-full border-2 transition-colors focus:outline-none focus:ring-4",
              adminDark
                ? "border-emerald-400/80 bg-emerald-600 focus:ring-emerald-500/40"
                : "border-violet-200 bg-white focus:ring-violet-200 dark:border-white/20 dark:bg-slate-800",
              adminDark ? "shadow-[0_0_20px_-4px_rgba(16,185,129,0.7)]" : ""
            )}
          >
            <span
              className={cn(
                "absolute top-1 left-1 h-7 w-7 rounded-full bg-white shadow-md transition-transform dark:bg-slate-100",
                adminDark ? "translate-x-7" : "translate-x-0"
              )}
            />
          </button>
        </div>
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
  const ctx = useOutletContext<AdminOutletCtx>();
  return <AdminSettingsInner {...ctx} />;
}

function AdminLayout() {
  const { adminUser, setAdminUser } = useAdminContext();
  const loc = useLocation();
  const nav = useNavigate();
  const { t } = useI18n();

  const [adminDark, setAdminDark] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setAdminUser(undefined);
    (async () => {
      const res = await fetchJSON("/api/admin/me");
      if (cancelled) return;
      if (res.ok) setAdminUser(await readJSON<AdminUser>(res));
      else setAdminUser(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [setAdminUser]);

  useEffect(() => {
    if (!adminUser) return;
    const k = `uniq.admin.theme.${adminUser.id}`;
    let v = localStorage.getItem(k);
    if (v === null && localStorage.getItem("uniq.theme") === "dark") {
      localStorage.setItem(k, "dark");
      v = "dark";
    }
    setAdminDark(v === "dark");
  }, [adminUser?.id]);

  useEffect(() => {
    if (!adminUser) return;
    localStorage.setItem(`uniq.admin.theme.${adminUser.id}`, adminDark ? "dark" : "light");
  }, [adminUser, adminDark]);

  useEffect(() => {
    const root = document.documentElement;
    if (adminUser && adminDark) root.classList.add("dark");
    else if (adminUser) root.classList.remove("dark");
  }, [adminUser, adminDark]);

  useEffect(() => {
    return () => {
      if (!window.location.pathname.startsWith("/admin")) document.documentElement.classList.remove("dark");
    };
  }, []);

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
    return <Navigate to="/admin/employees" replace />;
  }

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-900">
      <header className="sticky top-0 z-30 shadow-md shadow-violet-900/15">
        <div className="bg-gradient-to-r from-violet-700 via-purple-700 to-indigo-700 px-4 py-3.5 dark:from-violet-950 dark:via-indigo-950 dark:to-slate-950">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20">
                <Settings className="h-5 w-5 text-white" aria-hidden />
              </div>
              <div className="min-w-0 leading-tight">
                <div className="truncate text-base font-black tracking-tight text-white">{t("adminPanel")}</div>
                <div className="truncate text-[11px] font-medium text-violet-100">{adminUser.name}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAdminDark(!adminDark)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/30 bg-white/10 text-white backdrop-blur-sm transition hover:bg-white/20"
              title={adminDark ? t("adminThemeLightHint") : t("adminThemeDarkHint")}
              aria-label={adminDark ? t("adminThemeLightHint") : t("adminThemeDarkHint")}
            >
              {adminDark ? <Sun className="h-5 w-5" aria-hidden /> : <Moon className="h-5 w-5" aria-hidden />}
            </button>
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
        <Outlet context={{ adminDark, setAdminDark } as AdminOutletCtx} />
      </main>
    </div>
  );
}

export default function AdminApp() {
  return (
    <Routes>
      <Route path="/admin" element={<AdminLayout />}>
        <Route path="employees" element={<AdminEmployees />} />
        <Route path="stats" element={<AdminStats />} />
        <Route path="stats/visits" element={<AdminVisitsExport />} />
        <Route path="stats/faq" element={<AdminFaqNoQueueStats />} />
        <Route path="load" element={<AdminLoad />} />
        <Route path="windows" element={<AdminWindows />} />
        <Route path="settings" element={<AdminSettingsPage />} />
      </Route>
    </Routes>
  );
}
