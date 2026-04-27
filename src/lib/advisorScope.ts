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
  const schools = safeParseArray<string>(me.assigned_schools_json).map(String);
  const langsRaw = safeParseArray<string>(me.assigned_languages_json).map((x) => String(x).toLowerCase());
  const coursesRaw = safeParseArray<number>(me.assigned_courses_json)
    .map((x) => Number(x))
    .filter((n) => n >= 1 && n <= 4);
  const specsRaw = safeParseArray<string>(me.assigned_specialties_json).map(String);
  const yearsRaw = safeParseArray<number>(me.assigned_study_years_json)
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 8);

  // schools: empty means "any" (but UI usually enforces at least one school)
  if (schools.length > 0) {
    const allowed = new Set(schools.map(normSchool));
    const school = normSchool(ticket.school);
    if (!school || !allowed.has(school)) return false;
  }
  // langs: empty means any
  if (langsRaw.length > 0) {
    const lang = String(ticket.language_section || "").toLowerCase();
    if (!lang) return false;
    if (!langsRaw.includes(lang) && !langsRaw.includes("any")) return false;
  }
  // courses: empty means 1–4
  const courses = coursesRaw.length > 0 ? coursesRaw : [1, 2, 3, 4];
  const cn = parseCourse(ticket.course);
  if (cn == null || !courses.includes(cn)) return false;

  // specs: empty means any
  if (specsRaw.length > 0) {
    const code = String(ticket.specialty_code || "");
    if (!code || !specsRaw.includes(code)) return false;
  }

  // TiPO years: empty means any
  if (yearsRaw.length > 0) {
    const dur = Number((ticket as any).study_duration_years);
    if (!Number.isFinite(dur) || !yearsRaw.includes(dur)) return false;
  }
  return true;
}
