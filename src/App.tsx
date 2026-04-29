import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Gamepad2 } from "lucide-react";
import StudentPage from "./pages/StudentPage";
import StudentEntryPage from "./pages/StudentEntryPage";
import FaqPage from "./pages/FaqPage";
import ChatWidget from "./components/ChatWidget";
import AdvisorPage from "./pages/AdvisorPage";
import AdvisorSettingsPage from "./pages/AdvisorSettingsPage";
import AdminApp from "./admin/AdminApp";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "./i18n";
import { useManagerContext } from "./context/ManagerContext";
import ManagerWorkTimer from "./components/ManagerWorkTimer";
import { AppLogo } from "./lib/brand";

export default function App() {
  const loc = useLocation();
  const isManager = loc.pathname.startsWith("/manager");
  const isAdmin = loc.pathname.startsWith("/admin");
  const { managerId } = useManagerContext();
  const { t, lang, setLang } = useI18n();
  const gameWindowRef = useRef<Window | null>(null);

  const [managerDark, setManagerDark] = useState(false);

  useEffect(() => {
    if (!isManager || managerId == null) return;
    const k = `uniq.manager.theme.${managerId}`;
    let v = localStorage.getItem(k);
    if (v === null) {
      const legacy = localStorage.getItem(`uniq.advisor.theme.${managerId}`);
      if (legacy === "dark" || legacy === "light") {
        localStorage.setItem(k, legacy);
        v = legacy;
      }
    }
    if (v === null && localStorage.getItem("uniq.theme") === "dark") {
      localStorage.setItem(k, "dark");
      v = "dark";
    }
    setManagerDark(v === "dark");
  }, [isManager, managerId]);

  useEffect(() => {
    if (!isManager || managerId == null) return;
    localStorage.setItem(`uniq.manager.theme.${managerId}`, managerDark ? "dark" : "light");
  }, [isManager, managerId, managerDark]);

  const applyManagerDark = isManager && managerId != null && managerDark;

  useEffect(() => {
    const root = document.documentElement;
    if (isAdmin) return;
    if (applyManagerDark) root.classList.add("dark");
    else root.classList.remove("dark");
  }, [applyManagerDark, isAdmin]);

  useEffect(() => {
    const onCalled = () => {
      if (gameWindowRef.current && !gameWindowRef.current.closed) {
        try {
          gameWindowRef.current.close();
        } catch {
          // ignore cross-window close issues
        }
      }
      gameWindowRef.current = null;
    };
    window.addEventListener("uniq:student-called", onCalled);
    return () => window.removeEventListener("uniq:student-called", onCalled);
  }, []);

  const openGame = () => {
    const w = window.open("/flappy-bird/", "uniq-flappy-bird", "width=460,height=760");
    if (w) gameWindowRef.current = w;
  };

  if (loc.pathname.startsWith("/admin")) {
    return <AdminApp />;
  }

  return (
    <div>
      <header className="sticky top-0 z-20 shadow-md shadow-violet-900/10 dark:shadow-black/40">
        <div className="bg-gradient-to-r from-violet-700 via-purple-700 to-indigo-700 dark:from-violet-950 dark:via-indigo-950 dark:to-slate-950">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 shrink-0 items-center justify-center rounded-xl bg-white/15 px-1.5 py-1 ring-1 ring-white/20">
                <AppLogo className="h-9 w-auto max-h-9 max-w-[120px] object-contain object-center" />
              </div>
              <div className="min-w-0 leading-tight">
                <div className="truncate text-base font-black tracking-tight text-white">uni-q</div>
                <div className="truncate text-[11px] font-medium text-violet-100">{t("appTagline")}</div>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {!isManager && (
                <button
                  type="button"
                  onClick={openGame}
                  className="inline-flex items-center justify-center rounded-full border border-white/25 bg-white/10 px-2.5 py-1.5 text-white backdrop-blur-sm hover:bg-white/20"
                  title="Мини-игра"
                  aria-label="Открыть мини-игру"
                >
                  <Gamepad2 size={16} />
                </button>
              )}
              {!isManager && (
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
                {isManager ? t("managerPanel") : t("studentPanel")}
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="ui-shell">
        {isManager && managerId != null && <ManagerWorkTimer managerId={managerId} hidden />}
        <Routes>
          <Route path="/" element={<StudentEntryPage />} />
          <Route path="/student" element={<StudentPage />} />
          <Route path="/faq" element={<FaqPage />} />
          <Route path="/advisor" element={<Navigate to="/manager" replace />} />
          <Route path="/advisor/settings" element={<Navigate to="/manager/settings" replace />} />
          <Route
            path="/manager"
            element={<AdvisorPage managerDark={managerDark} setManagerDark={setManagerDark} />}
          />
          <Route path="/manager/settings" element={<AdvisorSettingsPage />} />
        </Routes>
      </main>

      {(loc.pathname === "/" || loc.pathname === "/student" || loc.pathname === "/faq") && <ChatWidget />}
    </div>
  );
}
