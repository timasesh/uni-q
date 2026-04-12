import { useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { fetchJSON, readJSON } from "../api";
import type { Advisor } from "../types";
import { cn } from "../lib/cn";
import { useI18n } from "../i18n";
import { useAdvisorContext } from "../context/AdvisorContext";
import { hydrateAdvisorWorkedFromServer } from "../lib/advisorWorkSync";
import { SCHOOL_DATA, SCHOOL_NAMES } from "../schools";

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

export default function AdvisorSettingsPage() {
  const { t } = useI18n();
  const nav = useNavigate();
  const { setAdvisorId } = useAdvisorContext();
  const [me, setMe] = useState<Advisor | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const [schools, setSchools] = useState<string[]>([]);
  const [langs, setLangs] = useState<string[]>([]);
  const [courses, setCourses] = useState<number[]>([1, 2, 3, 4]);
  const [specialtyCodes, setSpecialtyCodes] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const res = await fetchJSON("/api/advisors/me");
      if (!res.ok) {
        setMe(null);
        setLoading(false);
        return;
      }
      const js = await readJSON<Advisor>(res);
      hydrateAdvisorWorkedFromServer(js.id, Number(js.total_work_ms) || 0);
      setMe(js);
      setSchools(safeParseArray<string>(js.assigned_schools_json));
      setLangs(safeParseArray<string>(js.assigned_languages_json).map((x) => String(x).toLowerCase()));
      const cs = safeParseArray<number>(js.assigned_courses_json)
        .map((x) => Number(x))
        .filter((n) => n >= 1 && n <= 4);
      setCourses(cs.length > 0 ? cs : [1, 2, 3, 4]);
      setSpecialtyCodes(safeParseArray<string>(js.assigned_specialties_json).map((x) => String(x)));
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (me) setAdvisorId(me.id);
    else setAdvisorId(null);
  }, [me, setAdvisorId]);

  const schoolSet = useMemo(() => new Set(schools), [schools]);
  const langSet = useMemo(() => new Set(langs), [langs]);
  const courseSet = useMemo(() => new Set(courses), [courses]);
  const specSet = useMemo(() => new Set(specialtyCodes), [specialtyCodes]);

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
    setSchools((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
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

  const save = async () => {
    setMsg("");
    if (schools.length === 0) {
      setMsg("Выберите хотя бы одну школу");
      return;
    }
    setSaving(true);
    const res = await fetchJSON("/api/advisors/me/scope", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assigned_schools_json: schools,
        assigned_languages_json: langs,
        assigned_courses_json: courses,
        assigned_specialties_json: specialtyCodes,
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
    setMsg("Сохранено");
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
        <div className="mt-2 text-sm font-semibold text-violet-800 dark:text-sky-300">Нет доступа. Войдите как эдвайзер.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => nav("/advisor")}
        className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-white px-4 py-2.5 text-sm font-extrabold text-violet-900 shadow-sm transition hover:bg-violet-50 dark:border-white/10 dark:bg-slate-900 dark:text-sky-100 dark:hover:bg-white/5"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t("back")}
      </button>
      <div className="ui-card p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-widest text-violet-900 dark:text-sky-300">{t("receptionSettings")}</div>
            <div className="mt-1 text-xl font-black text-violet-950 dark:text-sky-100">{me.name}</div>
            <div className="mt-1 text-sm font-semibold text-violet-800 dark:text-sky-300">Здесь вы задаёте, каких студентов вы принимаете.</div>
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

