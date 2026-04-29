import { useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { CheckCircle2, History, LogOut, Settings, UserCheck, X, XCircle } from "lucide-react";
import { fetchJSON, readJSON } from "../api";
import type { Advisor, LiveQueue, Ticket } from "../types";
import { cn } from "../lib/cn";
import { useLocation, useNavigate } from "react-router-dom";
import { useI18n } from "../i18n";
import { useManagerContext } from "../context/ManagerContext";
import { ticketMatchesAdvisor } from "../lib/advisorScope";
import { bookingCallableNow } from "../lib/bookingCallable";
import { hydrateManagerWorkedFromServer, syncManagerWorkTotalToServer } from "../lib/advisorWorkSync";
import { formatAdvisorReceptionSummary } from "../lib/formatAdvisorReceptionSummary";
import { parseBackendDateTime } from "../lib/backendDateTime";
import { AppLogo } from "../lib/brand";

type Props = {
  managerDark: boolean;
  setManagerDark: (next: boolean) => void;
};

function Switch({
  checked,
  onChange,
  label,
  description,
  onDark,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  /** Белый текст на фиолетовом баре */
  onDark?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div
          className={cn(
            "text-sm font-extrabold",
            onDark ? "text-white" : "text-violet-950 dark:text-sky-100"
          )}
        >
          {label}
        </div>
        {description && (
          <div
            className={cn(
              "mt-0.5 text-xs font-semibold",
              onDark ? "text-violet-100" : "text-violet-800 dark:text-sky-300"
            )}
          >
            {description}
          </div>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-8 w-14 rounded-full border transition-colors focus:outline-none focus:ring-4",
          checked
            ? "border-emerald-300 bg-emerald-500/90 focus:ring-emerald-200"
            : "border-sky-200 bg-sky-100 focus:ring-sky-100",
          "dark:border-white/10 dark:bg-white/10 dark:focus:ring-white/10"
        )}
      >
        <span
          className={cn(
            "absolute left-0.5 top-0.5 h-7 w-7 rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-6" : "translate-x-0",
            "dark:bg-white"
          )}
        />
      </button>
    </div>
  );
}

function localYmd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function historyCommentWordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function HistoryCommentCell({ text, t }: { text: string; t: (k: string) => string }) {
  const [open, setOpen] = useState(false);
  const long = historyCommentWordCount(text) > 35 || text.length > 180;
  if (!text) return <td className="px-3 py-3 text-blue-900 dark:text-sky-300">—</td>;
  return (
    <td className="max-w-[240px] px-3 py-3 text-blue-900 dark:text-sky-300">
      <div className={cn("break-words", !open && long && "line-clamp-3")}>{text}</div>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-1 text-[11px] font-extrabold text-blue-600 underline dark:text-sky-400"
        >
          {open ? t("commentCollapse") : t("commentExpand")}
        </button>
      )}
    </td>
  );
}

export default function AdvisorPage({ managerDark, setManagerDark }: Props) {
  const { t, lang, setLang } = useI18n();
  const { setManagerId } = useManagerContext();
  const nav = useNavigate();
  const location = useLocation();
  const [me, setMe] = useState<Advisor | null>(null);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string>("");

  const [live, setLive] = useState<LiveQueue | null>(null);
  const sockRef = useRef<Socket | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showAllQueue, setShowAllQueue] = useState(false);
  const [autoCall, setAutoCall] = useState(false);
  const [autoCallAfterDone, setAutoCallAfterDone] = useState(false);
  const autoCallInFlight = useRef(false);
  const [queueTimeTick, setQueueTimeTick] = useState(0);
  const [rowCallLoading, setRowCallLoading] = useState<number | null>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyDate, setHistoryDate] = useState(() => localYmd());
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRows, setHistoryRows] = useState<any[]>([]);
  const [historyCommentEditId, setHistoryCommentEditId] = useState<number | null>(null);
  const [historyCommentDraft, setHistoryCommentDraft] = useState("");

  const [inServiceCategory, setInServiceCategory] = useState<"RETAKE" | "PAYMENT" | "DISCIPLINE" | "OTHER" | "">("");
  const [inServiceComment, setInServiceComment] = useState("");
  const [inServiceStudentComment, setInServiceStudentComment] = useState("");

  useEffect(() => {
    const s = io({ transports: ["websocket", "polling"] });
    sockRef.current = s;
    s.on("queue:update", (payload: LiveQueue) => setLive(payload));
    return () => {
      s.disconnect();
      sockRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (location.pathname !== "/manager") return;
    void refreshMe();
  }, [location.pathname]);

  useEffect(() => {
    if (me) setManagerId(me.id);
    else setManagerId(null);
  }, [me, setManagerId]);

  useEffect(() => {
    if (!me) return;
    const id = me.id;
    const kShow = `uniq.manager.showAllQueue.${id}`;
    const kAuto = `uniq.manager.autoCall.${id}`;
    const kAfter = `uniq.manager.autoCallAfterDone.${id}`;
    const legShow = `uniq.advisor.showAllQueue.${id}`;
    const legAuto = `uniq.advisor.autoCall.${id}`;
    const legAfter = `uniq.advisor.autoCallAfterDone.${id}`;
    if (localStorage.getItem(kShow) === null && localStorage.getItem(legShow) != null) {
      localStorage.setItem(kShow, localStorage.getItem(legShow) || "0");
    }
    if (localStorage.getItem(kAuto) === null && localStorage.getItem(legAuto) != null) {
      localStorage.setItem(kAuto, localStorage.getItem(legAuto) || "0");
    }
    if (localStorage.getItem(kAfter) === null && localStorage.getItem(legAfter) != null) {
      localStorage.setItem(kAfter, localStorage.getItem(legAfter) || "0");
    }
    if (localStorage.getItem(kShow) === null && localStorage.getItem("uniq.showAllQueue") === "1") {
      localStorage.setItem(kShow, "1");
    }
    if (localStorage.getItem(kAuto) === null && localStorage.getItem("uniq.autoCall") === "1") {
      localStorage.setItem(kAuto, "1");
    }
    setShowAllQueue(localStorage.getItem(kShow) === "1");
    setAutoCall(localStorage.getItem(kAuto) === "1");
    setAutoCallAfterDone(localStorage.getItem(kAfter) === "1");
  }, [me?.id]);

  async function refreshMe() {
    const res = await fetchJSON("/api/managers/me");
    if (!res.ok) {
      setMe(null);
      return;
    }
    const js = await readJSON<Advisor>(res);
    hydrateManagerWorkedFromServer(js.id, Number(js.total_work_ms) || 0);
    setMe(js);
    // scope settings are edited on /manager/settings
  }

  const doLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    const res = await fetchJSON("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ login, password }),
    });
    const js = await readJSON<any>(res);
    if (!res.ok) {
      setLoginError(js?.error || "Не удалось войти");
      return;
    }
    await refreshMe();
  };

  const logout = async () => {
    if (me?.id != null) {
      await syncManagerWorkTotalToServer(me.id);
    }
    await fetchJSON("/api/auth/logout", { method: "POST" });
    setMe(null);
  };

  const toggleReception = async () => {
    if (!me) return;
    const isOpenNow = !(me.reception_open === false || me.reception_open === 0);
    const res = await fetchJSON("/api/managers/me/reception", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ open: !isOpenNow }),
    });
    if (!res.ok) {
      alert("Нет доступа");
      return;
    }
    await refreshMe();
  };

  const callNext = async () => {
    const res = await fetchJSON("/api/tickets/call-next", { method: "POST" });
    const js = await readJSON<any>(res);
    if (!res.ok) alert(js?.error || "Не удалось вызвать");
  };

  const callBooked = async (ticketId: number) => {
    setRowCallLoading(ticketId);
    try {
      const res = await fetchJSON(`/api/tickets/${ticketId}/call-booked`, { method: "POST" });
      const js = await readJSON<any>(res);
      if (!res.ok) alert(js?.error || "Не удалось вызвать");
    } finally {
      setRowCallLoading(null);
    }
  };

  const callToMyDesk = async (ticketId: number) => {
    setRowCallLoading(ticketId);
    try {
      const res = await fetchJSON(`/api/tickets/${ticketId}/call-to-my-desk`, { method: "POST" });
      const js = await readJSON<any>(res);
      if (!res.ok) alert(js?.error || "Не удалось вызвать");
    } finally {
      setRowCallLoading(null);
    }
  };

  useEffect(() => {
    if (!me) return;
    localStorage.setItem(`uniq.manager.showAllQueue.${me.id}`, showAllQueue ? "1" : "0");
  }, [me?.id, showAllQueue]);

  useEffect(() => {
    if (!me) return;
    localStorage.setItem(`uniq.manager.autoCall.${me.id}`, autoCall ? "1" : "0");
  }, [me?.id, autoCall]);

  useEffect(() => {
    if (!me) return;
    localStorage.setItem(`uniq.manager.autoCallAfterDone.${me.id}`, autoCallAfterDone ? "1" : "0");
  }, [me?.id, autoCallAfterDone]);

  const updateTicket = async (ticketId: number, patch: Partial<Ticket>) => {
    const res = await fetchJSON(`/api/tickets/${ticketId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const js = await readJSON<any>(res).catch(() => null);
      alert(js?.error || "Ошибка обновления");
    }
  };

  const fetchHistory = async () => {
    setHistoryLoading(true);
    const q = new URLSearchParams({ limit: "200", date: historyDate });
    const res = await fetchJSON(`/api/managers/me/history?${q}`);
    const js = await readJSON<any>(res);
    setHistoryLoading(false);
    if (!res.ok) {
      alert(js?.error || "Не удалось загрузить историю");
      return;
    }
    setHistoryRows(Array.isArray(js?.rows) ? js.rows : []);
  };

  const reopenHistoryTicket = async (ticketId: number, action: "queue" | "service" | "comment") => {
    const res = await fetchJSON(`/api/tickets/${ticketId}/reopen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        action === "comment" ? { action, comment: historyCommentDraft } : { action }
      ),
    });
    const js = (await readJSON<{ error?: string }>(res).catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      alert(js.error || "Не удалось выполнить");
      return;
    }
    if (action === "comment") {
      setHistoryCommentEditId(null);
      setHistoryCommentDraft("");
    }
    void fetchHistory();
  };

  // scope settings are edited on /manager/settings

  const receptionHeader = useMemo(
    () => (me ? formatAdvisorReceptionSummary(me, lang) : null),
    [me, lang]
  );

  const waitingTickets = useMemo(() => {
    const tickets = live?.tickets || [];
    return tickets.filter((t) => t.status === "WAITING");
  }, [live]);

  const ticketsInMyScope = useMemo(() => {
    if (!me) return [];
    return waitingTickets.filter((t) => {
      const visibleIds = Array.isArray((t as any).visible_manager_ids) ? ((t as any).visible_manager_ids as number[]) : null;
      if (visibleIds) return visibleIds.includes(Number(me.id));
      // Fallback for older backend payloads
      return ticketMatchesAdvisor(me, t);
    });
  }, [waitingTickets, me]);

  const waitingForDisplay = useMemo(() => {
    if (showAllQueue) return waitingTickets;
    return ticketsInMyScope;
  }, [waitingTickets, ticketsInMyScope, showAllQueue]);

  useEffect(() => {
    const id = window.setInterval(() => setQueueTimeTick((x) => x + 1), 20_000);
    return () => window.clearInterval(id);
  }, []);

  const ticketsCallableNow = useMemo(() => {
    void queueTimeTick;
    const now = Date.now();
    return ticketsInMyScope.filter((t) => bookingCallableNow(t.preferred_slot_at, now));
  }, [ticketsInMyScope, queueTimeTick]);

  const activeTicket = useMemo(() => {
    if (!me) return undefined;
    return (live?.tickets || []).find(
      (t) =>
        (t.status === "CALLED" || t.status === "IN_SERVICE") && Number(t.advisor_id) === Number(me.id)
    );
  }, [live?.tickets, me]);

  useEffect(() => {
    if (!activeTicket || activeTicket.status !== "IN_SERVICE") return;
    setInServiceCategory((activeTicket.case_type as any) || "");
    setInServiceComment(String(activeTicket.comment || ""));
    setInServiceStudentComment(String(activeTicket.student_comment || ""));
  }, [activeTicket?.id, activeTicket?.status]);

  useEffect(() => {
    if (!me) return;
    if (!autoCall) return;
    if (!(me?.reception_open === true || me?.reception_open === 1)) return;
    if (activeTicket) return;
    if (ticketsCallableNow.length === 0) return;
    if (autoCallInFlight.current) return;

    autoCallInFlight.current = true;
    const t = setTimeout(() => {
      void callNext().finally(() => {
        autoCallInFlight.current = false;
      });
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoCall, me?.id, me?.reception_open, ticketsCallableNow.length, activeTicket?.id]);

  useEffect(() => {
    if (!historyOpen) return;
    void fetchHistory();
    const t = setInterval(() => void fetchHistory(), 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyOpen, historyDate]);

  function wordCount(text: string): number {
    return text
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
  }

  function clampTo300Words(text: string): string {
    const parts = text.trim().split(/\s+/).filter(Boolean);
    if (parts.length <= 300) return text;
    return parts.slice(0, 300).join(" ");
  }

  const submitComplete = async () => {
    if (!activeTicket || activeTicket.status !== "IN_SERVICE") return;
    const okCat = Boolean(inServiceCategory);
    const wc = wordCount(inServiceComment);
    const okComment = wc > 0 && wc <= 300;
    if (!okCat || !okComment) return;
    const res = await fetchJSON(`/api/tickets/${activeTicket.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        case_type: inServiceCategory,
        comment: inServiceComment,
        student_comment: inServiceStudentComment,
        status: "DONE",
      }),
    });
    const js = (await readJSON(res).catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      alert(js.error || "Ошибка завершения");
      return;
    }
    if (autoCallAfterDone && (me?.reception_open === true || me?.reception_open === 1)) {
      await callNext();
    }
  };

  function caseTypeRu(caseType: string | null | undefined): string {
    if (caseType === "RETAKE") return "Ритейк";
    if (caseType === "PAYMENT") return "Оплата";
    if (caseType === "DISCIPLINE") return "Вопрос по дисциплине";
    if (caseType === "OTHER") return "Другое";
    return "—";
  }

  function statusRu(status: string | null | undefined): string {
    if (status === "DONE") return "Обслужен";
    if (status === "MISSED") return "Пропущен";
    if (status === "CANCELLED") return "Отменён";
    if (status === "WAITING") return "Ожидание";
    if (status === "CALLED") return "Вызван";
    if (status === "IN_SERVICE") return "На приёме";
    return status || "—";
  }

  function timeHHMM(dt: string | null | undefined): string {
    const d = parseBackendDateTime(dt ?? undefined);
    if (!d) return "—";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  if (!me) {
    return (
      <div className="mx-auto max-w-md ui-card">
        <div className="mb-4 flex justify-center">
          <AppLogo className="h-12 w-auto max-w-[200px] object-contain" />
        </div>
        <div className="text-lg font-extrabold tracking-tight text-violet-950 dark:text-sky-100">{t("managerLogin")}</div>
        <div className="mt-1 text-xs font-semibold text-violet-800 dark:text-sky-300">
          {t("loginHint")} <span className="font-mono">smirnov</span> / <span className="font-mono">ivanov</span>, {t("loginPasswordHint")}{" "}
          <span className="font-mono">Manager2026!</span>
        </div>
        <form onSubmit={doLogin} className="mt-4 space-y-3">
          <input
            className="ui-input"
            placeholder={t("login")}
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            required
          />
          <input
            type="password"
            className="ui-input"
            placeholder={t("password")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {loginError && <div className="text-sm font-semibold text-red-700">{loginError}</div>}
          <button className="ui-btn-primary w-full">{t("signIn")}</button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-2xl bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-600 p-5 text-white shadow-lg shadow-violet-500/25 dark:from-violet-950 dark:via-indigo-950 dark:to-slate-950">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="mt-0.5 flex h-11 shrink-0 items-center justify-center rounded-xl bg-white/15 px-1.5 py-1 ring-1 ring-white/25">
              <AppLogo className="h-9 w-auto max-h-9 max-w-[120px] object-contain object-center brightness-0 invert" />
            </div>
            <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-white/80">{t("managerPanel")}</div>
            <div className="mt-1 text-xl font-black tracking-tight">{me.name}</div>
            {receptionHeader && (
              <>
                <div className="mt-1.5 text-sm font-semibold leading-snug text-violet-50">
                  {receptionHeader.schoolsLine}
                </div>
                <div className="mt-1 max-w-2xl text-xs font-medium leading-relaxed text-violet-100/95">
                  {receptionHeader.scopeLine}
                </div>
              </>
            )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div
              className={cn(
                "rounded-xl border-2 px-3 py-2 backdrop-blur-sm transition-colors",
                me.reception_open === false || me.reception_open === 0
                  ? "border-red-500 bg-red-500/20 shadow-[0_0_20px_-4px_rgba(239,68,68,0.55)]"
                  : "border-emerald-400 bg-emerald-500/20 shadow-[0_0_20px_-4px_rgba(16,185,129,0.65)]"
              )}
            >
              <Switch
                checked={!(me.reception_open === false || me.reception_open === 0)}
                onChange={() => void toggleReception()}
                label={t("registration")}
                description={
                  me.reception_open === false || me.reception_open === 0
                    ? t("registrationClosed")
                    : t("registrationOpen")
                }
                onDark
              />
              <p className="mt-2 max-w-xs text-[10px] font-semibold leading-snug text-white/85">{t("managerReceptionSelfOnly")}</p>
            </div>
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-4 py-2.5 text-sm font-extrabold text-white backdrop-blur-sm hover:bg-white/20"
            >
              <Settings size={18} /> {t("settings")}
            </button>
            <button
              type="button"
              onClick={() => {
                setHistoryDate(localYmd());
                setHistoryOpen(true);
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-4 py-2.5 text-sm font-extrabold text-white backdrop-blur-sm hover:bg-white/20"
            >
              <History size={18} /> {t("history")}
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="inline-flex items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-4 py-2.5 text-sm font-extrabold text-white backdrop-blur-sm hover:bg-white/20"
            >
              <LogOut size={18} /> {t("logout")}
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="ui-stat-card">
          <div className="ui-stat-card-muted">{t("waiting")}</div>
          <div className="ui-stat-card-value">{waitingForDisplay.length}</div>
        </div>
        <div className="ui-stat-card bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-700 shadow-blue-500/25">
          <div className="ui-stat-card-muted">{t("currentStudent")}</div>
          <div className="mt-1 text-lg font-black">
            {activeTicket ? `#${activeTicket.formatted_number || activeTicket.queue_number}` : "—"}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="ui-card p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-violet-100 px-5 py-4 dark:border-white/10">
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-wider text-violet-600 dark:text-sky-300">
                {showAllQueue ? t("showAllQueue") : t("queueNow")}
              </div>
              <div className="text-sm font-extrabold text-violet-950 dark:text-sky-100">
                {t("waiting")}: {waitingForDisplay.length}
              </div>
            </div>
            <button type="button" onClick={() => void callNext()} className="ui-btn-primary shrink-0">
              {t("callNext")}
            </button>
          </div>
          {showAllQueue && (
            <div className="border-b border-violet-100 bg-violet-50/80 px-5 py-3 text-xs font-semibold text-violet-900 dark:border-white/10 dark:bg-blue-950/40 dark:text-sky-200">
              {t("showAllQueueCallHint")}
            </div>
          )}
          <div className="divide-y divide-violet-100 dark:divide-white/10">
            {waitingForDisplay.slice(0, 15).map((tk) => {
                const slot = (tk as Ticket).preferred_slot_at;
                const inMyScope = me ? ticketMatchesAdvisor(me, tk) : false;
                const nowMs = Date.now();
                const canCallThis = bookingCallableNow(slot, nowMs);
                const showBookedBtn = !showAllQueue && Boolean(slot) && inMyScope;
                const canCallBooked = showBookedBtn && canCallThis;
                const showClaimBtn = showAllQueue && canCallThis;
                return (
                  <div
                    key={tk.id}
                    className="flex flex-col gap-2 px-5 py-4 transition hover:bg-violet-50/50 dark:hover:bg-white/5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-extrabold text-violet-950 dark:text-sky-100">
                            #{tk.formatted_number || tk.queue_number}{" "}
                            <span className="text-xs font-semibold text-blue-600 dark:text-sky-300">{tk.school || ""}</span>
                          </div>
                          <div className="text-xs font-semibold text-violet-700 dark:text-sky-300">
                            {tk.language_section || ""} · {tk.course || ""}
                          </div>
                        </div>
                        <div className="text-sm font-extrabold text-violet-900 dark:text-sky-100">
                          {String(tk.student_last_name || "").trim()} {String(tk.student_first_name || "").trim()}
                        </div>
                        <div className="text-xs font-medium text-violet-800/90 dark:text-sky-300">
                          {tk.specialty || ""} {tk.specialty_code ? `(${tk.specialty_code})` : ""}
                          {tk.study_duration_years ? ` · ТиПО ${tk.study_duration_years} г.` : ""}
                        </div>
                        {slot && (
                          <div className="text-[10px] font-bold text-amber-700 dark:text-amber-300">
                            {t("bookingQueueBadge")}: {new Date(String(slot)).toLocaleString()}
                            {!bookingCallableNow(slot, nowMs) && (
                              <span className="ml-2 font-extrabold text-violet-600 dark:text-violet-400">
                                · {t("bookingCallFromTime").replace("{time}", timeHHMM(String(slot)))}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        {showBookedBtn && (
                          <button
                            type="button"
                            disabled={!canCallBooked || rowCallLoading === tk.id}
                            onClick={() => void callBooked(tk.id)}
                            className="rounded-xl border-2 border-amber-300 bg-amber-50 px-3 py-2 text-xs font-extrabold text-amber-950 shadow-sm transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-45 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-900/50"
                            title={!canCallBooked ? t("bookingCallNotYetHint") : t("callBookedBtn")}
                          >
                            {rowCallLoading === tk.id ? t("loading") : t("callBookedBtn")}
                          </button>
                        )}
                        {showClaimBtn && (
                          <button
                            type="button"
                            disabled={rowCallLoading === tk.id}
                            onClick={() => void callToMyDesk(tk.id)}
                            className="rounded-xl border-2 border-emerald-400 bg-emerald-500 px-3 py-2 text-xs font-extrabold text-white shadow-sm shadow-emerald-500/30 transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-45"
                            title={t("callStudentToMe")}
                          >
                            {rowCallLoading === tk.id ? t("loading") : t("callStudentToMe")}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>

        <div className="ui-card p-5">
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-violet-600 dark:text-sky-300">{t("currentStudent")}</div>
          {activeTicket ? (
            <div className="mt-3 overflow-hidden rounded-2xl border border-violet-100 bg-white shadow-sm dark:border-white/10 dark:bg-blue-950/50">
              <div className="border-b border-violet-100 bg-gradient-to-r from-violet-50 to-blue-50 px-5 py-4 dark:border-white/10 dark:from-violet-950/40 dark:to-blue-950/40">
                <div className="text-xl font-black text-blue-600 dark:text-sky-300">
                  #{activeTicket.formatted_number || activeTicket.queue_number}
                </div>
                <div className="mt-1 text-sm font-extrabold text-violet-950 dark:text-sky-100">{activeTicket.school}</div>
                <div className="text-xs font-semibold text-violet-800 dark:text-sky-300">
                  {activeTicket.specialty} {activeTicket.specialty_code ? `(${activeTicket.specialty_code})` : ""}
                </div>
              </div>
              <div className="p-5">
              {activeTicket.status === "CALLED" && (
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => void updateTicket(activeTicket.id, { status: "IN_SERVICE" })}
                    className="inline-flex min-w-[220px] items-center justify-center gap-2 rounded-xl bg-blue-800 px-6 py-4 text-sm font-extrabold text-white hover:bg-blue-900"
                  >
                    <UserCheck size={18} /> {t("studentArrived")}
                  </button>
                  <button
                    type="button"
                    onClick={() => void updateTicket(activeTicket.id, { status: "MISSED" })}
                    className="inline-flex min-w-[220px] items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-6 py-4 text-sm font-extrabold text-red-700 hover:bg-red-100"
                  >
                    <XCircle size={18} /> {t("missedBtn")}
                  </button>
                </div>
              )}

              {activeTicket.status === "IN_SERVICE" && (
                <div className="space-y-3">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-violet-600 dark:text-sky-300">
                      {t("categoryReq")}
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {[
                        { label: t("catRetake"), v: "RETAKE" as const },
                        { label: t("catPayment"), v: "PAYMENT" as const },
                        { label: t("catDiscipline"), v: "DISCIPLINE" as const },
                        { label: t("catOther"), v: "OTHER" as const },
                      ].map((x) => (
                        <button
                          key={x.v}
                          type="button"
                          onClick={() => setInServiceCategory(x.v)}
                          className={cn(
                            "rounded-2xl border-2 px-4 py-3 text-left text-sm font-extrabold shadow-sm transition",
                            inServiceCategory === x.v
                              ? "border-amber-400 bg-amber-500 text-white shadow-lg shadow-amber-500/40 ring-2 ring-amber-200/90 dark:border-amber-300 dark:bg-amber-500 dark:text-white dark:ring-amber-400"
                              : "border-violet-200 bg-white text-violet-950 hover:bg-violet-100 dark:border-slate-600 dark:bg-slate-800 dark:text-sky-100 dark:hover:bg-slate-700"
                          )}
                        >
                          {x.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <textarea
                    className="min-h-[90px] w-full rounded-xl border border-violet-100 bg-white px-3 py-2 text-sm font-semibold text-violet-950 outline-none shadow-sm focus:border-violet-400 focus:ring-4 focus:ring-violet-100 dark:border-white/10 dark:bg-blue-950/55 dark:text-sky-100 dark:focus:ring-white/10"
                    placeholder={t("commentReq")}
                    value={inServiceComment}
                    onChange={(e) => setInServiceComment(clampTo300Words(e.target.value))}
                  />
                  <textarea
                    className="min-h-[70px] w-full rounded-xl border border-violet-100 bg-white px-3 py-2 text-sm font-semibold text-violet-950 outline-none shadow-sm focus:border-violet-400 focus:ring-4 focus:ring-violet-100 dark:border-white/10 dark:bg-blue-950/55 dark:text-sky-100 dark:focus:ring-white/10"
                    placeholder={t("studentCommentReq")}
                    value={inServiceStudentComment}
                    onChange={(e) => setInServiceStudentComment(e.target.value)}
                  />
                  <div className="flex items-center justify-between text-xs font-semibold text-violet-800 dark:text-sky-300">
                    <span>{inServiceComment.trim() ? t("commentFilled") : t("commentRequired")}</span>
                    <span>
                      {Math.min(wordCount(inServiceComment), 300)}/300 {t("wordsShort")}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void submitComplete()}
                    disabled={!inServiceCategory || wordCount(inServiceComment) === 0 || wordCount(inServiceComment) > 300}
                    className="inline-flex min-w-[220px] items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-6 py-4 text-base font-extrabold text-white shadow-sm shadow-emerald-500/20 hover:bg-emerald-600"
                  >
                    <CheckCircle2 size={18} /> {t("complete")}
                  </button>
                </div>
              )}
              </div>
            </div>
          ) : (
            <div className="mt-3 rounded-2xl border border-violet-100 bg-violet-50/50 px-4 py-4 text-sm font-semibold text-violet-900 dark:border-white/10 dark:bg-blue-950/45 dark:text-sky-200">
              {t("noCalled")}
            </div>
          )}
        </div>
      </div>

      {settingsOpen && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-blue-950/25 backdrop-blur-sm"
            onClick={() => setSettingsOpen(false)}
          />
          <div className="absolute inset-x-0 top-16 mx-auto max-w-2xl px-4">
            <div className="rounded-3xl border border-sky-100/70 bg-white/90 p-6 shadow-xl shadow-sky-500/10 backdrop-blur dark:border-white/10 dark:bg-blue-950/90">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-black text-blue-950 dark:text-sky-100">{t("settings")}</div>
                  <div className="mt-1 text-sm font-semibold text-blue-900 dark:text-sky-300">{t("settingsModalDesc")}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-200 bg-white text-violet-700 transition hover:bg-violet-100 hover:text-violet-950 dark:border-white/10 dark:bg-white/10 dark:text-sky-200 dark:hover:bg-white/20"
                  aria-label={t("close")}
                >
                  <X className="h-5 w-5" strokeWidth={2.5} />
                </button>
              </div>

              <div className="mt-5 space-y-4">
                <div className="rounded-3xl border border-sky-100 bg-white p-5 dark:border-white/10 dark:bg-blue-950/50">
                  <div className="space-y-4">
                    <Switch
                      checked={showAllQueue}
                      onChange={setShowAllQueue}
                      label={t("showAllQueue")}
                      description={t("showAllQueueDesc")}
                    />
                    <div className="h-px bg-sky-100 dark:bg-white/10" />
                    <Switch
                      checked={autoCall}
                      onChange={setAutoCall}
                      label={t("autoCall")}
                      description={t("autoCallDesc")}
                    />
                    <div className="h-px bg-sky-100 dark:bg-white/10" />
                    <Switch
                      checked={autoCallAfterDone}
                      onChange={setAutoCallAfterDone}
                      label={t("autoCallAfterDone")}
                      description={t("autoCallAfterDoneDesc")}
                    />
                    <div className="h-px bg-sky-100 dark:bg-white/10" />
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <div className="text-sm font-extrabold text-blue-950 dark:text-sky-100">{t("langUi")}</div>
                        <div className="mt-0.5 text-xs font-semibold text-blue-900 dark:text-sky-300">{t("langUiHint")}</div>
                      </div>
                      <select
                        value={lang}
                        onChange={(e) => setLang(e.target.value as any)}
                        className="rounded-2xl border border-sky-100 bg-white px-3 py-2 text-sm font-extrabold text-blue-950 shadow-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-sky-100 dark:border-white/10 dark:bg-blue-950/55 dark:text-sky-200 dark:focus:ring-white/10"
                      >
                        <option value="kaz">kaz</option>
                        <option value="eng">eng</option>
                        <option value="rus">rus</option>
                      </select>
                    </div>
                    <div className="h-px bg-sky-100 dark:bg-white/10" />
                    <Switch
                      checked={managerDark}
                      onChange={setManagerDark}
                      label={t("darkTheme")}
                      description={t("darkThemeDesc")}
                    />
                    <div className="h-px bg-sky-100 dark:bg-white/10" />
                    <button
                      type="button"
                      onClick={() => {
                        setSettingsOpen(false);
                        nav("/manager/settings");
                      }}
                      className="w-full rounded-2xl border border-sky-100 bg-white px-4 py-3 text-sm font-extrabold text-blue-950 shadow-sm hover:bg-blue-900 hover:text-white dark:border-white/10 dark:bg-white/5 dark:text-sky-200 dark:hover:bg-sky-500/15"
                    >
                      {t("openReceptionSettingsPage")}
                    </button>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>
      )}

      {historyOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-blue-950/25 backdrop-blur-sm" onClick={() => setHistoryOpen(false)} />
          <div className="absolute inset-x-0 top-10 mx-auto max-w-5xl px-4">
            <div className="rounded-3xl border border-sky-100/70 bg-white/90 p-6 shadow-xl shadow-sky-500/10 backdrop-blur dark:border-white/10 dark:bg-blue-950/90">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-black text-blue-950 dark:text-sky-100">{t("history")}</div>
                  <div className="mt-1 text-sm font-semibold text-blue-900 dark:text-sky-300">
                    {historyLoading ? t("loading") : `${t("records")}: ${historyRows.length}`}
                  </div>
                  <p className="mt-1 max-w-md text-[11px] font-medium text-blue-800/90 dark:text-sky-400/90">
                    {t("historyDateHint")}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 rounded-2xl border border-sky-100 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/5">
                    <span className="text-[11px] font-extrabold uppercase tracking-wide text-blue-800 dark:text-sky-300">
                      {t("historyPickDate")}
                    </span>
                    <input
                      type="date"
                      value={historyDate}
                      onChange={(e) => setHistoryDate(e.target.value)}
                      className="rounded-lg border border-sky-100 bg-white px-2 py-1 text-sm font-bold text-blue-950 outline-none dark:border-white/10 dark:bg-slate-900 dark:text-sky-100"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void fetchHistory()}
                    className="rounded-2xl border border-sky-100 bg-white px-4 py-2 text-sm font-extrabold text-blue-900 hover:bg-blue-900 hover:text-white dark:border-white/10 dark:bg-white/5 dark:text-sky-200 dark:hover:bg-sky-500/15"
                  >
                    {t("refresh")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setHistoryOpen(false)}
                    className="rounded-2xl border border-sky-100 bg-white px-4 py-2 text-sm font-extrabold text-blue-900 hover:bg-blue-900 hover:text-white dark:border-white/10 dark:bg-white/5 dark:text-sky-200 dark:hover:bg-sky-500/15"
                  >
                    {t("close")}
                  </button>
                </div>
              </div>

              <div className="mt-5 overflow-auto rounded-2xl border border-sky-100 bg-white dark:border-white/10 dark:bg-blue-950/55">
                <table className="min-w-[1380px] w-full text-left text-xs">
                  <thead className="sticky top-0 bg-violet-50 text-violet-900 dark:bg-blue-950/70 dark:text-sky-200">
                    <tr>
                      {[
                        "№",
                        t("historyStudent"),
                        t("historySchoolSpec"),
                        t("historyDeptCourse"),
                        "ТиПО",
                        t("historyStart"),
                        t("historyQueueWait"),
                        t("historyServiceTime"),
                        t("historyTotalTime"),
                        t("historyManagerName"),
                        t("historyCategory"),
                        t("historyStatus"),
                        t("historyComment"),
                        t("historyStudentComment"),
                        t("historyActions"),
                      ].map((h) => (
                        <th key={h} className="px-3 py-3 font-black uppercase tracking-widest text-[10px]">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-sky-100 dark:divide-white/10">
                    {historyRows.map((r) => (
                      <tr key={r.log_id ?? r.id} className="align-top">
                        <td className="px-3 py-3 font-black text-blue-800 dark:text-sky-300">
                          <span>#{r.formatted_number || r.queue_number}</span>
                          {Number(r.is_repeat) === 1 ? (
                            <span className="ml-1.5 align-middle text-[10px] font-semibold leading-none text-amber-800 dark:text-amber-300">
                              ({t("historyRepeatCall")})
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-3 font-semibold text-blue-950 dark:text-sky-100">
                          {String(r.student_last_name || "").trim()} {String(r.student_first_name || "").trim()}
                        </td>
                        <td className="px-3 py-3 text-blue-900 dark:text-sky-200">
                          <div className="font-semibold">{r.school || ""}</div>
                          <div className="text-blue-900 dark:text-sky-300">{r.specialty || ""}</div>
                        </td>
                        <td className="px-3 py-3 text-blue-900 dark:text-sky-200">
                          {r.language_section || ""} · {r.course || ""}
                        </td>
                        <td className="px-3 py-3 text-blue-900 dark:text-sky-200">
                          {r.study_duration_years != null ? `ТиПО ${r.study_duration_years} г.` : "—"}
                        </td>
                        <td className="px-3 py-3 text-blue-900 dark:text-sky-200">{timeHHMM(r.started_at)}</td>
                        <td className="px-3 py-3 text-blue-900 dark:text-sky-200">
                          {r.queue_wait_minutes != null ? `${r.queue_wait_minutes} ${t("minShort")}` : "—"}
                        </td>
                        <td className="px-3 py-3 text-blue-900 dark:text-sky-200">
                          {r.desk_service_minutes != null ? `${r.desk_service_minutes} ${t("minShort")}` : "—"}
                        </td>
                        <td className="px-3 py-3 text-blue-900 dark:text-sky-200">
                          {r.total_minutes != null ? `${r.total_minutes} ${t("minShort")}` : "—"}
                        </td>
                        <td className="px-3 py-3 text-blue-900 dark:text-sky-200">{r.advisor_name || "—"}</td>
                        <td className="px-3 py-3 text-blue-900 dark:text-sky-200">
                          {caseTypeRu(r.case_type)}
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={cn(
                              "inline-flex rounded-full border px-2 py-1 text-[11px] font-black",
                              r.status === "DONE"
                                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                : r.status === "MISSED"
                                  ? "border-red-200 bg-red-50 text-red-800"
                                  : "border-sky-200 bg-sky-50 text-blue-900",
                              "dark:border-white/10 dark:bg-white/5 dark:text-sky-200"
                            )}
                          >
                            {statusRu(r.status)}
                          </span>
                        </td>
                        <HistoryCommentCell text={String(r.comment || "")} t={t} />
                        <HistoryCommentCell text={String(r.student_comment || "")} t={t} />
                        <td className="px-3 py-3 align-top">
                          {Number(r.reopen_eligible) === 1 ? (
                            <div className="flex max-w-[140px] flex-col gap-1">
                              <button
                                type="button"
                                onClick={() => void reopenHistoryTicket(r.id, "queue")}
                                className="rounded-lg border border-violet-200 bg-violet-50 px-2 py-1.5 text-[10px] font-extrabold text-violet-900 transition-colors hover:border-neutral-900 hover:bg-neutral-900 hover:text-white dark:border-white/15 dark:bg-white/10 dark:text-sky-100 dark:hover:border-neutral-800 dark:hover:bg-neutral-950 dark:hover:text-white"
                              >
                                {t("historyReopenQueue")}
                              </button>
                              <button
                                type="button"
                                onClick={() => void reopenHistoryTicket(r.id, "service")}
                                className="rounded-lg border border-blue-200 bg-blue-50 px-2 py-1.5 text-[10px] font-extrabold text-blue-900 transition-colors hover:border-neutral-900 hover:bg-neutral-900 hover:text-white dark:border-sky-800/50 dark:bg-sky-950/40 dark:text-sky-100 dark:hover:border-neutral-800 dark:hover:bg-neutral-950 dark:hover:text-white"
                              >
                                {t("historyReopenService")}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setHistoryCommentEditId(r.id);
                                  setHistoryCommentDraft(String(r.comment || ""));
                                }}
                                className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] font-extrabold text-amber-950 transition-colors hover:border-neutral-900 hover:bg-neutral-900 hover:text-white dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100 dark:hover:border-neutral-800 dark:hover:bg-neutral-950 dark:hover:text-white"
                              >
                                {t("historyEditComment")}
                              </button>
                            </div>
                          ) : (
                            <span className="text-violet-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {historyRows.length === 0 && (
                      <tr>
                        <td colSpan={14} className="px-4 py-8 text-center text-sm font-semibold text-blue-900 dark:text-sky-300">
                          {t("historyEmpty")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {historyCommentEditId != null && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-blue-950/40 backdrop-blur-sm"
            aria-label={t("close")}
            onClick={() => {
              setHistoryCommentEditId(null);
              setHistoryCommentDraft("");
            }}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-sky-100 bg-white p-6 shadow-xl dark:border-white/10 dark:bg-blue-950">
            <div className="text-base font-black text-blue-950 dark:text-sky-100">{t("historyEditComment")}</div>
            <textarea
              className="mt-3 min-h-[120px] w-full rounded-xl border border-sky-100 px-3 py-2 text-sm font-semibold text-blue-950 outline-none dark:border-white/10 dark:bg-slate-900 dark:text-sky-100"
              value={historyCommentDraft}
              onChange={(e) => setHistoryCommentDraft(e.target.value)}
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void reopenHistoryTicket(historyCommentEditId, "comment")}
                className="rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-black text-white transition-colors hover:bg-neutral-900 dark:hover:bg-neutral-950"
              >
                {t("historyCommentSave")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setHistoryCommentEditId(null);
                  setHistoryCommentDraft("");
                }}
                className="rounded-xl border border-sky-200 px-4 py-2.5 text-sm font-bold text-blue-900 transition-colors hover:border-neutral-900 hover:bg-neutral-900 hover:text-white dark:border-white/10 dark:text-sky-200 dark:hover:border-neutral-700 dark:hover:bg-neutral-950 dark:hover:text-white"
              >
                {t("close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

