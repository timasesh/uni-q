import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../i18n";

function hasLocalTicket() {
  const v = localStorage.getItem("uniq.ticketId");
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0;
}

const STEPS = [
  { num: "1", titleKey: "howItWorksStep1Title", descKey: "howItWorksStep1Desc" },
  { num: "2", titleKey: "howItWorksStep2Title", descKey: "howItWorksStep2Desc" },
  { num: "3", titleKey: "howItWorksStep3Title", descKey: "howItWorksStep3Desc" },
  { num: "4", titleKey: "howItWorksStep4Title", descKey: "howItWorksStep4Desc" },
] as const;

export default function StudentEntryPage() {
  const { t } = useI18n();
  const nav = useNavigate();

  useEffect(() => {
    if (hasLocalTicket()) nav("/student", { replace: true });
  }, [nav]);

  return (
    <div className="space-y-5">
      <div className="ui-card p-7 dark:border-white/10 dark:bg-slate-900/50">
        <div className="ui-title dark:text-white">{t("studentEntryTitle")}</div>
        <div className="mt-1 ui-muted">{t("studentEntryHint")}</div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            className="rounded-xl border-2 border-slate-200 bg-white py-3.5 text-sm font-extrabold text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-white/15 dark:bg-slate-900 dark:text-sky-100 dark:hover:bg-white/10"
            onClick={() => {
              window.location.href = "/api/auth/microsoft/start";
            }}
          >
            {t("studentEntryMicrosoftBtn")}
          </button>

          <button type="button" className="ui-btn-primary py-3.5" onClick={() => nav("/student")}>
            {t("studentEntryContinueBtn")}
          </button>
        </div>
      </div>

      {/* Блок «Как пользоваться системой» */}
      <div className="ui-card p-6 dark:border-white/10 dark:bg-slate-900/50">
        <h2 className="text-base font-black text-violet-950 dark:text-white mb-4">
          {t("howItWorksTitle")}
        </h2>

        <div className="grid gap-3 sm:grid-cols-2">
          {STEPS.map(({ num, titleKey, descKey }) => (
            <div
              key={num}
              className="flex gap-3 rounded-xl border border-violet-100 bg-violet-50/60 p-4 dark:border-white/10 dark:bg-white/5"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-600 text-sm font-black text-white">
                {num}
              </div>
              <div>
                <div className="text-sm font-extrabold text-violet-950 dark:text-white">
                  {t(titleKey)}
                </div>
                <div className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                  {t(descKey)}
                </div>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-4 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-xs font-semibold text-violet-700 dark:border-white/10 dark:bg-white/5 dark:text-violet-300">
          💡 {t("howItWorksBookingHint")}
        </p>
      </div>
    </div>
  );
}

