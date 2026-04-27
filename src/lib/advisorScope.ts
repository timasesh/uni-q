import type { Advisor, Ticket } from "../types";

/**
 * Видимость талона для менеджера в live-очереди.
 * WAITING: у всех менеджеров, чья зона приёма совпадает (может отображаться у нескольких).
 * CALLED / IN_SERVICE: только у менеджера, который вызвал.
 */
export function ticketMatchesAdvisor(me: Advisor, ticket: Ticket): boolean {
  if (ticket.status === "CALLED" || ticket.status === "IN_SERVICE") {
    return Number(ticket.advisor_id) === Number(me.id);
  }
  if (ticket.status === "WAITING") {
    return ticketMatchesAdvisorScope(me, ticket);
  }
  return false;
}

function safeParseArray<T = unknown>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

function normSchool(s: unknown) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function parseCourse(course: string | null | undefined): number | null {
  if (!course) return null;
  const m = String(course).match(/\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

export function ticketMatchesAdvisorScope(me: Advisor, ticket: Ticket): boolean {
  let schools: string[] = [];
  let langs: string[] | null = null;
  let courses: number[] = [1, 2, 3, 4];
  let specs: string[] | null = null;
  let studyYears: number[] | null = null;
  try {
    schools = safeParseArray<string>(me.assigned_schools_json).map(String);
  } catch {
    schools = [];
  }
  try {
    const j = safeParseArray<string>(me.assigned_languages_json);
    if (j.length > 0) langs = j.map((x) => String(x).toLowerCase());
  } catch {
    langs = null;
  }
  try {
    const c = safeParseArray<number>(me.assigned_courses_json);
    if (c.length > 0) courses = c.map((x) => Number(x)).filter((n) => n >= 1 && n <= 4);
  } catch {
    courses = [1, 2, 3, 4];
  }
  try {
    const s = safeParseArray<string>(me.assigned_specialties_json);
    if (s.length > 0) specs = s.map((x) => String(x));
  } catch {
    specs = null;
  }
  try {
    const y = safeParseArray<number>(me.assigned_study_years_json);
    if (y.length > 0) {
      const ys = y.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n >= 1 && n <= 8);
      if (ys.length > 0) studyYears = ys;
    }
  } catch {
    studyYears = null;
  }

  if (schools.length > 0) {
    const allowed = new Set(schools.map(normSchool));
    const school = normSchool((ticket as any).school || (ticket as any).faculty || (ticket as any).advisor_faculty);
    if (!school || !allowed.has(school)) return false;
  }

  if (langs && langs.length > 0) {
    const lang = String(ticket.language_section || "").toLowerCase();
    if (!langs.includes(lang) && !langs.includes("any")) return false;
  }

  const cn = parseCourse(ticket.course);
  if (cn == null || !courses.includes(cn)) return false;

  if (specs && specs.length > 0) {
    const code = String(ticket.specialty_code || "");
    if (!code || !specs.includes(code)) return false;
  }

  if (studyYears && studyYears.length > 0) {
    const dur = Number((ticket as any).study_duration_years);
    if (!Number.isFinite(dur) || !studyYears.includes(dur)) return false;
  }
  return true;
}
