import { parseBackendDateTime } from "./backendDateTime";

/** Можно ли вызывать студента сейчас с учётом брони (null/пусто = без ограничения). */
export function bookingCallableNow(
  preferred_slot_at: string | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (preferred_slot_at == null) return true;
  const raw = String(preferred_slot_at).trim();
  if (raw === "") return true;
  const d = parseBackendDateTime(raw);
  if (!d) return false;
  return d.getTime() <= nowMs;
}
