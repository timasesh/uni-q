/** Сколько окон поддерживает схема (`/scheme/1.webp` …). */
export const SCHEME_WINDOW_COUNT = 6;

/** Из поля окна менеджера (например «1», «Окно 2») — номер 1…6 для схемы. */
export function parseDeskWindowNumber(desk: string | null | undefined): number | null {
  if (desk == null) return null;
  const m = String(desk).match(/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  if (n < 1 || n > 6) return null;
  return n;
}

/** Общая схема кабинета до вызова к окну. */
export function schemeImagePathGeneral(): string {
  return "/scheme/0.webp";
}

export function schemeImagePathForWindow(n: number): string {
  return `/scheme/${n}.webp`;
}

export function schemeImagePathsGeneral(): { webp: string; png: string } {
  return { webp: "/scheme/0.webp", png: "/scheme/0.png" };
}

export function schemeImagePathsForWindow(n: number): { webp: string; png: string } {
  return { webp: `/scheme/${n}.webp`, png: `/scheme/${n}.png` };
}
