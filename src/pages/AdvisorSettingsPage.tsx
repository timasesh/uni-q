import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Eye, EyeOff } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { fetchJSON, readJSON } from "../api";
import type { Advisor } from "../types";
import { cn } from "../lib/cn";
import { useI18n } from "../i18n";
import { useManagerContext } from "../context/ManagerContext";
import { hydrateManagerWorkedFromServer } from "../lib/advisorWorkSync";
import { SCHOOL_DATA, SCHOOL_NAMES } from "../schools";
import { AppLogo } from "../lib/brand";
import { STUDY_DURATION_OPTIONS, parseStudyDuration } from "../lib/studyDuration";

const LANGS = [
  { id: "ru", label: "Рус" },
  { id: "kz", label: "Каз" },
  { id: "en", label: "Анг" },
] as const;

function safeParseArray<T = unknown>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

type SchoolScopeSettings = {
  langs: string[];
  studyYears: number[];
};

function parseSchoolScopes(raw: string | null | undefined): Record<string, SchoolScopeSettings> {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw) as Record<string, any>;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
    const out: Record<string, SchoolScopeSettings> = {};
    for (const [school, cfg] of Object.entries(obj)) {
      if (!cfg || typeof cfg !== "object") continue;
      const langs = Array.isArray((cfg as any).langs) ? (cfg as any).langs.map((x: any) => String(x).toLowerCase()) : [];
      const studyYears = Array.isArray((cfg as any).studyYears)
        ? (cfg as any).studyYears.map((x: any) => parseStudyDuration(x)).filter((n: any): n is number => n != null)
        : [];
      const normalizedLangs = Array.from(new Set(langs)) as string[];
      const normalizedYears = (Array.from(new Set(studyYears)) as number[]).sort((a, b) => a - b);
      out[school] = { langs: normalizedLangs, studyYears: normalizedYears };
    }
    return out;
  } catch {
    return {};
  }
}

export default function AdvisorSettingsPage() {
  const { t } = useI18n();
  const nav = useNavigate();
  const { setManagerId } = useManagerContext();
  const [me, setMe] = useState<Advisor | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNext, setPwNext] = useState("");
  const [pwNext2, setPwNext2] = useState("");
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState("");
  const [pwShow, setPwShow] = useState(false);

  const [schools, setSchools] = useState<string[]>([]);
  const [langs, setLangs] = useState<string[]>([]);
  const [courses, setCourses] = useState<number[]>([1, 2, 3, 4]);
  const [specialtyCodes, setSpecialtyCodes] = useState<string[]>([]);
  const [studyYears, setStudyYears] = useState<number[]>([]);
  const [schoolScopes, setSchoolScopes] = useState<Record<string, SchoolScopeSettings>>({});
  const [scopeSchool, setScopeSchool] = useState("");

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const res = await fetchJSON("/api/managers/me");
      if (!res.ok) {
        setMe(null);
        setLoading(false);
        return;
      }
      const js = await readJSON<Advisor>(res);
      hydrateManagerWorkedFromServer(js.id, Number(js.total_work_ms) || 0);
      setMe(js);
      setSchools(safeParseArray<string>(js.assigned_schools_json));
      setLangs(safeParseArray<string>(js.assigned_languages_json).map((x) => String(x).toLowerCase()));
      const cs = safeParseArray<number>(js.assigned_courses_json)
        .map((x) => Number(x))
        .filter((n) => n >= 1 && n <= 4);
      setCourses(cs.length > 0 ? cs : [1, 2, 3, 4]);
      setSpecialtyCodes(safeParseArray<string>(js.assigned_specialties_json).map((x) => String(x)));
      setStudyYears(
        safeParseArray<number>(js.assigned_study_years_json)
          .map((x) => parseStudyDuration(x))
          .filter((n): n is number => n != null)
      );
      const parsedScopes = parseSchoolScopes((js as any).assigned_school_scopes_json ?? null);
      setSchoolScopes(parsedScopes);
      const firstSchool = safeParseArray<string>(js.assigned_schools_json)[0] || "";
      setScopeSchool(firstSchool);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (me) setManagerId(me.id);
    else setManagerId(null);
  }, [me, setManagerId]);

  const schoolSet = useMemo(() => new Set(schools), [schools]);
  const langSet = useMemo(() => new Set(langs), [langs]);
  const courseSet = useMemo(() => new Set(courses), [courses]);
  const specSet = useMemo(() => new Set(specialtyCodes), [specialtyCodes]);
  const studyYearSet = useMemo(() => new Set(studyYears), [studyYears]);
  const scopeSchoolValue = scopeSchool && schoolSet.has(scopeSchool) ? scopeSchool : schools[0] || "";
  const activeSchoolScope: SchoolScopeSettings = schoolScopes[scopeSchoolValue] ?? { langs: [], studyYears: [] };
  const activeScopeLangSet = useMemo(() => new Set(activeSchoolScope.langs), [activeSchoolScope.langs]);
  const activeScopeYearSet = useMemo(() => new Set(activeSchoolScope.studyYears), [activeSchoolScope.studyYears]);

  const specialtiesForSelectedSchools = useMemo(() => {
    const out: { code: string; label: string }[] = [];
    const seen = new Set<string>();
    for (const schoolName of schools) {
      const entry = SCHOOL_DATA[schoolName];
      if (!entry) continue;
      for (const sp of entry.specialties) {
        if (seen.has(sp.code)) continue;
        seen.add(sp.code);
        out.push({ code: sp.code, label: `${sp.name} (${sp.code})` });
      }
    }
    return out;
  }, [schools]);

  useEffect(() => {
    const valid = new Set(specialtiesForSelectedSchools.map((s) => s.code));
    setSpecialtyCodes((prev) => prev.filter((c) => valid.has(c)));
  }, [specialtiesForSelectedSchools]);

  const toggleSchool = (s: string) => {
    setSchools((prev) => {
      const next = prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s];
      if (next.length > 0 && !next.includes(scopeSchoolValue)) setScopeSchool(next[0] || "");
      if (next.length === 0) setScopeSchool("");
      return next;
    });
  };
  const toggleLang = (id: string) => {
    setLangs((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const toggleCourse = (n: number) => {
    setCourses((prev) => {
      const next = prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n].sort((a, b) => a - b);
      return next.length === 0 ? [1, 2, 3, 4] : next;
    });
  };

  const toggleSpecialty = (code: string) => {
    setSpecialtyCodes((prev) => (prev.includes(code) ? prev.filter((x) => x !== code) : [...prev, code].sort()));
  };
  const toggleStudyYear = (n: number) => {
    setStudyYears((prev) => (prev.includes(n) ? prev.filter((x) => x !== n) : [...prev, n].sort((a, b) => a - b)));
  };

  const toggleScopeLang = (langId: string) => {
    if (!scopeSchoolValue) return;
    setSchoolScopes((prev) => {
      const cur = prev[scopeSchoolValue] ?? { langs: [], studyYears: [] };
      const langs = cur.langs.includes(langId) ? cur.langs.filter((x) => x !== langId) : [...cur.langs, langId];
      return { ...prev, [scopeSchoolValue]: { ...cur, langs: langs.sort() } };
    });
  };
  const toggleScopeStudyYear = (n: number) => {
    if (!scopeSchoolValue) return;
    setSchoolScopes((prev) => {
      const cur = prev[scopeSchoolValue] ?? { langs: [], studyYears: [] };
      const years = cur.studyYears.includes(n) ? cur.studyYears.filter((x) => x !== n) : [...cur.studyYears, n].sort((a, b) => a - b);
      return { ...prev, [scopeSchoolValue]: { ...cur, studyYears: years } };
    });
  };
  const applyCurrentScopeToAllSchools = () => {
    if (!scopeSchoolValue || schools.length === 0) return;
    setSchoolScopes((prev) => {
      const cur = prev[scopeSchoolValue] ?? { langs: [], studyYears: [] };
      const next: Record<string, SchoolScopeSettings> = { ...prev };
      for (const s of schools) next[s] = { langs: [...cur.langs], studyYears: [...cur.studyYears] };
      return next;
    });
  };

  const save = async () => {
    setMsg("");
    if (schools.length === 0) {
      setMsg("Выберите хотя бы одну школу");
      return;
    }
    setSaving(true);
    const res = await fetchJSON("/api/managers/me/scope", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assigned_schools_json: schools,
        assigned_languages_json: langs,
        assigned_courses_json: courses,
        assigned_specialties_json: specialtyCodes,
        assigned_study_years_json: studyYears,
        assigned_school_scopes_json: Object.fromEntries(
          schools.map((s) => {
            const cfg = schoolScopes[s] ?? { langs: [], studyYears: [] };
            return [s, { langs: cfg.langs, studyYears: cfg.studyYears }];
          })
        ),
      }),
    });
    const js = await readJSON<any>(res);
    setSaving(false);
    if (!res.ok) {
      setMsg(js?.error || "Не сохранено");
      return;
    }
    const next = js as Advisor;
    setMe(next);
    setSpecialtyCodes(safeParseArray<string>(next.assigned_specialties_json).map((x) => String(x)));
    setStudyYears(
      safeParseArray<number>(next.assigned_study_years_json)
        .map((x) => parseStudyDuration(x))
        .filter((n): n is number => n != null)
    );
    setSchoolScopes(parseSchoolScopes((next as any).assigned_school_scopes_json ?? null));
    setMsg("Сохранено");
  };

  const changePassword = async () => {
    setPwMsg("");
    if (!pwCurrent || !pwNext) {
      setPwMsg("Укажите текущий и новый пароль");
      return;
    }
    if (!pwNext2) {
      setPwMsg("Повторите новый пароль");
      return;
    }
    if (pwNext !== pwNext2) {
      setPwMsg("Новый пароль и повтор не совпадают");
      return;
    }
    if (pwNext.length < 6) {
      setPwMsg("Новый пароль минимум 6 символов");
      return;
    }
    setPwSaving(true);
    const res = await fetchJSON("/api/managers/me/password", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: pwCurrent, newPassword: pwNext }),
    });
    const js = await readJSON<any>(res).catch(() => ({}));
    setPwSaving(false);
    if (!res.ok) {
      setPwMsg(js?.error || "Не удалось сменить пароль");
      return;
    }
    setPwCurrent("");
    setPwNext("");
    setPwNext2("");
    setPwMsg("Пароль обновлён");
  };

  if (loading) {
    return (
      <div className="ui-card p-7">
        <div className="text-lg font-black text-violet-950 dark:text-sky-100">Настройки приёма</div>
        <div className="mt-2 text-sm font-semibold text-violet-800 dark:text-sky-300">{t("loading")}</div>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="ui-card p-7">
        <div className="text-lg font-black text-violet-950 dark:text-sky-100">Настройки приёма</div>
        <div className="mt-2 text-sm font-semibold text-violet-800 dark:text-sky-300">Нет доступа. Войдите как менеджер.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => nav("/manager")}
        className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-white px-4 py-2.5 text-sm font-extrabold text-violet-900 shadow-sm transition hover:bg-violet-50 dark:border-white/10 dark:bg-slate-900 dark:text-sky-100 dark:hover:bg-white/5"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t("back")}
      </button>
      <div className="ui-card p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-12 shrink-0 items-center rounded-xl border border-violet-100 bg-violet-50/80 px-2 py-1 dark:border-white/10 dark:bg-white/5">
              <AppLogo className="h-10 w-auto max-w-[160px] object-contain" />
            </div>
            <div className="min-w-0">
            <div className="text-xs font-black uppercase tracking-widest text-violet-900 dark:text-sky-300">{t("receptionSettings")}</div>
            <div className="mt-1 text-xl font-black text-violet-950 dark:text-sky-100">{me.name}</div>
            <div className="mt-1 text-sm font-semibold text-violet-800 dark:text-sky-300">Здесь вы задаёте, каких студентов вы принимаете.</div>
            </div>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="ui-btn-primary px-5 py-3"
          >
            {saving ? t("loading") : t("save")}
          </button>
        </div>

        {msg && (
          <div className={cn("mt-4 text-sm font-bold", msg === "Сохранено" ? "text-emerald-700" : "text-red-700")}>{msg}</div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="ui-card p-6">
          <div className="text-[10px] font-black uppercase tracking-widest text-violet-900 dark:text-sky-300">Школы</div>
          <div className="mt-3 space-y-2">
            {SCHOOL_NAMES.map((s) => (
              <label key={s} className="ui-subcard flex cursor-pointer items-start gap-3 px-4 py-3">
                <input
                  type="checkbox"
                  checked={schoolSet.has(s)}
                  onChange={() => toggleSchool(s)}
                  className="mt-1 rounded border-violet-300 text-violet-600"
                />
                <span className="text-sm font-extrabold text-violet-950 dark:text-sky-100">{s}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div className="ui-card p-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-violet-900 dark:text-sky-300">Настройки по школам</div>
                <div className="mt-1 text-sm font-semibold text-violet-800 dark:text-sky-300">
                  Для каждой школы можно задать свои языки и тип обучения.
                </div>
              </div>
              <button type="button" onClick={applyCurrentScopeToAllSchools} className="ui-btn-ghost px-3 py-2 text-xs" disabled={!scopeSchoolValue}>
                Применить к выбранным школам
              </button>
            </div>
            <div className="mt-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-extrabold uppercase tracking-wide text-violet-700 dark:text-violet-300">Школа</span>
                <select
                  value={scopeSchoolValue}
                  onChange={(e) => setScopeSchool(e.target.value)}
                  className="ui-input"
                  disabled={schools.length === 0}
                >
                  {schools.length === 0 ? <option value="">Сначала отметьте школы слева</option> : null}
                  {schools.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-4">
              <div className="text-[10px] font-black uppercase tracking-widest text-violet-900 dark:text-sky-300">Языки для выбранной школы</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {LANGS.map((l) => (
                  <button
                    key={`scope-${l.id}`}
                    type="button"
                    onClick={() => toggleScopeLang(l.id)}
                    disabled={!scopeSchoolValue}
                    className={cn(
                      "rounded-2xl border-2 px-4 py-2.5 text-sm font-extrabold shadow-sm transition disabled:opacity-50",
                      activeScopeLangSet.has(l.id)
                        ? "border-emerald-400 bg-emerald-500 text-white"
                        : "border-violet-200 bg-white text-violet-950 hover:bg-violet-100 dark:border-slate-600 dark:bg-slate-800 dark:text-sky-100 dark:hover:bg-slate-700"
                    )}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-4">
              <div className="text-[10px] font-black uppercase tracking-widest text-violet-900 dark:text-sky-300">Тип обучения для выбранной школы</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {STUDY_DURATION_OPTIONS.map((opt) => (
                  <button
                    key={`scope-year-${opt.value}`}
                    type="button"
                    onClick={() => toggleScopeStudyYear(opt.value)}
                    disabled={!scopeSchoolValue}
                    className={cn(
                      "rounded-2xl border-2 px-4 py-2.5 text-sm font-extrabold shadow-sm transition disabled:opacity-50",
                      activeScopeYearSet.has(opt.value)
                        ? "border-emerald-400 bg-emerald-500 text-white"
                        : "border-violet-200 bg-white text-violet-950 hover:bg-violet-100 dark:border-slate-600 dark:bg-slate-800 dark:text-sky-100 dark:hover:bg-slate-700"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="ui-card p-6">
            <div className="text-[10px] font-black uppercase tracking-widest text-violet-900 dark:text-sky-300">Безопасность</div>
            <div className="mt-1 text-sm font-semibold text-violet-800 dark:text-sky-300">Смена пароля сотрудника</div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2 flex items-center justify-between gap-3">
                <div className="text-xs font-semibold text-violet-700 dark:text-sky-300">Минимум 6 символов</div>
                <button
                  type="button"
                  onClick={() => setPwShow((v) => !v)}
                  className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-white px-3 py-2 text-xs font-extrabold text-violet-900 shadow-sm transition hover:bg-violet-50 dark:border-white/10 dark:bg-slate-900 dark:text-sky-100 dark:hover:bg-white/5"
                >
                  {pwShow ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                  {pwShow ? "Скрыть" : "Показать"}
                </button>
              </div>

              <input
                type={pwShow ? "text" : "password"}
                className="ui-input"
                placeholder="Текущий пароль"
                value={pwCurrent}
                onChange={(e) => setPwCurrent(e.target.value)}
                autoComplete="current-password"
              />
              <input
                type={pwShow ? "text" : "password"}
                className="ui-input"
                placeholder="Новый пароль"
                value={pwNext}
                onChange={(e) => setPwNext(e.target.value)}
                autoComplete="new-password"
              />
              <input
                type={pwShow ? "text" : "password"}
                className="ui-input sm:col-span-2"
                placeholder="Повторите новый пароль"
                value={pwNext2}
                onChange={(e) => setPwNext2(e.target.value)}
                autoComplete="new-password"
              />
              <button
                type="button"
                disabled={pwSaving}
                onClick={() => void changePassword()}
                className="ui-btn-primary sm:col-span-2"
              >
                {pwSaving ? t("loading") : "Сменить пароль"}
              </button>
            </div>
            {pwMsg && (
              <div className={cn("mt-3 text-sm font-bold", pwMsg === "Пароль обновлён" ? "text-emerald-700" : "text-red-700")}>
                {pwMsg}
              </div>
            )}
          </div>

          <div className="ui-card p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-violet-900 dark:text-sky-300">Языки</div>
                <div className="mt-1 text-sm font-semibold text-violet-800 dark:text-sky-300">Если ничего не выбрано — любой язык.</div>
              </div>
              <button
                type="button"
                onClick={() => setLangs([])}
                className="ui-btn-ghost px-3 py-2 text-xs"
              >
                Сбросить
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {LANGS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => toggleLang(l.id)}
                  className={cn(
                    "rounded-2xl border-2 px-4 py-3 text-sm font-extrabold shadow-sm transition",
                    langSet.has(l.id)
                      ? "border-emerald-400 bg-emerald-500 text-white shadow-lg shadow-emerald-500/40 ring-2 ring-emerald-300/90 dark:border-emerald-300 dark:bg-emerald-500 dark:text-white dark:shadow-emerald-500/50 dark:ring-emerald-400"
                      : "border-violet-200 bg-white text-violet-950 hover:bg-violet-100 dark:border-slate-600 dark:bg-slate-800 dark:text-sky-100 dark:hover:bg-slate-700"
                  )}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          <div className="ui-card p-6">
            <div className="text-[10px] font-black uppercase tracking-widest text-violet-900 dark:text-sky-300">Курсы</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {[1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => toggleCourse(n)}
                  className={cn(
                    "rounded-2xl border-2 px-4 py-3 text-sm font-extrabold shadow-sm transition",
                    courseSet.has(n)
                      ? "border-emerald-400 bg-emerald-500 text-white shadow-lg shadow-emerald-500/40 ring-2 ring-emerald-300/90 dark:border-emerald-300 dark:bg-emerald-500 dark:text-white dark:shadow-emerald-500/50 dark:ring-emerald-400"
                      : "border-violet-200 bg-white text-violet-950 hover:bg-violet-100 dark:border-slate-600 dark:bg-slate-800 dark:text-sky-100 dark:hover:bg-slate-700"
                  )}
                >
                  {n} курс
                </button>
              ))}
            </div>
          </div>

          <div className="ui-card p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-violet-900 dark:text-sky-300">
                  ТиПО: срок обучения
                </div>
                <div className="mt-1 text-sm font-semibold text-violet-800 dark:text-sky-300">
                  Если ничего не выбрано — любой срок.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setStudyYears([])}
                className="ui-btn-ghost px-3 py-2 text-xs"
              >
                Любой
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {STUDY_DURATION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggleStudyYear(opt.value)}
                  className={cn(
                    "rounded-2xl border-2 px-4 py-3 text-sm font-extrabold shadow-sm transition",
                    studyYearSet.has(opt.value)
                      ? "border-emerald-400 bg-emerald-500 text-white shadow-lg shadow-emerald-500/40 ring-2 ring-emerald-300/90 dark:border-emerald-300 dark:bg-emerald-500 dark:text-white dark:shadow-emerald-500/50 dark:ring-emerald-400"
                      : "border-violet-200 bg-white text-violet-950 hover:bg-violet-100 dark:border-slate-600 dark:bg-slate-800 dark:text-sky-100 dark:hover:bg-slate-700"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="ui-card p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-violet-900 dark:text-sky-300">
                  {t("receptionSpecialtiesSection")}
                </div>
                <div className="mt-1 text-sm font-semibold text-violet-800 dark:text-sky-300">{t("receptionSpecialtiesHint")}</div>
              </div>
              <button type="button" onClick={() => setSpecialtyCodes([])} className="ui-btn-ghost px-3 py-2 text-xs">
                {t("receptionSpecialtiesAny")}
              </button>
            </div>
            {specialtiesForSelectedSchools.length === 0 ? (
              <div className="mt-3 text-sm font-semibold text-violet-600 dark:text-violet-400">{t("receptionSpecialtiesPickSchools")}</div>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                {specialtiesForSelectedSchools.map((sp) => (
                  <button
                    key={sp.code}
                    type="button"
                    onClick={() => toggleSpecialty(sp.code)}
                    className={cn(
                      "rounded-2xl border-2 px-3 py-2.5 text-left text-xs font-extrabold shadow-sm transition",
                      specSet.has(sp.code)
                        ? "border-emerald-400 bg-emerald-500 text-white shadow-lg shadow-emerald-500/40 ring-2 ring-emerald-300/90 dark:border-emerald-300 dark:bg-emerald-500 dark:text-white dark:shadow-emerald-500/50 dark:ring-emerald-400"
                        : "border-violet-200 bg-white text-violet-950 hover:bg-violet-100 dark:border-slate-600 dark:bg-slate-800 dark:text-sky-100 dark:hover:bg-slate-700"
                    )}
                  >
                    {sp.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

