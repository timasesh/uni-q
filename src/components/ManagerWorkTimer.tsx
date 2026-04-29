import { useEffect, useRef, useState } from "react";
import { fetchJSON, readJSON } from "../api";
import {
  bumpTodayWorkedMs,
  getManagerWorkedMsSnapshot,
  hydrateManagerWorkedFromServer,
  managerWorkStorageKeys,
  syncManagerWorkSnapshotToServer,
} from "../lib/advisorWorkSync";

function formatWorkHm(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

type Props = {
  managerId: number;
  hidden?: boolean;
};

function makeTabId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function lockKeys(managerId: number) {
  return {
    lock: `uniq.manager.workLock.${managerId}`,
  };
}

function tryAcquireWorkLock(managerId: number, tabId: string, ttlMs = 12_000): boolean {
  const { lock } = lockKeys(managerId);
  const now = Date.now();
  const next = { tabId, exp: now + ttlMs };
  try {
    const raw = localStorage.getItem(lock);
    if (raw) {
      const cur = JSON.parse(raw) as any;
      if (cur && typeof cur === "object") {
        const curTab = String(cur.tabId || "");
        const curExp = Number(cur.exp || 0);
        if (curTab && Number.isFinite(curExp) && curExp > now && curTab !== tabId) {
          return false;
        }
      }
    }
  } catch {
    // ignore
  }
  localStorage.setItem(lock, JSON.stringify(next));
  return true;
}

export default function ManagerWorkTimer({ managerId, hidden = false }: Props) {
  const [sessionActive, setSessionActive] = useState(false);
  const [isLeader, setIsLeader] = useState(true);
  const [serverWorked, setServerWorked] = useState(0);
  const [, setTick] = useState(0);
  const prevActiveRef = useRef<boolean | null>(null);
  const tabIdRef = useRef<string>(makeTabId());

  useEffect(() => {
    prevActiveRef.current = null;
  }, [managerId]);

  useEffect(() => {
    const id = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const tabId = tabIdRef.current;
    const ping = () => {
      const ok = tryAcquireWorkLock(managerId, tabId);
      setIsLeader(ok);
    };
    ping();
    const id = window.setInterval(ping, 4000);
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (e.key === lockKeys(managerId).lock) ping();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      clearInterval(id);
      window.removeEventListener("storage", onStorage);
    };
  }, [managerId]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const res = await fetchJSON("/api/managers/me");
      if (!res.ok || cancelled) return;
      const js = await readJSON<{ reception_open?: number | boolean; total_work_ms?: number }>(res);
      const open = !(js?.reception_open === false || js?.reception_open === 0);
      const serverTotal = Number(js?.total_work_ms) || 0;
      setServerWorked(serverTotal);
      const { worked: wk } = managerWorkStorageKeys(managerId);
      const localBase = Number(localStorage.getItem(wk)) || 0;
      if (serverTotal > localBase) {
        hydrateManagerWorkedFromServer(managerId, serverTotal);
      }
      setSessionActive(open);
    };
    void poll();
    const pi = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(pi);
    };
  }, [managerId]);

  useEffect(() => {
    if (!isLeader) return;
    const { worked: WORK_KEY, segment: SEG_KEY } = managerWorkStorageKeys(managerId);
    const p = prevActiveRef.current;

    if (p === null) {
      prevActiveRef.current = sessionActive;
      if (sessionActive && !localStorage.getItem(SEG_KEY)) {
        localStorage.setItem(SEG_KEY, String(Date.now()));
      }
      return;
    }

    if (p !== sessionActive) {
      if (p && !sessionActive) {
        const seg = localStorage.getItem(SEG_KEY);
        if (seg) {
          const add = Date.now() - Number(seg);
          const extra = Number.isFinite(add) && add > 0 ? add : 0;
          const total = Number(localStorage.getItem(WORK_KEY)) || 0;
          localStorage.setItem(WORK_KEY, String(total + extra));
          bumpTodayWorkedMs(managerId, extra);
          localStorage.removeItem(SEG_KEY);
        }
      } else if (!p && sessionActive) {
        localStorage.setItem(SEG_KEY, String(Date.now()));
      }
      prevActiveRef.current = sessionActive;
    }
  }, [sessionActive, managerId, isLeader]);

  const { worked: WORK_KEY, segment: SEG_KEY } = managerWorkStorageKeys(managerId);
  const worked = Number(localStorage.getItem(WORK_KEY)) || 0;
  const seg = localStorage.getItem(SEG_KEY);
  const extra = sessionActive && seg ? Date.now() - Number(seg) : 0;

  const totalRef = useRef(0);
  totalRef.current = getManagerWorkedMsSnapshot(managerId);

  useEffect(() => {
    if (!isLeader) return;
    const sync = async () => {
      await syncManagerWorkSnapshotToServer(managerId);
    };
    const id = window.setInterval(() => void sync(), 20_000);
    return () => clearInterval(id);
  }, [managerId, isLeader]);

  useEffect(() => {
    if (!isLeader) return;
    const onVisibility = () => {
      if (!document.hidden) return;
      void syncManagerWorkSnapshotToServer(managerId);
    };
    const onPageHide = () => {
      void syncManagerWorkSnapshotToServer(managerId);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [managerId, isLeader]);

  const shownMs = isLeader ? worked + extra : serverWorked;

  if (hidden) return null;

  return (
    <span className="rounded-lg bg-white/10 px-2 py-1 font-mono text-sm font-black tabular-nums text-white ring-1 ring-white/20">
      {formatWorkHm(shownMs)}
    </span>
  );
}
