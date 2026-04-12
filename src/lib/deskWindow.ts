/** Сколько окон поддерживает схема (`/scheme/1.webp` …). */
export const SCHEME_WINDOW_COUNT = 5;

/** Из поля окна менеджера (например «1», «Окно 2») — номер 1…5 для схемы. */
export function parseDeskWindowNumber(desk: string | null | undefined): number | null {
  if (desk == null) return null;
  const m = String(desk).match(/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  if (n < 1 || n > 5) return null;
  return n;
}

/** Общая схема кабинета до вызова к окну. */
export function schemeImagePathGeneral(): string {
  return "/scheme/scheme.webp";
}

export function schemeImagePathForWindow(n: number): string {
  return `/scheme/${n}.webp`;
}
