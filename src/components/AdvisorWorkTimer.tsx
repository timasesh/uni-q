import { useEffect, useRef, useState } from "react";
import { fetchJSON, readJSON } from "../api";
import {
  advisorWorkStorageKeys,
  bumpTodayWorkedMs,
  getAdvisorWorkedMsSnapshot,
  getTodayWorkedMsSnapshot,
} from "../lib/advisorWorkSync";

function formatWorkHm(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

type Props = { advisorId: number };

export default function AdvisorWorkTimer({ advisorId }: Props) {
  const [sessionActive, setSessionActive] = useState(false);
  const [, setTick] = useState(0);
  const prevActiveRef = useRef<boolean | null>(null);

  useEffect(() => {
    prevActiveRef.current = null;
  }, [advisorId]);

  useEffect(() => {
    const id = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const res = await fetchJSON("/api/advisors/me");
      if (!res.ok || cancelled) return;
      const js = await readJSON<{ reception_open?: number | boolean }>(res);
      const open = !(js?.reception_open === false || js?.reception_open === 0);
      setSessionActive(open);
    };
    void poll();
    const pi = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(pi);
    };
  }, []);

  useEffect(() => {
    const { worked: WORK_KEY, segment: SEG_KEY } = advisorWorkStorageKeys(advisorId);
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
          bumpTodayWorkedMs(advisorId, extra);
          localStorage.removeItem(SEG_KEY);
        }
      } else if (!p && sessionActive) {
        localStorage.setItem(SEG_KEY, String(Date.now()));
      }
      prevActiveRef.current = sessionActive;
    }
  }, [sessionActive, advisorId]);

  const { worked: WORK_KEY, segment: SEG_KEY } = advisorWorkStorageKeys(advisorId);
  const worked = Number(localStorage.getItem(WORK_KEY)) || 0;
  const seg = localStorage.getItem(SEG_KEY);
  const extra = sessionActive && seg ? Date.now() - Number(seg) : 0;

  const totalRef = useRef(0);
  totalRef.current = getAdvisorWorkedMsSnapshot(advisorId);

  useEffect(() => {
    const sync = async () => {
      await fetchJSON("/api/advisors/me/work-total", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          totalMs: Math.floor(totalRef.current),
          todayMs: getTodayWorkedMsSnapshot(advisorId),
        }),
      });
    };
    const id = window.setInterval(() => void sync(), 20_000);
    return () => clearInterval(id);
  }, [advisorId]);

  return (
    <span className="rounded-lg bg-white/10 px-2 py-1 font-mono text-sm font-black tabular-nums text-white ring-1 ring-white/20">
      {formatWorkHm(worked + extra)}
    </span>
  );
}
