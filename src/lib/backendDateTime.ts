/**
 * Даты из SQLite (CURRENT_TIMESTAMP и поля талонов без суффикса) хранятся как UTC в виде «YYYY-MM-DD HH:MM:SS».
 * Без явного Z/офсета `new Date(...)` в браузере часто читается как *локальное* время → смещение на часовой пояс (напр. −5 ч для UTC+5).
 * Явный ISO с Z или с офсетом парсим как обычно.
 */
export function parseBackendDateTime(raw: string | null | undefined): Date | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/[zZ]$|[+-]\d{2}:\d{2}$|[+-]\d{4}$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const naiveUtc = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/;
  if (naiveUtc.test(s)) {
    const d = new Date(s.replace(" ", "T") + "Z");
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function backendInstantMs(raw: unknown): number | null {
  if (raw == null) return null;
  const d = parseBackendDateTime(String(raw));
  return d ? d.getTime() : null;
}
