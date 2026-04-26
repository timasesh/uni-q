import type { Advisor } from "../types";
import type { Lang } from "../i18n";

function safeParseArray<T = unknown>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

const LANG_SHORT: Record<Lang, Record<string, string>> = {
  rus: { ru: "Рус", kz: "Каз", en: "Анг" },
  eng: { ru: "Ru", kz: "Kz", en: "En" },
  kaz: { ru: "Орыс", kz: "Қазақ", en: "Ағыл." },
};

function anyLanguageLabel(lang: Lang): string {
  if (lang === "eng") return "Any language";
  if (lang === "kaz") return "Кез келген тіл";
  return "Любой язык";
}

function allSpecialtiesLabel(lang: Lang): string {
  if (lang === "eng") return "All specialties";
  if (lang === "kaz") return "Барлық мамандықтар";
  return "Все специальности";
}

function windowLabel(lang: Lang, desk: string): string {
  if (lang === "eng") return `Window ${desk}`;
  if (lang === "kaz") return `Терезе ${desk}`;
  return `Окно ${desk}`;
}

function coursesLabel(lang: Lang, courses: number[]): string {
  const allDefault = courses.length === 4 && courses.every((n, i) => n === i + 1);
  if (allDefault) {
    if (lang === "eng") return "Courses 1–4";
    if (lang === "kaz") return "1–4 курс";
    return "Курсы 1–4";
  }
  const list = courses.join(", ");
  if (lang === "eng") return `Courses: ${list}`;
  if (lang === "kaz") return `Курстар: ${list}`;
  return `Курсы: ${list}`;
}

export type AdvisorReceptionSummary = {
  /** Выбранные школы (как в настройках приёма) */
  schoolsLine: string;
  /** Языки, курсы, специальности, окно — в одну строку */
  scopeLine: string;
};

/** Текст шапки менеджера из `assigned_*_json` (как на странице настроек приёма). */
export function formatAdvisorReceptionSummary(me: Advisor, lang: Lang): AdvisorReceptionSummary {
  const L = LANG_SHORT[lang];
  const schools = safeParseArray<string>(me.assigned_schools_json).map(String);
  const langs = safeParseArray<string>(me.assigned_languages_json).map((x) => String(x).toLowerCase());
  let courses = safeParseArray<number>(me.assigned_courses_json)
    .map((x) => Number(x))
    .filter((n) => n >= 1 && n <= 4);
  if (courses.length === 0) courses = [1, 2, 3, 4];
  const specs = safeParseArray<string>(me.assigned_specialties_json).map(String);
  const studyYears = safeParseArray<number>(me.assigned_study_years_json)
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 8);

  const sep = lang === "eng" ? ", " : " · ";
  const schoolsLine = schools.length > 0 ? schools.join(sep) : "—";

  const langPart =
    langs.length === 0 ? anyLanguageLabel(lang) : langs.map((id) => L[id] || id).join(", ");

  const coursePart = coursesLabel(lang, courses);

  let specPart: string;
  if (specs.length === 0) specPart = allSpecialtiesLabel(lang);
  else if (specs.length <= 4) specPart = specs.join(", ");
  else {
    if (lang === "eng") specPart = `${specs.length} specialties`;
    else if (lang === "kaz") specPart = `${specs.length} мамандық`;
    else specPart = `${specs.length} специальностей`;
  }

  const desk = String(me.desk_number || "").trim();
  const deskPart = desk ? windowLabel(lang, desk) : "";
  let yearsPart = "";
  if (studyYears.length > 0) {
    const list = studyYears.sort((a, b) => a - b).join(", ");
    if (lang === "eng") yearsPart = `Study years: ${list}`;
    else if (lang === "kaz") yearsPart = `Оқу мерзімі: ${list}`;
    else yearsPart = `Срок обучения: ${list}`;
  }

  const scopeLine = [langPart, coursePart, yearsPart, specPart, deskPart].filter(Boolean).join(" · ");

  return { schoolsLine, scopeLine };
}
