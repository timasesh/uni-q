import { fetchJSON } from "../api";

export function managerWorkStorageKeys(managerId: number) {
  return {
    worked: `uniq.manager.workedMs.${managerId}`,
    segment: `uniq.manager.workSegmentStart.${managerId}`,
  };
}

function ensureTodayBucket(managerId: number): void {
  const dk = `uniq.manager.workTodayDate.${managerId}`;
  const mk = `uniq.manager.workTodayMs.${managerId}`;
  const today = todayDateKeyLocal();
  if (localStorage.getItem(dk) !== today) {
    localStorage.setItem(dk, today);
    localStorage.setItem(mk, "0");
  }
}

function todayDateKeyLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Накоплено за текущий календарный день (локально), включая открытый сегмент приёма. */
export function getTodayWorkedMsSnapshot(managerId: number): number {
  ensureTodayBucket(managerId);
  const mk = `uniq.manager.workTodayMs.${managerId}`;
  let base = Number(localStorage.getItem(mk)) || 0;
  const { segment: sk } = managerWorkStorageKeys(managerId);
  const seg = localStorage.getItem(sk);
  if (seg) {
    const add = Date.now() - Number(seg);
    if (Number.isFinite(add) && add > 0) base += add;
  }
  return Math.floor(base);
}

/** Учесть закрытый интервал приёма в «сегодня» (локально). */
export function bumpTodayWorkedMs(managerId: number, deltaMs: number): void {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
  ensureTodayBucket(managerId);
  const mk = `uniq.manager.workTodayMs.${managerId}`;
  const cur = Number(localStorage.getItem(mk)) || 0;
  localStorage.setItem(mk, String(cur + Math.floor(deltaMs)));
}

export function getTodayWorkDayKey(managerId: number): string {
  ensureTodayBucket(managerId);
  const dk = `uniq.manager.workTodayDate.${managerId}`;
  return localStorage.getItem(dk) || todayDateKeyLocal();
}

/** Текущий накопленный интервал: сохранённые ms + незакрытый сегмент (если есть). */
export function getManagerWorkedMsSnapshot(managerId: number): number {
  const { worked: wk, segment: sk } = managerWorkStorageKeys(managerId);
  const worked = Number(localStorage.getItem(wk)) || 0;
  const seg = localStorage.getItem(sk);
  if (!seg) return worked;
  const add = Date.now() - Number(seg);
  if (!Number.isFinite(add) || add < 0) return worked;
  return worked + add;
}

/** Вносит открытый сегмент в базовое значение в localStorage (как при паузе). Возвращает итог. */
export function mergeOpenWorkSegmentIntoStorage(managerId: number): number {
  const { worked: wk, segment: sk } = managerWorkStorageKeys(managerId);
  const worked = Number(localStorage.getItem(wk)) || 0;
  const seg = localStorage.getItem(sk);
  if (!seg) return worked;
  const add = Date.now() - Number(seg);
  const extra = Number.isFinite(add) && add > 0 ? add : 0;
  const total = worked + extra;
  localStorage.setItem(wk, String(total));
  bumpTodayWorkedMs(managerId, extra);
  localStorage.removeItem(sk);
  return total;
}

/** Сохраняет накопленное время в БД пока сессия менеджера ещё действует (перед выходом и т.п.). */
export async function syncManagerWorkTotalToServer(managerId: number): Promise<boolean> {
  const totalMs = mergeOpenWorkSegmentIntoStorage(managerId);
  const todayMs = getTodayWorkedMsSnapshot(managerId);
  const day = getTodayWorkDayKey(managerId);
  const res = await fetchJSON("/api/managers/me/work-total", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ totalMs: Math.floor(totalMs), todayMs, day }),
  });
  return res.ok;
}

/** Синхронизация без закрытия текущего сегмента (подходит для фоновых таймеров). */
export async function syncManagerWorkSnapshotToServer(managerId: number): Promise<boolean> {
  const totalMs = getManagerWorkedMsSnapshot(managerId);
  const todayMs = getTodayWorkedMsSnapshot(managerId);
  const day = getTodayWorkDayKey(managerId);
  const res = await fetchJSON("/api/managers/me/work-total", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ totalMs: Math.floor(totalMs), todayMs, day }),
  });
  return res.ok;
}

/**
 * Источник правды — значение на аккаунте (БД). Подменяет локальный «накопленный» тотал,
 * чтобы не расходиться с сервером после другого устройства или сброса кэша.
 */
export function hydrateManagerWorkedFromServer(managerId: number, serverTotalMs: number): void {
  if (!Number.isFinite(serverTotalMs) || serverTotalMs < 0) return;
  const { worked: wk } = managerWorkStorageKeys(managerId);
  localStorage.setItem(wk, String(Math.floor(serverTotalMs)));
}
