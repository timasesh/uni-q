export const STUDY_DURATION_OPTIONS = [
  { value: 2, label: "ТИПО (2 года)" },
  { value: 4, label: "Бакалавриат" },
  { value: 6, label: "Магистратура" },
  { value: 8, label: "Доктарантура" },
  { value: 99, label: "Другое" },
] as const;

export type StudyDurationValue = (typeof STUDY_DURATION_OPTIONS)[number]["value"];

const LABEL_BY_VALUE = new Map<number, string>(STUDY_DURATION_OPTIONS.map((o) => [o.value, o.label]));

export function parseStudyDuration(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return LABEL_BY_VALUE.has(i) ? i : null;
}

export function formatStudyDuration(value: unknown): string {
  const parsed = parseStudyDuration(value);
  if (parsed == null) return "—";
  return LABEL_BY_VALUE.get(parsed) || "—";
}
