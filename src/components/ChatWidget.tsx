import { useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle, Send, X } from "lucide-react";
import { useI18n } from "../i18n";
import { cn } from "../lib/cn";
import { AppLogo } from "../lib/brand";
import { fetchJSON, readJSON } from "../api";

type Msg = {
  id: string;
  role: "bot" | "user";
  text: string;
  source?: string | null;
  kbQuestionNorm?: string | null;
  userQuestion?: string | null;
  feedback?: -1 | 0 | 1;
  debug?: Record<string, unknown> | null;
};
const CHAT_HISTORY_KEY = "uniq.student.chat.history.v1";
const CHAT_DEBUG_KEY = "uniq.student.chat.debug.v1";

export default function ChatWidget() {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [sending, setSending] = useState(false);
  const [debugMode, setDebugMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem(CHAT_DEBUG_KEY) === "1";
    } catch {
      return false;
    }
  });
  const endRef = useRef<HTMLDivElement>(null);
  const seededWelcomeRef = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CHAT_HISTORY_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Msg[];
      if (!Array.isArray(parsed)) return;
      const normalized = parsed
        .filter((m) => m && (m.role === "user" || m.role === "bot") && typeof m.text === "string")
        .slice(-80)
        .map((m, i) => ({
          id: m.id || `h-${Date.now()}-${i}`,
          role: m.role,
          text: m.text,
          source: typeof m.source === "string" ? m.source : null,
          kbQuestionNorm: typeof m.kbQuestionNorm === "string" ? m.kbQuestionNorm : null,
          userQuestion: typeof m.userQuestion === "string" ? m.userQuestion : null,
          feedback: (m.feedback === 1 || m.feedback === -1 ? m.feedback : 0) as -1 | 0 | 1,
          debug: m.debug && typeof m.debug === "object" ? (m.debug as Record<string, unknown>) : null,
        }));
      if (normalized.length > 0) setMessages(normalized);
    } catch {
      // ignore invalid local storage payload
    }
  }, []);

  useEffect(() => {
    try {
      if (!messages.length) {
        localStorage.removeItem(CHAT_HISTORY_KEY);
        return;
      }
      localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(messages.slice(-80)));
    } catch {
      // ignore storage failures
    }
  }, [messages]);

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_DEBUG_KEY, debugMode ? "1" : "0");
    } catch {
      // ignore
    }
  }, [debugMode]);

  useEffect(() => {
    if (!open) return;
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open, sending]);

  useEffect(() => {
    if (!open) {
      seededWelcomeRef.current = false;
      return;
    }
    if (seededWelcomeRef.current) return;
    seededWelcomeRef.current = true;
    setMessages((m) =>
      m.length > 0 ? m : [{ id: `w-${lang}`, role: "bot", text: t("chatWidgetWelcome") }]
    );
  }, [open, lang, t]);

  const pushBot = (
    text: string,
    meta?: {
      source?: string | null;
      kbQuestionNorm?: string | null;
      userQuestion?: string | null;
      debug?: Record<string, unknown> | null;
    }
  ) => {
    setMessages((m) => [
      ...m,
      {
        id: `${Date.now()}-b`,
        role: "bot",
        text,
        source: meta?.source ?? null,
        kbQuestionNorm: meta?.kbQuestionNorm ?? null,
        userQuestion: meta?.userQuestion ?? null,
        feedback: 0,
        debug: meta?.debug ?? null,
      },
    ]);
  };

  const sendFeedback = async (msgId: string, helpful: -1 | 1) => {
    const msg = messages.find((m) => m.id === msgId && m.role === "bot");
    if (!msg) return;
    if (msg.feedback === helpful) return;
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, feedback: helpful } : m)));
    try {
      await fetchJSON("/api/student/chat/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userQuestion: msg.userQuestion || "",
          answer: msg.text,
          source: msg.source || "",
          kbQuestionNorm: msg.kbQuestionNorm || "",
          helpful,
        }),
      });
    } catch {
      // best-effort learning signal
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    const userMsg: Msg = { id: `${Date.now()}-u`, role: "user", text };
    setMessages((m) => [...m, userMsg]);
    setSending(true);

    const openAi: { role: "user" | "assistant"; content: string; source?: string; kbQuestionNorm?: string }[] = [
      ...messages,
      userMsg,
    ].map((m) => ({
      role: m.role === "user" ? ("user" as const) : ("assistant" as const),
      content: m.text,
      source: m.source ?? undefined,
      kbQuestionNorm: m.kbQuestionNorm ?? undefined,
    }));
    while (openAi.length > 0 && openAi[0]!.role === "assistant") {
      openAi.shift();
    }
    const apiMessages = openAi.slice(-24);

    try {
      const res = await fetchJSON("/api/student/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages, debug: debugMode }),
      });
      const js = (await readJSON<{
        reply?: string;
        error?: string;
        source?: string;
        kbQuestionNorm?: string | null;
        debug?: Record<string, unknown>;
      }>(res).catch(() => ({}))) as {
        reply?: string;
        error?: string;
        source?: string;
        kbQuestionNorm?: string | null;
        debug?: Record<string, unknown>;
      };
      if (!res.ok) {
        const code = js.error;
        if (code === "chat_unavailable") pushBot(t("chatWidgetErrorUnavailable"));
        else if (code === "chat_invalid") pushBot(t("chatWidgetErrorInvalid"));
        else pushBot(t("chatWidgetErrorUpstream"));
        return;
      }
      const reply = String(js.reply || "").trim();
      if (!reply) {
        pushBot(t("chatWidgetErrorUpstream"));
        return;
      }
      pushBot(reply, {
        source: js.source || null,
        kbQuestionNorm: js.kbQuestionNorm ?? null,
        userQuestion: text,
        debug: js.debug ?? null,
      });
    } catch {
      pushBot(t("chatWidgetErrorUpstream"));
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : setOpen(true))}
        className={cn(
          "fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-teal-600 text-white shadow-lg shadow-teal-600/35 ring-2 ring-white/30 transition hover:scale-105 hover:bg-teal-500 dark:ring-white/10",
          open && "pointer-events-none opacity-0"
        )}
        title={t("chatbotBtn")}
        aria-expanded={open}
        aria-controls="uniq-chat-panel"
      >
        <MessageCircle className="h-7 w-7" strokeWidth={2.2} aria-hidden />
        <span className="sr-only">{t("chatbotBtn")}</span>
      </button>

      {open && (
        <div
          id="uniq-chat-panel"
          role="dialog"
          aria-label={t("chatWidgetTitle")}
          className="fixed bottom-6 right-6 z-50 flex h-[min(520px,calc(100vh-5rem))] w-[min(100vw-1.5rem,380px)] flex-col overflow-hidden rounded-2xl border border-violet-200/80 bg-white shadow-2xl dark:border-white/15 dark:bg-slate-900"
        >
          <div className="flex items-center justify-between gap-2 border-b border-violet-100 bg-gradient-to-r from-teal-600 to-teal-700 px-4 py-3 dark:border-white/10">
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <div className="flex h-9 shrink-0 items-center rounded-lg bg-white/15 px-1 py-0.5 ring-1 ring-white/20">
                <AppLogo className="h-7 w-auto max-h-7 max-w-[88px] object-contain brightness-0 invert" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-black text-white">{t("chatWidgetTitle")}</div>
                <div className="truncate text-[11px] font-semibold text-teal-100">{t("chatWidgetSubtitle")}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setDebugMode((v) => !v)}
              className={cn(
                "rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-wide",
                debugMode ? "bg-amber-300 text-amber-950" : "bg-white/20 text-white"
              )}
              title="Режим отладки"
            >
              DBG
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25"
              aria-label={t("close")}
            >
              <X className="h-5 w-5" strokeWidth={2.2} />
            </button>
          </div>

          <div className="flex flex-1 flex-col gap-3 overflow-y-auto bg-violet-50/50 p-3 dark:bg-slate-950/50">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "max-w-[92%] rounded-2xl px-3.5 py-2.5 text-sm font-medium leading-relaxed shadow-sm",
                  msg.role === "bot"
                    ? "self-start rounded-bl-md bg-white text-slate-800 ring-1 ring-violet-100 dark:bg-slate-800 dark:text-slate-100 dark:ring-white/10"
                    : "self-end rounded-br-md bg-teal-600 text-white"
                )}
              >
                <div>{msg.text}</div>
                {msg.role === "bot" ? (
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void sendFeedback(msg.id, 1)}
                      className={cn(
                        "rounded-md px-2 py-1 text-xs font-extrabold transition",
                        msg.feedback === 1
                          ? "bg-emerald-500 text-white"
                          : "bg-violet-100 text-violet-900 hover:bg-violet-200 dark:bg-white/10 dark:text-sky-100 dark:hover:bg-white/20"
                      )}
                      title="Полезный ответ"
                    >
                      👍
                    </button>
                    <button
                      type="button"
                      onClick={() => void sendFeedback(msg.id, -1)}
                      className={cn(
                        "rounded-md px-2 py-1 text-xs font-extrabold transition",
                        msg.feedback === -1
                          ? "bg-rose-500 text-white"
                          : "bg-violet-100 text-violet-900 hover:bg-violet-200 dark:bg-white/10 dark:text-sky-100 dark:hover:bg-white/20"
                      )}
                      title="Неполезный ответ"
                    >
                      👎
                    </button>
                  </div>
                ) : null}
                {msg.role === "bot" && debugMode && msg.debug ? (
                  <pre className="mt-2 max-w-full overflow-auto rounded-md bg-black/20 p-2 text-[10px] leading-relaxed text-violet-100 dark:bg-black/30">
                    {JSON.stringify(msg.debug, null, 2)}
                  </pre>
                ) : null}
              </div>
            ))}
            {sending ? (
              <div className="flex items-center gap-2 self-start rounded-2xl rounded-bl-md bg-white px-3.5 py-2.5 text-sm font-semibold text-violet-700 ring-1 ring-violet-100 dark:bg-slate-800 dark:text-violet-200 dark:ring-white/10">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                {t("chatWidgetThinking")}
              </div>
            ) : null}
            <div ref={endRef} />
          </div>

          <form
            className="border-t border-violet-100 bg-white p-3 dark:border-white/10 dark:bg-slate-900"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t("chatWidgetPlaceholder")}
                className="ui-input min-h-[44px] flex-1 text-sm"
                autoComplete="off"
                disabled={sending}
              />
              <button
                type="submit"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-600 text-white shadow-md transition hover:bg-teal-500 disabled:opacity-40"
                disabled={!input.trim() || sending}
                aria-label={t("chatWidgetSend")}
              >
                <Send className="h-5 w-5" strokeWidth={2.2} />
              </button>
            </div>
            <p className="mt-2 text-[11px] font-semibold leading-snug text-violet-600 dark:text-violet-300">
              {t("chatWidgetFooter")}
            </p>
          </form>
        </div>
      )}
    </>
  );
}
