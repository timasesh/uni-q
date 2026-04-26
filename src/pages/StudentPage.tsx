import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { io, Socket } from "socket.io-client";
import { fetchJSON, readJSON } from "../api";
import type { LiveQueue, Ticket } from "../types";
import { cn } from "../lib/cn";
import { SCHOOL_ENTRIES, schoolApiNameById, specialtiesForSchool } from "../schools";
import { availableSlotLabelsForToday, isoFromLocalTodayHM } from "../lib/bookingSlots";
import { useI18n } from "../i18n";
import { parseDeskWindowNumber, schemeImagePathForWindow, schemeImagePathGeneral } from "../lib/deskWindow";
import { parseBackendDateTime } from "../lib/backendDateTime";

type StudentForm = {
  firstName: string;
  lastName: string;
  schoolId: string;
  specialtyCode: string;
  languageSection: string;
  course: string;
  studyDurationYears: string;
};

function useLocalTicketId() {
  const [id, setId] = useState<number | null>(() => {
    const v = localStorage.getItem("uniq.ticketId");
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
  });
  const save = (next: number) => {
    localStorage.setItem("uniq.ticketId", String(next));
    setId(next);
  };
  const clear = () => {
    localStorage.removeItem("uniq.ticketId");
    setId(null);
  };
  return { id, save, clear };
}

export default function StudentPage() {
  const { t } = useI18n();
  const { id: ticketId, save: saveTicketId, clear: clearTicketId } = useLocalTicketId();
  /** Запись по выбранному профилю (после выбора школы · курса · отделения) */
  const [lineReg, setLineReg] = useState<{ open: boolean; matchesAny: boolean } | null>(null);
  const [lineRegLoading, setLineRegLoading] = useState(false);
  const [liveQueueEpoch, setLiveQueueEpoch] = useState(0);
  const [live, setLive] = useState<LiveQueue | null>(null);
  const [myTicket, setMyTicket] = useState<Ticket | null>(null);
  const [loadingTicket, setLoadingTicket] = useState(false);
  const sockRef = useRef<Socket | null>(null);
  const prevStatusRef = useRef<string | null>(null);
  const callSoundRef = useRef<HTMLAudioElement | null>(null);

  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingHm, setBookingHm] = useState("");
  const [bookingSlotTick, setBookingSlotTick] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewDismissed, setReviewDismissed] = useState(false);
  const [reviewStars, setReviewStars] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewThanks, setReviewThanks] = useState(false);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [schemeOpen, setSchemeOpen] = useState(false);
  const [waitTick, setWaitTick] = useState(0);
  const schemeAutoOpenedRef = useRef<number | null>(null);
  const [missedReasonOpen, setMissedReasonOpen] = useState(false);
  const [missedReasonText, setMissedReasonText] = useState("");

  const [form, setForm] = useState<StudentForm>({
    firstName: "",
    lastName: "",
    schoolId: SCHOOL_ENTRIES[0]?.id ?? "s0",
    specialtyCode: "",
    languageSection: "ru",
    course: "1",
    studyDurationYears: "3",
  });

  useEffect(() => {
    // Optional: hydrate student name from Microsoft session (if any).
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetchJSON("/api/student/me");
        if (!res.ok) return;
        const js = await readJSON<{ ok: boolean; student: { firstName?: string | null; lastName?: string | null } | null }>(res);
        if (cancelled) return;
        const st = js?.student;
        if (st?.firstName || st?.lastName) {
          setForm((p) => ({
            ...p,
            firstName: p.firstName || String(st.firstName || ""),
            lastName: p.lastName || String(st.lastName || ""),
          }));
        }
      } finally {
        // no-op
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const schoolApi = schoolApiNameById(form.schoolId) ?? SCHOOL_ENTRIES[0]?.apiName ?? "";
  const specialtyOptions = useMemo(() => specialtiesForSchool(schoolApi), [schoolApi]);

  const canRegisterForm = useMemo(() => {
    if (lineRegLoading) return false;
    if (!lineReg) return false;
    return lineReg.matchesAny && lineReg.open;
  }, [lineReg, lineRegLoading]);

  useEffect(() => {
    const specs = specialtiesForSchool(schoolApi);
    if (specs.length === 0) {
      setForm((p) => ({ ...p, specialtyCode: "" }));
      return;
    }
    setForm((p) => {
      if (specs.some((s) => s.code === p.specialtyCode)) return p;
      return { ...p, specialtyCode: specs[0]?.code ?? "" };
    });
  }, [schoolApi]);

  useEffect(() => {
    const s = io({ transports: ["websocket"] });
    sockRef.current = s;
    s.on("queue:update", (payload: LiveQueue) => {
      setLive(payload);
      setLiveQueueEpoch((e) => e + 1);
    });
    return () => {
      s.disconnect();
      sockRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (ticketId) return;
    const specs = specialtiesForSchool(schoolApi);
    if (specs.length > 0 && !form.specialtyCode) {
      setLineReg(null);
      return;
    }
    if (!schoolApi || !form.course || !form.languageSection) {
      setLineReg(null);
      return;
    }
    let cancelled = false;
    setLineRegLoading(true);
    const t = window.setTimeout(() => {
      void (async () => {
        const res = await fetchJSON("/api/registration/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            school: schoolApi,
            specialtyCode: form.specialtyCode,
            languageSection: form.languageSection,
            course: form.course,
            studyDurationYears: form.studyDurationYears,
          }),
        });
        if (cancelled) return;
        if (!res.ok) {
          setLineReg(null);
          setLineRegLoading(false);
          return;
        }
        const js = await readJSON<{ open: boolean; matchesAny: boolean }>(res);
        if (!cancelled) {
          setLineReg({ open: Boolean(js?.open), matchesAny: Boolean(js?.matchesAny) });
          setLineRegLoading(false);
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [ticketId, schoolApi, form.specialtyCode, form.languageSection, form.course, form.studyDurationYears, liveQueueEpoch]);

  useEffect(() => {
    if (!myTicket || myTicket.status !== "MISSED") {
      setMissedReasonOpen(false);
      return;
    }
    if (myTicket.missed_student_note != null) {
      setMissedReasonOpen(false);
      return;
    }
    setMissedReasonOpen(true);
  }, [myTicket?.id, myTicket?.status, myTicket?.missed_student_note]);

  useEffect(() => {
    if (!ticketId) return;
    setLoadingTicket(true);
    const iv = setInterval(() => void refreshTicket(ticketId), 2500);
    void refreshTicket(ticketId).finally(() => setLoadingTicket(false));
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  async function refreshTicket(id: number) {
    const res = await fetchJSON(`/api/tickets/${id}/status`);
    if (!res.ok) {
      clearTicketId();
      setMyTicket(null);
      return;
    }
    const js = await readJSON<Ticket>(res);
    setMyTicket(js);
  }

  async function submitMissedFeedback(reason: string) {
    if (!myTicket) return;
    const res = await fetchJSON(`/api/tickets/${myTicket.id}/missed-feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    const js = (await readJSON<{ error?: string }>(res).catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      alert(js.error || "Не удалось отправить");
      return;
    }
    setMissedReasonOpen(false);
    setMissedReasonText("");
    void refreshTicket(myTicket.id);
  }

  useEffect(() => {
    const prev = prevStatusRef.current;
    const next = myTicket?.status ?? null;
    prevStatusRef.current = next;
    if (!next) return;
    if (prev !== "CALLED" && next === "CALLED") {
      try {
        if (!callSoundRef.current) {
          callSoundRef.current = new Audio("/sound/song.mp3");
          callSoundRef.current.volume = 0.9;
        }
        callSoundRef.current.currentTime = 0;
        void callSoundRef.current.play();
      } catch {
        // autoplay may be blocked; ignore
      }
    }
  }, [myTicket?.status]);

  useEffect(() => {
    if (!myTicket || myTicket.status !== "WAITING" || !myTicket.preferred_slot_at) return;
    const id = window.setInterval(() => setWaitTick((x) => x + 1), 30_000);
    return () => window.clearInterval(id);
  }, [myTicket?.id, myTicket?.status, myTicket?.preferred_slot_at]);

  useEffect(() => {
    if (!myTicket) {
      schemeAutoOpenedRef.current = null;
      return;
    }
    if (myTicket.status !== "CALLED") return;
    const w = parseDeskWindowNumber(myTicket.advisor_desk);
    if (w == null) return;
    if (schemeAutoOpenedRef.current === myTicket.id) return;
    schemeAutoOpenedRef.current = myTicket.id;
    setSchemeOpen(true);
  }, [myTicket?.id, myTicket?.status, myTicket?.advisor_desk, myTicket]);

  const waitingTickets = live?.tickets ?? [];
  const progress = useMemo(() => {
    if (!waitingTickets || waitingTickets.length === 0) return 0;
    const done = waitingTickets.filter((tk) => tk.status !== "WAITING").length;
    return Math.round((done / waitingTickets.length) * 100);
  }, [waitingTickets]);

  const waitingLabelText = useMemo(() => {
    if (!myTicket || myTicket.status !== "WAITING") return "—";
    const slotRaw = myTicket.preferred_slot_at;
    if (slotRaw != null && String(slotRaw).trim() !== "") {
      const d = parseBackendDateTime(String(slotRaw));
      if (d) {
        const ms = d.getTime() - Date.now();
        if (ms > 0) {
          const mins = Math.max(1, Math.ceil(ms / 60_000));
          return t("waitingUntilBooking").replace("{n}", String(mins));
        }
      }
    }
    const est = myTicket.estimated_time;
    return t("waitingQueueEstimate").replace("{n}", String(est ?? "?"));
  }, [myTicket, waitTick, t]);

  const canCancel = myTicket?.status === "WAITING";

  useEffect(() => {
    if (!myTicket || myTicket.status !== "DONE") {
      setReviewOpen(false);
      setReviewThanks(false);
      setReviewDismissed(false);
      return;
    }
    if (Number(myTicket.has_review)) return;
    if (reviewDismissed) return;
    setReviewOpen(true);
  }, [myTicket?.id, myTicket?.status, myTicket?.has_review, reviewDismissed]);

  useEffect(() => {
    if (!myTicket) return;
    if (myTicket.status !== "DONE") return;
    if (reviewOpen) return;
    const timer = setTimeout(() => {
      clearTicketId();
      setMyTicket(null);
    }, 2800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myTicket?.status, reviewOpen]);

  async function postTicket(preferredIso?: string) {
    const specs = specialtiesForSchool(schoolApi);
    const sp = specs.find((x) => x.code === form.specialtyCode);
    const body: Record<string, unknown> = {
      firstName: form.firstName,
      lastName: form.lastName,
      school: schoolApi,
      specialty: sp?.name ?? "",
      specialtyCode: sp?.code ?? "",
      languageSection: form.languageSection,
      course: form.course,
      studyDurationYears: Number(form.studyDurationYears),
    };
    if (preferredIso) body.preferredSlotAt = preferredIso;
    const res = await fetchJSON("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const js = await readJSON<any>(res);
    if (!res.ok) {
      alert(js?.error || "Не удалось встать в очередь");
      return false;
    }
    saveTicketId(js.id);
    setMyTicket({ ...js, has_review: 0 } as Ticket);
    setBookingOpen(false);
    setBookingHm("");
    return true;
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await postTicket();
  };

  useEffect(() => {
    if (!bookingOpen) return;
    setBookingSlotTick((x) => x + 1);
    const iv = setInterval(() => setBookingSlotTick((x) => x + 1), 60_000);
    return () => clearInterval(iv);
  }, [bookingOpen]);

  const bookingOptions = useMemo(
    () => availableSlotLabelsForToday(new Date()),
    [bookingOpen, bookingSlotTick]
  );

  useEffect(() => {
    if (!bookingOpen) return;
    setBookingHm((prev) => (prev && bookingOptions.includes(prev) ? prev : bookingOptions[0] ?? ""));
  }, [bookingOpen, bookingOptions]);

  const submitBooking = async () => {
    if (!bookingHm.trim()) {
      alert(t("bookingNoSlots"));
      return;
    }
    const iso = isoFromLocalTodayHM(new Date(), bookingHm);
    if (!iso) {
      alert(t("bookingModalHint"));
      return;
    }
    await postTicket(iso);
  };

  const cancel = async () => {
    if (!myTicket) return;
    const res = await fetchJSON(`/api/tickets/${myTicket.id}/cancel`, { method: "POST" });
    if (!res.ok) {
      let msg = "Не удалось отменить талон";
      try {
        const err = await readJSON<any>(res);
        msg = err?.error || msg;
      } catch {
        if (res.status === 404) msg = "Маршрут отмены не найден. Перезапустите сервер и обновите страницу.";
      }
      alert(msg);
      return;
    }
    clearTicketId();
    setMyTicket(null);
  };

  const submitReview = async () => {
    if (!myTicket) return;
    if (reviewSubmitting) return;
    setReviewSubmitting(true);
    // close immediately for better UX; reopen on error
    setReviewOpen(false);
    const res = await fetchJSON(`/api/tickets/${myTicket.id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stars: reviewStars, comment: reviewComment }),
    });
    const js = (await readJSON(res).catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setReviewSubmitting(false);
      setReviewOpen(true);
      alert(js.error || "Не удалось отправить");
      return;
    }
    setReviewThanks(true);
    setReviewDismissed(true);
    setReviewSubmitting(false);
    void refreshTicket(myTicket.id);
  };

  const skipReview = () => {
    setReviewDismissed(true);
    setReviewOpen(false);
  };

  const langOpts = [
    { value: "ru", key: "langSec_ru" as const },
    { value: "kz", key: "langSec_kz" as const },
    { value: "en", key: "langSec_en" as const },
  ];

  const deskWindow = myTicket ? parseDeskWindowNumber(myTicket.advisor_desk) : null;
  const schemeImageSrc =
    myTicket && myTicket.status === "WAITING"
      ? schemeImagePathGeneral()
      : deskWindow != null
        ? schemeImagePathForWindow(deskWindow)
        : schemeImagePathGeneral();
  const showSchemeButton =
    myTicket &&
    (myTicket.status === "WAITING" || myTicket.status === "CALLED" || myTicket.status === "IN_SERVICE");

  const COMPACT_QUEUE_VISIBLE = 14;

  return (
    <div className="space-y-6">
      {!myTicket && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="ui-stat-card">
              <div className="ui-stat-card-muted">{t("inQueue")}</div>
              <div className="ui-stat-card-value">{live ? live.tickets.length : "—"}</div>
            </div>
            <div className="ui-stat-card bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-700 shadow-blue-500/25">
              <div className="ui-stat-card-muted">{t("registration")}</div>
              <div className="mt-1 text-lg font-black">
                {lineRegLoading
                  ? t("loading")
                  : lineReg == null
                    ? "—"
                    : !lineReg.matchesAny
                      ? t("registrationLineNoMatch")
                      : !lineReg.open
                        ? t("registrationLineClosedByManager")
                        : t("registrationOpen")}
              </div>
            </div>
          </div>

          <div className="ui-card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-violet-100 pb-4 dark:border-white/10">
              <div>
                <div className="ui-kicker">{t("queueNow")}</div>
                <div className="mt-1 text-sm font-semibold text-violet-900 dark:text-sky-200">
                  {live ? (
                    <>
                      {t("inQueue")}: <span className="font-black text-blue-600 dark:text-sky-300">{live.tickets.length}</span>
                    </>
                  ) : (
                    t("loading")
                  )}
                </div>
              </div>
              <div
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-black",
                  lineRegLoading || lineReg == null
                    ? "bg-slate-400 text-white shadow-sm"
                    : lineReg.matchesAny && lineReg.open
                      ? "bg-emerald-500 text-white shadow-sm shadow-emerald-500/30"
                      : "bg-amber-400 text-white shadow-sm"
                )}
              >
                {lineRegLoading
                  ? t("loading")
                  : lineReg == null
                    ? "—"
                    : !lineReg.matchesAny
                      ? t("registrationLineNoMatch")
                      : !lineReg.open
                        ? t("registrationLineClosedByManager")
                        : t("registrationOpen")}
              </div>
            </div>

            <div className="mt-5">
              <div className="relative h-2.5 overflow-hidden rounded-full bg-violet-100 dark:bg-white/10">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-violet-500 via-purple-500 to-blue-500 transition-all duration-700"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {(live?.tickets || []).slice(0, 16).map((tk) => (
                  <span
                    key={tk.id}
                    className={cn(
                      "inline-flex min-w-[2.75rem] items-center justify-center rounded-full border-2 px-3 py-1.5 text-sm font-black transition",
                      tk.status === "CALLED"
                        ? "border-emerald-400 bg-emerald-500 text-white shadow-sm"
                        : "border-violet-200 bg-white text-violet-900 shadow-sm dark:border-white/10 dark:bg-slate-800 dark:text-sky-100"
                    )}
                  >
                    #{tk.formatted_number || tk.queue_number}
                  </span>
                ))}
              </div>
              {live && live.tickets.length > 16 && (
                <div className="mt-3 text-center text-[11px] font-semibold text-violet-400">
                  {t("studentQueueShownPartial").replace("{n}", "16")}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {myTicket ? (
        <>
          <div className="ui-card overflow-hidden border-violet-200/80 p-0 shadow-violet-200/40 dark:border-white/10">
            <div className="bg-gradient-to-r from-violet-600 to-blue-600 px-6 py-6 text-white sm:py-7">
              <div className="text-[11px] font-black uppercase tracking-widest text-white/90">{t("yourNumber")}</div>
              <div className="mt-1 text-5xl font-black tabular-nums tracking-tight sm:text-6xl">
                #{myTicket.formatted_number || myTicket.queue_number}
              </div>
            </div>

            <div className="flex divide-x divide-violet-100 dark:divide-white/10">
              <div className="min-w-0 flex-1 px-5 py-4">
                <div className="text-[10px] font-black uppercase tracking-widest text-violet-500 dark:text-violet-400">{t("studentCardWait")}</div>
                <div className="mt-0.5 text-lg font-black text-violet-950 dark:text-white">{waitingLabelText}</div>
              </div>
              <div className="min-w-0 flex-1 px-5 py-4">
                <div className="text-[10px] font-black uppercase tracking-widest text-violet-500 dark:text-violet-400">{t("studentCardStatus")}</div>
                <div className="mt-0.5 text-base font-black text-violet-950 dark:text-white">
                  {myTicket.status === "CALLED"
                    ? t("called")
                    : myTicket.status === "IN_SERVICE"
                      ? t("inService")
                      : myTicket.status === "MISSED"
                        ? t("missed")
                        : myTicket.status === "CANCELLED"
                          ? t("cancelled")
                          : myTicket.status === "DONE"
                            ? t("done")
                            : t("waiting")}
                </div>
              </div>
            </div>

            {myTicket.preferred_slot_at && (
              <div className="border-t border-violet-100 bg-indigo-50/60 px-5 py-3 dark:border-white/10 dark:bg-indigo-950/25">
                <div className="text-[10px] font-black uppercase tracking-widest text-indigo-700 dark:text-indigo-300">{t("preferredSlot")}</div>
                <div className="mt-0.5 text-sm font-black text-indigo-950 dark:text-indigo-100">
                  {parseBackendDateTime(String(myTicket.preferred_slot_at))?.toLocaleString() ?? "—"}
                </div>
              </div>
            )}

            {(myTicket.status === "CALLED" || myTicket.status === "IN_SERVICE") && (
              <div className="border-t border-emerald-200/80 bg-emerald-50/90 px-5 py-4 dark:border-emerald-900/50 dark:bg-emerald-950/35">
                <div className="font-black text-emerald-800 dark:text-emerald-200">{t("studentGoToManager")}</div>
                <div className="mt-1 text-sm font-bold text-emerald-900 dark:text-emerald-100">
                  {myTicket.advisor_name || t("historyManagerName")}
                  {myTicket.advisor_desk ? ` · ${myTicket.advisor_desk}` : ""}
                </div>
              </div>
            )}

            {myTicket.status === "MISSED" && (
              <button
                type="button"
                onClick={() => {
                  clearTicketId();
                  setMyTicket(null);
                }}
                className="mx-5 mb-4 mt-2 w-[calc(100%-2.5rem)] rounded-xl border border-red-200 bg-red-50 py-3 text-sm font-black text-red-700 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200"
              >
                {t("queueAgain")}
              </button>
            )}

            <div className="space-y-3 px-5 pb-5 pt-2">
              {showSchemeButton && (
                <button
                  type="button"
                  onClick={() => setSchemeOpen(true)}
                  className="w-full rounded-xl border-2 border-violet-300 bg-violet-50 py-3 text-sm font-black text-violet-950 shadow-sm transition hover:bg-violet-100 dark:border-violet-600 dark:bg-violet-950/40 dark:text-violet-100 dark:hover:bg-violet-900/50"
                >
                  {t("officeSchemeBtn")}
                </button>
              )}
              {canCancel && (
                <button
                  type="button"
                  onClick={() => void cancel()}
                  className="w-full rounded-xl border border-red-200 bg-red-50 py-3 text-sm font-black text-red-700 hover:bg-red-100 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200"
                >
                  {t("cancelQueue")}
                </button>
              )}
            </div>

            <div className="border-t border-violet-100 px-5 py-2.5 text-center text-[11px] font-semibold text-violet-400 dark:border-white/10">
              {loadingTicket ? t("studentTicketUpdating") : reviewThanks ? t("studentReviewThanks") : "\u00a0"}
            </div>
          </div>

          <div className="rounded-xl border border-violet-200/70 bg-white/80 px-3 py-2.5 shadow-sm dark:border-white/10 dark:bg-slate-900/80">
            <div className="flex items-center justify-between gap-2 text-[10px] font-black uppercase tracking-wider text-violet-500 dark:text-violet-400">
              <span>{t("queueNow")}</span>
              <span className="tabular-nums text-violet-950 dark:text-sky-100">{live ? live.tickets.length : "—"}</span>
            </div>
            <div className="mt-1.5 flex max-h-[4.5rem] flex-wrap gap-1 overflow-y-auto">
              {(live?.tickets || []).slice(0, COMPACT_QUEUE_VISIBLE).map((tk) => (
                <span
                  key={tk.id}
                  className={cn(
                    "inline-flex min-w-[2rem] items-center justify-center rounded-md px-1.5 py-0.5 text-[11px] font-black",
                    myTicket.id === tk.id
                      ? "bg-blue-600 text-white"
                      : tk.status === "CALLED"
                        ? "bg-emerald-500 text-white"
                        : "bg-violet-100 text-violet-900 dark:bg-white/10 dark:text-sky-100"
                  )}
                >
                  #{tk.formatted_number || tk.queue_number}
                </span>
              ))}
            </div>
            {live && live.tickets.length > COMPACT_QUEUE_VISIBLE && (
              <div className="mt-1 text-[10px] font-semibold text-violet-400">
                {t("studentQueueShownPartial").replace("{n}", String(COMPACT_QUEUE_VISIBLE))}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="ui-card p-7 dark:border-white/10 dark:bg-slate-900/50">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="ui-title dark:text-white">{t("joinQueue")}</div>
              <div className="mt-1 ui-muted">{t("fillForm")}</div>
            </div>
          </div>
          {lineReg != null && lineReg.matchesAny && !lineReg.open && (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-100">
              {t("registrationClosedStudentHint")}
            </div>
          )}
          {lineReg != null && !lineReg.matchesAny && (
            <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-100">
              {t("registrationLineNoMatch")}
            </div>
          )}
          <p className="mt-3 rounded-xl bg-slate-900 px-4 py-3 text-xs font-semibold leading-relaxed text-white shadow-md dark:bg-slate-950">
            {t("registrationPickProfileHint")}
          </p>
          <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
            <input
              className="ui-input"
              placeholder={t("name")}
              value={form.firstName}
              onChange={(e) => setForm((p) => ({ ...p, firstName: e.target.value }))}
              required
              disabled={!canRegisterForm}
            />
            <input
              className="ui-input"
              placeholder={t("lastName")}
              value={form.lastName}
              onChange={(e) => setForm((p) => ({ ...p, lastName: e.target.value }))}
              required
              disabled={!canRegisterForm}
            />
            <select
              className="ui-input sm:col-span-2"
              value={form.schoolId}
              onChange={(e) => setForm((p) => ({ ...p, schoolId: e.target.value }))}
              required
            >
              {SCHOOL_ENTRIES.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
            <select
              className="ui-input sm:col-span-2"
              value={form.specialtyCode}
              onChange={(e) => setForm((p) => ({ ...p, specialtyCode: e.target.value }))}
              disabled={specialtyOptions.length === 0}
              required
            >
              {specialtyOptions.length === 0 ? (
                <option value="">{t("specialtyEmpty")}</option>
              ) : (
                specialtyOptions.map((sp) => (
                  <option key={sp.code} value={sp.code}>
                    ({sp.code}) {sp.name}
                  </option>
                ))
              )}
            </select>
            <select
              className="ui-input"
              value={form.languageSection}
              onChange={(e) => setForm((p) => ({ ...p, languageSection: e.target.value }))}
            >
              {langOpts.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(o.key)}
                </option>
              ))}
            </select>
            <select
              className="ui-input"
              value={form.course}
              onChange={(e) => setForm((p) => ({ ...p, course: e.target.value }))}
            >
              {(["1", "2", "3", "4"] as const).map((n) => (
                <option key={n} value={n}>
                  {t(`courseNum${n}` as "courseNum1")}
                </option>
              ))}
            </select>
            <select
              className="ui-input sm:col-span-2"
              value={form.studyDurationYears}
              onChange={(e) => setForm((p) => ({ ...p, studyDurationYears: e.target.value }))}
            >
              <option value="2">ТиПО · 2 года обучения</option>
              <option value="3">ТиПО · 3 года обучения</option>
            </select>
            <button type="submit" disabled={!canRegisterForm} className="ui-btn-primary mt-2 sm:col-span-2">
              {t("getTicket")}
            </button>
          </form>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Link
              to="/faq"
              className="flex items-center justify-center rounded-xl border-2 border-violet-200 bg-white py-3.5 text-center text-sm font-extrabold text-violet-950 shadow-sm transition hover:bg-violet-50 dark:border-white/15 dark:bg-slate-900 dark:text-sky-100 dark:hover:bg-white/10"
            >
              {t("openFaqPage")}
            </Link>
            <button
              type="button"
              disabled={!canRegisterForm}
              onClick={() => setBookingOpen(true)}
              className="rounded-xl border-2 border-indigo-200 bg-indigo-50 py-3.5 text-sm font-extrabold text-indigo-950 shadow-sm transition hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-100 dark:hover:bg-indigo-900/50"
            >
              {t("bookingButton")}
            </button>
          </div>
        </div>
      )}

      {missedReasonOpen && myTicket && myTicket.status === "MISSED" && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center p-3 sm:p-6">
          <div className="absolute inset-0 bg-slate-950/75 backdrop-blur-sm" aria-hidden />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-amber-200 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-slate-900">
            <div className="text-lg font-black text-violet-950 dark:text-white">{t("missedStudentTitle")}</div>
            <p className="mt-2 text-sm font-semibold leading-relaxed text-violet-800 dark:text-violet-300">{t("missedStudentBody")}</p>
            <textarea
              className="ui-input mt-4 min-h-[88px] w-full"
              placeholder={t("missedStudentPlaceholder")}
              value={missedReasonText}
              onChange={(e) => setMissedReasonText(e.target.value)}
            />
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void submitMissedFeedback(missedReasonText)}
                className="flex-1 rounded-xl bg-violet-600 px-4 py-3 text-sm font-black text-white hover:bg-violet-500"
              >
                {t("missedStudentSubmit")}
              </button>
              <button
                type="button"
                onClick={() => void submitMissedFeedback("")}
                className="rounded-xl border border-violet-200 px-4 py-3 text-sm font-bold text-violet-800 hover:bg-violet-50 dark:border-white/10 dark:text-violet-200"
              >
                {t("missedStudentSkip")}
              </button>
            </div>
          </div>
        </div>
      )}

      {schemeOpen && myTicket && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-6">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
            aria-label={t("close")}
            onClick={() => setSchemeOpen(false)}
          />
          <div className="relative z-10 flex max-h-[min(90vh,640px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-violet-100 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-900">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-violet-100 px-4 py-3 dark:border-white/10">
              <div className="min-w-0">
                <div className="text-sm font-black text-violet-950 dark:text-white">{t("officeSchemeTitle")}</div>
                <div className="mt-0.5 text-xs font-semibold leading-snug text-violet-600 dark:text-violet-300">
                  {myTicket.status === "WAITING"
                    ? t("officeSchemeWaitingHint")
                    : deskWindow != null
                      ? t("officeSchemeWindow").replace("{n}", String(deskWindow))
                      : t("officeSchemeDefaultHint")}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSchemeOpen(false)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-800 transition hover:bg-violet-200 dark:bg-white/10 dark:text-sky-100 dark:hover:bg-white/20"
                aria-label={t("close")}
              >
                <X className="h-5 w-5" strokeWidth={2.5} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <img
                src={schemeImageSrc}
                alt=""
                className="mx-auto w-full max-w-full rounded-lg object-contain"
              />
            </div>
          </div>
        </div>
      )}

      {bookingOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/55 backdrop-blur-sm"
            aria-label={t("close")}
            onClick={() => setBookingOpen(false)}
          />
          <div className="relative z-10 w-full max-w-md rounded-3xl border border-violet-100 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-slate-950">
            <div className="text-lg font-black text-violet-950 dark:text-white">{t("bookingModalTitle")}</div>
            <p className="mt-2 text-sm font-semibold text-violet-700 dark:text-violet-300">{t("bookingModalHint")}</p>
            {bookingOptions.length === 0 ? (
              <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                {t("bookingNoSlots")}
              </p>
            ) : (
              <select
                className="ui-input mt-4 w-full"
                value={bookingHm}
                onChange={(e) => setBookingHm(e.target.value)}
                required
              >
                {bookingOptions.map((hm) => (
                  <option key={hm} value={hm}>
                    {hm}
                  </option>
                ))}
              </select>
            )}
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                className="ui-btn-primary flex-1"
                disabled={bookingOptions.length === 0}
                onClick={() => void submitBooking()}
              >
                {t("bookingSubmit")}
              </button>
              <button
                type="button"
                className="flex-1 rounded-xl border border-violet-200 py-3 text-sm font-extrabold text-violet-800 dark:border-white/20 dark:text-sky-200"
                onClick={() => setBookingOpen(false)}
              >
                {t("close")}
              </button>
            </div>
          </div>
        </div>
      )}

      {reviewOpen && myTicket && myTicket.status === "DONE" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
          <div className="relative z-10 w-full max-w-md rounded-3xl border border-violet-100 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-slate-950">
            <div className="text-lg font-black text-violet-950 dark:text-white">{t("studentReviewTitle")}</div>
            {myTicket.student_comment ? (
              <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5">
                <div className="text-[11px] font-extrabold uppercase tracking-wide text-violet-700">
                  {t("studentCommentFromManager")}
                </div>
                <div className="mt-1 text-sm font-semibold text-violet-900">{myTicket.student_comment}</div>
              </div>
            ) : null}
            <div className="mt-3 text-sm font-semibold text-violet-700 dark:text-violet-300">{t("studentReviewStars")}</div>
            <div className="mt-2 flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setReviewStars(n)}
                  className={cn(
                    "text-3xl transition hover:scale-110",
                    n <= reviewStars
                      ? "text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.65)]"
                      : "text-amber-200/35 opacity-50"
                  )}
                  aria-label={`${n}`}
                >
                  ★
                </button>
              ))}
            </div>
            <label className="mt-4 block">
              <span className="text-xs font-extrabold text-violet-800 dark:text-violet-200">{t("studentReviewComment")}</span>
              <textarea
                className="ui-input mt-2 min-h-[80px] w-full"
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
              />
            </label>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                className="ui-btn-primary flex-1"
                onClick={() => void submitReview()}
                disabled={reviewSubmitting}
              >
                {t("studentReviewSubmit")}
              </button>
              <button
                type="button"
                className="flex-1 rounded-xl border border-violet-200 py-3 text-sm font-extrabold text-violet-800 dark:border-white/20 dark:text-sky-200"
                onClick={() => skipReview()}
                disabled={reviewSubmitting}
              >
                {t("studentReviewSkip")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
