import { fetchJSON } from "../api";

export function advisorWorkStorageKeys(advisorId: number) {
  return {
    worked: `uniq.advisor.workedMs.${advisorId}`,
    segment: `uniq.advisor.workSegmentStart.${advisorId}`,
  };
}

function todayDateKeyLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ensureTodayBucket(advisorId: number): void {
  const dk = `uniq.advisor.workTodayDate.${advisorId}`;
  const mk = `uniq.advisor.workTodayMs.${advisorId}`;
  const today = todayDateKeyLocal();
  if (localStorage.getItem(dk) !== today) {
    localStorage.setItem(dk, today);
    localStorage.setItem(mk, "0");
  }
}

/** Накоплено за текущий календарный день (локально), включая открытый сегмент приёма. */
export function getTodayWorkedMsSnapshot(advisorId: number): number {
  ensureTodayBucket(advisorId);
  const mk = `uniq.advisor.workTodayMs.${advisorId}`;
  let base = Number(localStorage.getItem(mk)) || 0;
  const { segment: sk } = advisorWorkStorageKeys(advisorId);
  const seg = localStorage.getItem(sk);
  if (seg) {
    const add = Date.now() - Number(seg);
    if (Number.isFinite(add) && add > 0) base += add;
  }
  return Math.floor(base);
}

/** Учесть закрытый интервал приёма в «сегодня» (локально). */
export function bumpTodayWorkedMs(advisorId: number, deltaMs: number): void {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
  ensureTodayBucket(advisorId);
  const mk = `uniq.advisor.workTodayMs.${advisorId}`;
  const cur = Number(localStorage.getItem(mk)) || 0;
  localStorage.setItem(mk, String(cur + Math.floor(deltaMs)));
}

/** Текущий накопленный интервал: сохранённые ms + незакрытый сегмент (если есть). */
export function getAdvisorWorkedMsSnapshot(advisorId: number): number {
  const { worked: wk, segment: sk } = advisorWorkStorageKeys(advisorId);
  const worked = Number(localStorage.getItem(wk)) || 0;
  const seg = localStorage.getItem(sk);
  if (!seg) return worked;
  const add = Date.now() - Number(seg);
  if (!Number.isFinite(add) || add < 0) return worked;
  return worked + add;
}

/** Вносит открытый сегмент в базовое значение в localStorage (как при паузе). Возвращает итог. */
export function mergeOpenWorkSegmentIntoStorage(advisorId: number): number {
  const { worked: wk, segment: sk } = advisorWorkStorageKeys(advisorId);
  const worked = Number(localStorage.getItem(wk)) || 0;
  const seg = localStorage.getItem(sk);
  if (!seg) return worked;
  const add = Date.now() - Number(seg);
  const extra = Number.isFinite(add) && add > 0 ? add : 0;
  const total = worked + extra;
  localStorage.setItem(wk, String(total));
  bumpTodayWorkedMs(advisorId, extra);
  localStorage.removeItem(sk);
  return total;
}

/** Сохраняет накопленное время в БД пока сессия эдвайзера ещё действует (перед выходом и т.п.). */
export async function syncAdvisorWorkTotalToServer(advisorId: number): Promise<boolean> {
  const totalMs = mergeOpenWorkSegmentIntoStorage(advisorId);
  const todayMs = getTodayWorkedMsSnapshot(advisorId);
  const res = await fetchJSON("/api/advisors/me/work-total", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ totalMs: Math.floor(totalMs), todayMs }),
  });
  return res.ok;
}

/** Подтянуть серверное время в localStorage, если в БД больше (другой браузер / после сброса кэша). */
export function hydrateAdvisorWorkedFromServer(advisorId: number, serverTotalMs: number): void {
  if (!Number.isFinite(serverTotalMs) || serverTotalMs < 0) return;
  const { worked: wk } = advisorWorkStorageKeys(advisorId);
  const local = Number(localStorage.getItem(wk)) || 0;
  if (serverTotalMs > local) localStorage.setItem(wk, String(Math.floor(serverTotalMs)));
}
