import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { fetchJSON, readJSON } from "../api";
import type { Ticket } from "../types";

export default function FlappyBirdPage() {
  const nav = useNavigate();

  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      const raw = localStorage.getItem("uniq.ticketId");
      const ticketId = raw ? Number(raw) : NaN;
      if (!Number.isFinite(ticketId)) return;

      const res = await fetchJSON(`/api/tickets/${ticketId}/status`);
      if (!res.ok) return;
      const t = await readJSON<Ticket>(res);
      if (stopped) return;
      if (t?.status === "CALLED" || t?.status === "IN_SERVICE") {
        nav("/student");
      }
    };

    void poll();
    const id = window.setInterval(() => void poll(), 2500);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [nav]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-xl border border-violet-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-slate-900">
        <div className="text-sm font-extrabold text-violet-900 dark:text-sky-100">Мини-игра</div>
        <button
          type="button"
          onClick={() => nav("/student")}
          className="rounded-lg border border-violet-200 px-3 py-1.5 text-xs font-extrabold text-violet-900 hover:bg-violet-50 dark:border-white/15 dark:text-sky-100 dark:hover:bg-white/10"
        >
          Назад к талону
        </button>
      </div>
      <div className="overflow-hidden rounded-2xl border border-violet-200 bg-black dark:border-white/10">
        <iframe
          src="/flappy-bird/"
          title="Flappy Bird"
          className="h-[78vh] min-h-[560px] w-full"
        />
      </div>
    </div>
  );
}
