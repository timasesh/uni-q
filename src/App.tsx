import { Route, Routes, useLocation } from "react-router-dom";
import StudentPage from "./pages/StudentPage";
import FaqPage from "./pages/FaqPage";
import ChatWidget from "./components/ChatWidget";
import AdvisorPage from "./pages/AdvisorPage";
import AdvisorSettingsPage from "./pages/AdvisorSettingsPage";
import AdminApp from "./admin/AdminApp";

import { useEffect, useState } from "react";
import { useI18n } from "./i18n";
import { useAdvisorContext } from "./context/AdvisorContext";
import AdvisorWorkTimer from "./components/AdvisorWorkTimer";

export default function App() {
  const loc = useLocation();
  const isAdvisor = loc.pathname.startsWith("/advisor");
  const { advisorId } = useAdvisorContext();
  const { t, lang, setLang } = useI18n();

  const [advisorDark, setAdvisorDark] = useState(false);

  useEffect(() => {
    if (!isAdvisor || advisorId == null) return;
    const k = `uniq.advisor.theme.${advisorId}`;
    let v = localStorage.getItem(k);
    if (v === null && localStorage.getItem("uniq.theme") === "dark") {
      localStorage.setItem(k, "dark");
      v = "dark";
    }
    setAdvisorDark(v === "dark");
  }, [isAdvisor, advisorId]);

  useEffect(() => {
    if (!isAdvisor || advisorId == null) return;
    localStorage.setItem(`uniq.advisor.theme.${advisorId}`, advisorDark ? "dark" : "light");
  }, [isAdvisor, advisorId, advisorDark]);

  const applyAdvisorDark = isAdvisor && advisorId != null && advisorDark;

  useEffect(() => {
    const root = document.documentElement;
    if (applyAdvisorDark) root.classList.add("dark");
    else root.classList.remove("dark");
  }, [applyAdvisorDark]);

  if (loc.pathname.startsWith("/admin")) {
    return <AdminApp />;
  }

  return (
    <div>
      <header className="sticky top-0 z-20 shadow-md shadow-violet-900/10 dark:shadow-black/40">
        <div className="bg-gradient-to-r from-violet-700 via-purple-700 to-indigo-700 dark:from-violet-950 dark:via-indigo-950 dark:to-slate-950">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20">
                <span className="text-lg font-black text-white">Q</span>
              </div>
              <div className="min-w-0 leading-tight">
                <div className="truncate text-base font-black tracking-tight text-white">uni-q</div>
                <div className="truncate text-[11px] font-medium text-violet-100">{t("appTagline")}</div>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {isAdvisor && advisorId != null && <AdvisorWorkTimer advisorId={advisorId} />}
              {!isAdvisor && (
                <label className="flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-2 py-1 backdrop-blur-sm">
                  <span className="sr-only">{t("langUi")}</span>
                  <select
                    value={lang}
                    onChange={(e) => setLang(e.target.value as "rus" | "eng" | "kaz")}
                    className="cursor-pointer bg-transparent text-xs font-extrabold text-white outline-none"
                    aria-label={t("langUi")}
                  >
                    <option value="rus" className="text-violet-950">
                      RUS
                    </option>
                    <option value="eng" className="text-violet-950">
                      ENG
                    </option>
                    <option value="kaz" className="text-violet-950">
                      KAZ
                    </option>
                  </select>
                </label>
              )}
              <div className="rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-extrabold text-white backdrop-blur-sm">
                {isAdvisor ? t("advisorPanel") : t("studentPanel")}
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="ui-shell">
        <Routes>
          <Route path="/" element={<StudentPage />} />
          <Route path="/faq" element={<FaqPage />} />
          <Route
            path="/advisor"
            element={<AdvisorPage advisorDark={advisorDark} setAdvisorDark={setAdvisorDark} />}
          />
          <Route path="/advisor/settings" element={<AdvisorSettingsPage />} />
        </Routes>
      </main>

      {(loc.pathname === "/" || loc.pathname === "/faq") && <ChatWidget />}
    </div>
  );
}
