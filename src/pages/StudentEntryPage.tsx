import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../i18n";

function hasLocalTicket() {
  const v = localStorage.getItem("uniq.ticketId");
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0;
}

export default function StudentEntryPage() {
  const { t } = useI18n();
  const nav = useNavigate();

  useEffect(() => {
    // If the student already has a saved ticket, don't block them on the entry screen.
    if (hasLocalTicket()) nav("/student", { replace: true });
  }, [nav]);

  return (
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
  );
}

