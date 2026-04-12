import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { postStatsEvent } from "../api";
import { getFaqSections } from "../data/faq";
import { useI18n } from "../i18n";
import { cn } from "../lib/cn";
import { SCHEME_WINDOW_COUNT, schemeImagePathForWindow, schemeImagePathGeneral } from "../lib/deskWindow";

export default function FaqPage() {
  const { t, lang } = useI18n();
  const sections = getFaqSections(lang);
  const [openSection, setOpenSection] = useState<number | null>(null);
  const [openQuestion, setOpenQuestion] = useState<string | null>(null);
  const [schemeView, setSchemeView] = useState<"general" | 1 | 2 | 3 | 4 | 5>("general");

  useEffect(() => {
    const hasTicket = Boolean(localStorage.getItem("uniq.ticketId"));
    if (!hasTicket) void postStatsEvent("faq_no_queue");
  }, []);

  const toggleSection = (si: number) => {
    setOpenSection((prev) => (prev === si ? null : si));
    setOpenQuestion(null);
  };

  const toggleQuestion = (si: number, qi: number) => {
    const id = `${si}-${qi}`;
    setOpenQuestion((prev) => (prev === id ? null : id));
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-24">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to="/"
          className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-white px-4 py-2.5 text-sm font-extrabold text-violet-900 shadow-sm hover:bg-violet-50 dark:border-white/10 dark:bg-slate-900 dark:text-sky-100 dark:hover:bg-white/10"
        >
          ← {t("back")}
        </Link>
        <h1 className="text-2xl font-black tracking-tight text-violet-950 dark:text-white">{t("faqTitle")}</h1>
      </div>
      <p className="text-sm font-semibold text-violet-700 dark:text-violet-300">{t("faqIntro")}</p>

      <div className="space-y-3">
        {sections.map((section, si) => {
          const sectionOpen = openSection === si;
          return (
            <section
              key={si}
              className="overflow-hidden rounded-2xl border border-violet-100 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900/60"
            >
              <button
                type="button"
                onClick={() => toggleSection(si)}
                className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition hover:bg-violet-50/80 dark:hover:bg-white/5"
              >
                <h2 className="text-base font-black text-violet-950 dark:text-white">
                  {si + 1}. {section.title}
                </h2>
                <ChevronDown
                  className={cn(
                    "h-5 w-5 shrink-0 text-violet-600 transition-transform dark:text-violet-300",
                    sectionOpen && "rotate-180"
                  )}
                  aria-hidden
                />
              </button>
              {sectionOpen && (
                <ul className="space-y-2 border-t border-violet-100 px-3 pb-3 pt-2 dark:border-white/10">
                  {section.items.map((item, qi) => {
                    const id = `${si}-${qi}`;
                    const isOpen = openQuestion === id;
                    return (
                      <li
                        key={id}
                        className="rounded-xl border border-violet-50 bg-violet-50/40 dark:border-white/5 dark:bg-white/5"
                      >
                        <button
                          type="button"
                          onClick={() => toggleQuestion(si, qi)}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
                        >
                          <span className="text-sm font-extrabold text-violet-950 dark:text-sky-100">{item.q}</span>
                          <ChevronDown
                            className={cn(
                              "h-4 w-4 shrink-0 text-violet-600 transition-transform dark:text-violet-300",
                              isOpen && "rotate-180"
                            )}
                            aria-hidden
                          />
                        </button>
                        {isOpen && (
                          <div className="border-t border-violet-100 px-3 py-2.5 text-sm font-medium leading-relaxed text-slate-700 dark:border-white/10 dark:text-slate-300">
                            {item.a}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <section id="map" className="scroll-mt-24 rounded-2xl border border-violet-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-900/60">
        <h2 className="text-lg font-black text-violet-950 dark:text-white">{t("mapTitle")}</h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300">{t("mapBody")}</p>
        <div className="mt-4 overflow-hidden rounded-2xl border border-violet-200 bg-violet-50/50 dark:border-white/10 dark:bg-slate-800/40">
          <img
            src={schemeView === "general" ? schemeImagePathGeneral() : schemeImagePathForWindow(schemeView)}
            alt=""
            className="mx-auto block max-h-[min(70vh,720px)] w-full max-w-4xl object-contain"
          />
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {Array.from({ length: SCHEME_WINDOW_COUNT }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setSchemeView(n as 1 | 2 | 3 | 4 | 5)}
              className={cn(
                "min-w-[2.5rem] rounded-xl border px-3 py-2 text-sm font-black tabular-nums transition",
                schemeView === n
                  ? "border-violet-600 bg-violet-600 text-white shadow-md dark:border-sky-500 dark:bg-sky-600"
                  : "border-violet-200 bg-white text-violet-900 hover:bg-violet-50 dark:border-white/15 dark:bg-slate-800 dark:text-sky-100 dark:hover:bg-white/10"
              )}
            >
              {n}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSchemeView("general")}
            className={cn(
              "rounded-xl border px-4 py-2 text-sm font-black transition",
              schemeView === "general"
                ? "border-violet-600 bg-violet-600 text-white shadow-md dark:border-sky-500 dark:bg-sky-600"
                : "border-violet-200 bg-white text-violet-900 hover:bg-violet-50 dark:border-white/15 dark:bg-slate-800 dark:text-sky-100 dark:hover:bg-white/10"
            )}
          >
            {t("faqSchemeTab")}
          </button>
        </div>
      </section>
    </div>
  );
}
