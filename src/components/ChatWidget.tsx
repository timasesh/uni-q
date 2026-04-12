import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, X } from "lucide-react";
import { useI18n } from "../i18n";
import { cn } from "../lib/cn";

const CHATBOT_URL = "https://t.me/uniq_advising_bot";

type Msg = { id: string; role: "bot" | "user"; text: string };

export default function ChatWidget() {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const seededWelcomeRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

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

  const pushBot = (text: string) => {
    setMessages((m) => [...m, { id: `${Date.now()}-b`, role: "bot", text }]);
  };

  const send = () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    setMessages((m) => [...m, { id: `${Date.now()}-u`, role: "user", text }]);
    void (async () => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        /* ignore */
      }
      window.open(CHATBOT_URL, "_blank", "noopener,noreferrer");
      pushBot(t("chatWidgetAfterSend"));
    })();
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
            <div className="min-w-0">
              <div className="truncate text-sm font-black text-white">{t("chatWidgetTitle")}</div>
              <div className="truncate text-[11px] font-semibold text-teal-100">{t("chatWidgetSubtitle")}</div>
            </div>
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
                {msg.text}
              </div>
            ))}
            <div ref={endRef} />
          </div>

          <form
            className="border-t border-violet-100 bg-white p-3 dark:border-white/10 dark:bg-slate-900"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t("chatWidgetPlaceholder")}
                className="ui-input min-h-[44px] flex-1 text-sm"
                autoComplete="off"
              />
              <button
                type="submit"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-600 text-white shadow-md transition hover:bg-teal-500 disabled:opacity-40"
                disabled={!input.trim()}
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
