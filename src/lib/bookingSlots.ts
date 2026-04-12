/** Рабочие слоты на сегодня: с 9:00 до 17:30 с шагом 30 мин (последний слот 17:30). */
const START_H = 9;
const END_H = 18;

export function allHalfHourSlotLabels(): string[] {
  const out: string[] = [];
  for (let h = START_H; h < END_H; h++) {
    out.push(`${String(h).padStart(2, "0")}:00`);
    out.push(`${String(h).padStart(2, "0")}:30`);
  }
  return out;
}

/** Слоты строго позже now + leadMs (только сегодня, локальное время клиента). */
export function availableSlotLabelsForToday(now: Date, leadMs = 60_000): string[] {
  return allHalfHourSlotLabels().filter((hm) => {
    const [hh, mm] = hm.split(":").map(Number);
    const slot = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
    return slot.getTime() > now.getTime() + leadMs;
  });
}

export function isoFromLocalTodayHM(now: Date, hm: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
  return d.toISOString();
}
