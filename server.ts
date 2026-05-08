import cors from "cors";
import express from "express";
import session from "express-session";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import dns from "node:dns";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import path from "path";
import fs from "fs";
import xlsx from "xlsx";
import {
  fireVisitLogInsertPg,
  initPgHistoryPool,
  isPgHistoryEnabled,
  pgAdminVisitsBetween,
  pgAdvisorVisitRows,
  reportTzLabel,
} from "./server/pgHistory.js";
import {
  ensurePgCoreSchema,
  initPgCorePool,
  isPgCoreEnabled,
  pgAdminBookings,
  pgAdminLoad,
  pgAdminReviews,
  pgAdminSummary,
  pgAdminWaitTimes,
  pgCoreHasData,
  pgFaqNoQueue,
  pgRestoreCoreToSqlite,
  pgSyncCoreFromSqlite,
} from "./server/pgCore.js";
import { backendInstantMs } from "./src/lib/backendDateTime.ts";
import { parseStudyDuration } from "./src/lib/studyDuration.ts";

type TicketStatus = "WAITING" | "CALLED" | "IN_SERVICE" | "MISSED" | "DONE" | "CANCELLED";

type AdvisorScope = {
  assigned_schools_json: string; // JSON array
  assigned_languages_json: string | null; // JSON array, null/[] => any
  assigned_courses_json: string; // JSON array
  assigned_specialties_json: string | null; // JSON array
  assigned_study_years_json: string | null; // JSON array, null/[] => any
  assigned_school_scopes_json?: string | null; // JSON object by school
};

type StudentSession = {
  oid?: string | null;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
};

const PORT = Number(process.env.PORT || 5174);
const WEB_ORIGIN = process.env.WEB_ORIGIN || "http://localhost:5173";
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";
const NODE_ENV = process.env.NODE_ENV || "development";
/** Все данные приложения — один файл SQLite. В проде предпочитаем persistent disk (например Render: /var/data). */
function resolveSqlitePath(): string {
  if (process.env.SQLITE_PATH?.trim()) return process.env.SQLITE_PATH.trim();
  if (NODE_ENV === "production") {
    try {
      const renderDisk = "/var/data";
      if (fs.existsSync(renderDisk)) return path.join(renderDisk, "uni-q.sqlite");
    } catch {
      // ignore
    }
  }
  return path.join(process.cwd(), "data", "uni-q.sqlite");
}
const SQLITE_PATH = resolveSqlitePath();

const app = express();
if (process.env.TRUST_PROXY === "1" || NODE_ENV === "production") {
  app.set("trust proxy", 1);
}
const httpServer = createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: { origin: WEB_ORIGIN, credentials: true },
});

app.use(
  cors({
    origin: WEB_ORIGIN,
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.SESSION_COOKIE_SECURE === "0" ? false : NODE_ENV === "production",
    },
  })
);

// Мини-игра для студентов (открывается отдельной кнопкой в шапке).
const flappyDir = path.join(process.cwd(), "flappy bird");
if (fs.existsSync(flappyDir)) {
  app.use("/flappy-bird", express.static(flappyDir));
  app.get("/flappy-bird", (_req, res) => {
    res.sendFile(path.join(flappyDir, "index.html"));
  });
}

// --- DB (файл на диске; при необходимости SQLITE_PATH в .env; на Render см. DEPLOY-RENDER.md)
const dbDir = path.dirname(path.resolve(SQLITE_PATH));
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const db = new Database(SQLITE_PATH);
db.pragma("journal_mode = WAL");
/** Supabase direct host часто отдаёт AAAA; у Render часто нет маршрута до IPv6 → ENETUNREACH. */
if (process.env.DATABASE_DNS_IPV4_FIRST !== "0" && process.env.DATABASE_URL?.trim()) {
  try {
    dns.setDefaultResultOrder("ipv4first");
  } catch {
    /* Node < 17 */
  }
}
initPgHistoryPool();
initPgCorePool();

db.exec(`
CREATE TABLE IF NOT EXISTS queue_session (
  id INTEGER PRIMARY KEY,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS advisors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  faculty TEXT,
  department TEXT,
  desk_number TEXT,
  login TEXT UNIQUE,
  password_hash TEXT,
  assigned_schools_json TEXT,
  assigned_language TEXT,
  assigned_languages_json TEXT,
  assigned_courses_json TEXT,
  assigned_specialties_json TEXT,
  assigned_study_years_json TEXT,
  assigned_school_scopes_json TEXT
);

CREATE TABLE IF NOT EXISTS tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  queue_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'WAITING',
  student_first_name TEXT,
  student_last_name TEXT,
  school TEXT,
  specialty TEXT,
  specialty_code TEXT,
  language_section TEXT,
  course TEXT,
  study_duration_years INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  called_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  advisor_id INTEGER,
  route_advisor_id INTEGER,
  advisor_name TEXT,
  advisor_desk TEXT,
  advisor_faculty TEXT,
  advisor_department TEXT,
  comment TEXT,
  case_type TEXT,
  case_subtype TEXT,
  contact_type TEXT,
  student_comment TEXT,
  manager_attachment_name TEXT,
  manager_attachment_data_url TEXT,
  send_email_requested INTEGER
);

CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT
);

CREATE TABLE IF NOT EXISTS advisor_work_totals (
  advisor_id INTEGER PRIMARY KEY,
  total_ms INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS advisor_work_daily (
  advisor_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  work_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (advisor_id, day),
  FOREIGN KEY (advisor_id) REFERENCES advisors(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ticket_reviews (
  ticket_id INTEGER PRIMARY KEY,
  stars INTEGER NOT NULL,
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS stats_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  meta TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chat_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_question TEXT,
  user_question_norm TEXT,
  answer_text TEXT,
  kb_question_norm TEXT,
  source TEXT,
  helpful INTEGER NOT NULL
);
`);

function migrateDb() {
  const ticketCols = db.prepare("PRAGMA table_info(tickets)").all() as { name: string }[];
  const ticketNames = new Set(ticketCols.map((c) => c.name));
  if (!ticketNames.has("preferred_slot_at")) {
    db.exec("ALTER TABLE tickets ADD COLUMN preferred_slot_at TEXT");
  }
  if (!ticketNames.has("missed_student_note")) {
    db.exec("ALTER TABLE tickets ADD COLUMN missed_student_note TEXT");
  }
  if (!ticketNames.has("student_comment")) {
    db.exec("ALTER TABLE tickets ADD COLUMN student_comment TEXT");
  }
  if (!ticketNames.has("study_duration_years")) {
    db.exec("ALTER TABLE tickets ADD COLUMN study_duration_years INTEGER");
  }
  if (!ticketNames.has("route_advisor_id")) {
    db.exec("ALTER TABLE tickets ADD COLUMN route_advisor_id INTEGER");
  }
  if (!ticketNames.has("manager_attachment_name")) {
    db.exec("ALTER TABLE tickets ADD COLUMN manager_attachment_name TEXT");
  }
  if (!ticketNames.has("manager_attachment_data_url")) {
    db.exec("ALTER TABLE tickets ADD COLUMN manager_attachment_data_url TEXT");
  }
  if (!ticketNames.has("send_email_requested")) {
    db.exec("ALTER TABLE tickets ADD COLUMN send_email_requested INTEGER");
  }
  if (!ticketNames.has("case_subtype")) {
    db.exec("ALTER TABLE tickets ADD COLUMN case_subtype TEXT");
  }
  if (!ticketNames.has("contact_type")) {
    db.exec("ALTER TABLE tickets ADD COLUMN contact_type TEXT");
  }
  const advisorCols = db.prepare("PRAGMA table_info(advisors)").all() as { name: string }[];
  const advisorNames = new Set(advisorCols.map((c) => c.name));
  if (!advisorNames.has("reception_open")) {
    db.exec("ALTER TABLE advisors ADD COLUMN reception_open INTEGER NOT NULL DEFAULT 1");
  }
  if (!advisorNames.has("assigned_study_years_json")) {
    db.exec("ALTER TABLE advisors ADD COLUMN assigned_study_years_json TEXT");
  }
  if (!advisorNames.has("assigned_school_scopes_json")) {
    db.exec("ALTER TABLE advisors ADD COLUMN assigned_school_scopes_json TEXT");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS advisor_work_daily (
      advisor_id INTEGER NOT NULL,
      day TEXT NOT NULL,
      work_ms INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (advisor_id, day),
      FOREIGN KEY (advisor_id) REFERENCES advisors(id) ON DELETE CASCADE
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ticket_visit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      advisor_id INTEGER,
      queue_number INTEGER NOT NULL,
      status TEXT NOT NULL,
      student_first_name TEXT,
      student_last_name TEXT,
      school TEXT,
      specialty TEXT,
      language_section TEXT,
      course TEXT,
      created_at TEXT,
      called_at TEXT,
      started_at TEXT,
      finished_at TEXT,
      advisor_name TEXT,
      advisor_desk TEXT,
      comment TEXT,
      case_type TEXT,
      is_repeat INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      user_question TEXT,
      user_question_norm TEXT,
      answer_text TEXT,
      kb_question_norm TEXT,
      source TEXT,
      helpful INTEGER NOT NULL
    );
  `);
  const visitLogCount = db.prepare("SELECT COUNT(*) as c FROM ticket_visit_log").get() as { c: number };
  if (visitLogCount.c === 0) {
    const backfill = db.prepare(
      `INSERT INTO ticket_visit_log (
         ticket_id, advisor_id, queue_number, status,
         student_first_name, student_last_name, school, specialty, language_section, course,
         created_at, called_at, started_at, finished_at,
         advisor_name, advisor_desk, comment, case_type, is_repeat
       ) VALUES (
         @id, @advisor_id, @queue_number, @status,
         @student_first_name, @student_last_name, @school, @specialty, @language_section, @course,
         @created_at, @called_at, @started_at, @finished_at,
         @advisor_name, @advisor_desk, @comment, @case_type, 0
       )`
    );
    const terminals = db
      .prepare(
        `SELECT * FROM tickets
         WHERE status IN ('DONE','MISSED','CANCELLED') AND finished_at IS NOT NULL AND advisor_id IS NOT NULL`
      )
      .all() as any[];
    for (const t of terminals) backfill.run(t);
  }
}

function ensureSeed() {
  // По умолчанию сотрудников не создаём. Создание — только через админ-панель.
  const s = db.prepare("SELECT 1 as ok FROM queue_session WHERE id = 1").get() as { ok: 1 } | undefined;
  if (!s) db.prepare("INSERT INTO queue_session (id, is_active) VALUES (1, 1)").run();
}
ensureSeed();
migrateDb();

function ensureAdminSeed() {
  const ensureAdmin = (login: string, password: string, name: string) => {
    const has = db
      .prepare("SELECT 1 as ok FROM admin_users WHERE login = ?")
      .get(login) as { ok: 1 } | undefined;
    if (!has) {
      db.prepare(`INSERT INTO admin_users (login, password_hash, name) VALUES (?, ?, ?)`).run(
        login,
        bcrypt.hashSync(password, 10),
        name
      );
    }
  };

  // Админ от вас (логин = email)
  ensureAdmin("S.Mussa@almau.edu.kz", "admin2026", "Мұса Самал");
  ensureAdmin("g.duisenbek@almau.edu.kz", "admin2026", "Дүйсенбек Гүлсана Мұханқызы");
}
ensureAdminSeed();

function ensureManagerSeed() {
  const ensureManager = (login: string, password: string, name: string) => {
    const has = db.prepare("SELECT 1 as ok FROM advisors WHERE login = ?").get(login) as { ok: 1 } | undefined;
    if (has) return;
    db.prepare(
      `INSERT INTO advisors (
         name, faculty, department, desk_number, login, password_hash,
         assigned_schools_json, assigned_language, assigned_languages_json, assigned_courses_json, assigned_specialties_json, assigned_study_years_json,
         reception_open
       ) VALUES (?, NULL, NULL, NULL, ?, ?, '[]', NULL, NULL, '[1,2,3,4]', NULL, NULL, 1)`
    ).run(name, login, bcrypt.hashSync(password, 10));
  };

  // Seed AlmaU managers (login = email). Passwords can be changed later in admin panel if needed.
  ensureManager("d.aubakirova@almau.edu.kz", "almau2026", "Аубакирова Дамира");
  ensureManager("s.kussainova@almau.edu.kz", "almau2026", "Кусайнова Шолпан");
  ensureManager("s.akhmetova@almau.edu.kz", "almau2026", "Ахметова Салтанат");
  ensureManager("a.omar@almau.edu.kz", "almau2026", "Омар Айдана");
  ensureManager("a.zhauynger@almau.edu.kz", "almau2026", "Жауынгер Әлия");
}
ensureManagerSeed();

let pgCoreSyncTimer: NodeJS.Timeout | null = null;
let pgCoreSyncRunning = false;
let pgCoreSyncPending = false;

function schedulePgCoreSync() {
  if (!isPgCoreEnabled()) return;
  pgCoreSyncPending = true;
  if (pgCoreSyncTimer) return;
  pgCoreSyncTimer = setTimeout(async () => {
    pgCoreSyncTimer = null;
    if (pgCoreSyncRunning) return;
    pgCoreSyncRunning = true;
    try {
      while (pgCoreSyncPending) {
        pgCoreSyncPending = false;
        await pgSyncCoreFromSqlite(db);
      }
    } catch (e) {
      console.error("[pg core sync]", e);
    } finally {
      pgCoreSyncRunning = false;
    }
  }, 250);
}

async function flushPgCoreSyncNow() {
  if (!isPgCoreEnabled()) return;
  if (pgCoreSyncTimer) {
    clearTimeout(pgCoreSyncTimer);
    pgCoreSyncTimer = null;
  }
  pgCoreSyncPending = false;
  try {
    await pgSyncCoreFromSqlite(db);
    console.log("[pg core] flushed snapshot to PostgreSQL");
  } catch (e) {
    console.error("[pg core flush]", e);
  }
}

function countWords(text: string | null | undefined): number {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/** Согласовано с клиентом `parseDeskWindowNumber`: номер окна 1…6 из поля стола. */
function deskWindowFromDb(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const m = String(raw).match(/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1 || n > 6) return null;
  return n;
}

function requireManager(req: express.Request, res: express.Response, next: express.NextFunction) {
  const s = req.session as any;
  let managerId = s.managerId as number | undefined;
  if (managerId == null && s.advisorId != null) {
    managerId = Number(s.advisorId);
    s.managerId = managerId;
    delete s.advisorId;
  }
  if (!managerId) return res.status(401).json({ error: "Не авторизован" });
  next();
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const adminId = (req.session as any).adminId as number | undefined;
  if (!adminId) return res.status(401).json({ error: "Нет доступа администратора" });
  next();
}

function getQueueSession() {
  const row = db
    .prepare("SELECT id, is_active, created_at FROM queue_session WHERE id = 1")
    .get() as { id: number; is_active: number; created_at: string };
  return { id: row.id, is_active: Boolean(row.is_active), created_at: row.created_at };
}

function nextQueueNumber(): number {
  const row = db.prepare("SELECT COALESCE(MAX(queue_number), 0) as m FROM tickets").get() as { m: number };
  return row.m + 1;
}

function formatQueueNumber(n: number): string {
  return String(n).padStart(3, "0");
}

function insertVisitLogFromTicket(t: any, isRepeat: number) {
  db.prepare(
    `INSERT INTO ticket_visit_log (
       ticket_id, advisor_id, queue_number, status,
       student_first_name, student_last_name, school, specialty, language_section, course,
       created_at, called_at, started_at, finished_at,
       advisor_name, advisor_desk, comment, case_type, is_repeat
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    t.id,
    t.advisor_id ?? null,
    t.queue_number,
    t.status,
    t.student_first_name ?? null,
    t.student_last_name ?? null,
    t.school ?? null,
    t.specialty ?? null,
    t.language_section ?? null,
    t.course ?? null,
    t.created_at ?? null,
    t.called_at ?? null,
    t.started_at ?? null,
    t.finished_at ?? null,
    t.advisor_name ?? null,
    t.advisor_desk ?? null,
    t.comment ?? null,
    t.case_type ?? null,
    isRepeat ? 1 : 0
  );
  fireVisitLogInsertPg(t as Record<string, unknown>, isRepeat);
}

function minutesBetweenTimestamps(a: unknown, b: unknown): number | null {
  const t0 = backendInstantMs(a);
  const t1 = backendInstantMs(b);
  if (t0 == null || t1 == null) return null;
  const mins = (t1 - t0) / 60000;
  if (!Number.isFinite(mins) || mins < 0) return null;
  if (mins > 0 && mins < 1) return 1;
  return Math.round(mins);
}

function reopenEligibleForLogRow(logFinishedAt: unknown, ticketRow: { status?: string; finished_at?: unknown } | undefined): number {
  if (!ticketRow) return 0;
  const st = String(ticketRow.status || "");
  if (!["DONE", "MISSED"].includes(st)) return 0;
  const lf = String(logFinishedAt ?? "");
  const tf = String(ticketRow.finished_at ?? "");
  if (!lf || !tf || lf !== tf) return 0;
  const fin = backendInstantMs(tf);
  if (fin == null) return 0;
  const mins = (Date.now() - fin) / (60 * 1000);
  return mins <= 60 && mins >= 0 ? 1 : 0;
}

function parseYmdParam(s: string): string | null {
  const t = String(s || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

const ADMIN_STATS_PG_TIMEOUT_MS = Number(process.env.ADMIN_STATS_PG_TIMEOUT_MS || 1800);

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: timeout ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fastPg<T>(label: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await withTimeout(run(), ADMIN_STATS_PG_TIMEOUT_MS, label);
  } catch (e) {
    console.warn(`[${label}] fast fallback`, e);
    return null;
  }
}

function parseCourse(course: string | null | undefined): number | null {
  if (!course) return null;
  const m = String(course).match(/\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** Список менеджеров для расчёта маршрутизации талонов (кэш на один снимок очереди). */
function advisorsRowsForRouting(): any[] {
  return db
    .prepare(
      `SELECT id, reception_open, assigned_schools_json, assigned_languages_json, assigned_courses_json, assigned_specialties_json
              , assigned_study_years_json, assigned_school_scopes_json
       FROM advisors`
    )
    .all() as any[];
}

/**
 * Один «владелец» WAITING-талона среди менеджеров с открытой записью и подходящей зоной,
 * чтобы талон не отображался у нескольких сотрудников сразу (при пересечении зон или пустом списке школ).
 * Правило: минимальный id среди подходящих.
 */
function pickRouteAdvisorIdForTicket(ticket: any, advisorRows: any[]): number | null {
  let best: number | null = null;
  for (const a of advisorRows) {
    if (Number(a.reception_open) === 0) continue;
    const scope: AdvisorScope = {
      assigned_schools_json: a.assigned_schools_json ?? "[]",
      assigned_languages_json: a.assigned_languages_json ?? null,
      assigned_courses_json: a.assigned_courses_json ?? "[1,2,3,4]",
      assigned_specialties_json: a.assigned_specialties_json ?? null,
      assigned_study_years_json: a.assigned_study_years_json ?? null,
      assigned_school_scopes_json: a.assigned_school_scopes_json ?? null,
    };
    if (!ticketMatchesScope(ticket, scope)) continue;
    const id = Number(a.id);
    if (!Number.isFinite(id)) continue;
    if (best === null || id < best) best = id;
  }
  return best;
}

function visibleAdvisorIdsForTicket(ticket: any, advisorRows: any[]): number[] {
  const ids: number[] = [];
  for (const a of advisorRows) {
    if (Number(a.reception_open) === 0) continue;
    const scope: AdvisorScope = {
      assigned_schools_json: a.assigned_schools_json ?? "[]",
      assigned_languages_json: a.assigned_languages_json ?? null,
      assigned_courses_json: a.assigned_courses_json ?? "[1,2,3,4]",
      assigned_specialties_json: a.assigned_specialties_json ?? null,
      assigned_study_years_json: a.assigned_study_years_json ?? null,
      assigned_school_scopes_json: a.assigned_school_scopes_json ?? null,
    };
    if (!ticketMatchesScope(ticket, scope)) continue;
    const id = Number(a.id);
    if (!Number.isFinite(id)) continue;
    ids.push(id);
  }
  return ids;
}

function ensureRouteOwnersForWaitingTickets() {
  const waiting = db.prepare("SELECT id, school, language_section, course, specialty_code, study_duration_years FROM tickets WHERE status = 'WAITING' AND route_advisor_id IS NULL").all() as any[];
  if (waiting.length === 0) return;
  const advisors = advisorsRowsForRouting();
  const upd = db.prepare("UPDATE tickets SET route_advisor_id = ? WHERE id = ?");
  for (const t of waiting) {
    const rid = pickRouteAdvisorIdForTicket(t, advisors);
    upd.run(rid, t.id);
  }
}

function recomputeRouteOwnersForWaitingTickets() {
  const waiting = db
    .prepare("SELECT id, school, language_section, course, specialty_code, study_duration_years FROM tickets WHERE status = 'WAITING'")
    .all() as any[];
  const advisors = advisorsRowsForRouting();
  const upd = db.prepare("UPDATE tickets SET route_advisor_id = ? WHERE id = ?");
  for (const t of waiting) {
    const rid = pickRouteAdvisorIdForTicket(t, advisors);
    upd.run(rid, t.id);
  }
}

type SchoolScopedFilters = {
  langs: string[] | null;
  studyYears: number[] | null;
  courses: number[] | null;
  specialtyCodes: string[] | null;
};

function parseSchoolScopedFilters(raw: string | null | undefined): Record<string, SchoolScopedFilters> {
  const out: Record<string, SchoolScopedFilters> = {};
  if (!raw) return out;
  try {
    const obj = JSON.parse(raw) as Record<string, any>;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return out;
    for (const [school, cfg] of Object.entries(obj)) {
      if (!cfg || typeof cfg !== "object") continue;
      const langRaw = Array.isArray((cfg as any).langs) ? (cfg as any).langs : [];
      const langs = langRaw.map((x: any) => String(x).toLowerCase()).filter((x: string) => x.length > 0);
      const yearsRaw = Array.isArray((cfg as any).studyYears) ? (cfg as any).studyYears : [];
      const studyYears = yearsRaw.map((x: any) => parseStudyDuration(x)).filter((n: any): n is number => n != null);
      const coursesRaw = Array.isArray((cfg as any).courses) ? (cfg as any).courses : [];
      const courses = coursesRaw
        .map((x: any) => Number(x))
        .filter((n: number) => Number.isFinite(n) && n >= 1 && n <= 4);
      const specsRaw = Array.isArray((cfg as any).specialtyCodes) ? (cfg as any).specialtyCodes : [];
      const specialtyCodes = specsRaw.map((x: any) => String(x)).filter((s: string) => s.length > 0);
      out[school] = {
        langs: langs.length > 0 ? langs : null,
        studyYears: studyYears.length > 0 ? studyYears : null,
        courses: courses.length > 0 ? courses : null,
        specialtyCodes: specialtyCodes.length > 0 ? specialtyCodes : null,
      };
    }
  } catch {
    return out;
  }
  return out;
}

function ticketMatchesScope(ticket: any, scope: AdvisorScope): boolean {
  const norm = (s: unknown) =>
    String(s ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  let schools: string[] = [];
  let langs: string[] | null = null;
  let courses: number[] = [1, 2, 3, 4];
  let specs: string[] | null = null;
  let studyYears: number[] | null = null;
  let perSchool: Record<string, SchoolScopedFilters> = {};
  try {
    schools = JSON.parse(scope.assigned_schools_json || "[]");
  } catch {
    schools = [];
  }
  try {
    const j = scope.assigned_languages_json ? JSON.parse(scope.assigned_languages_json) : null;
    if (Array.isArray(j) && j.length > 0) langs = j.map((x) => String(x).toLowerCase());
  } catch {
    langs = null;
  }
  try {
    const c = JSON.parse(scope.assigned_courses_json || "[1,2,3,4]");
    if (Array.isArray(c) && c.length > 0) courses = c.map((x) => Number(x)).filter((n) => n >= 1 && n <= 4);
  } catch {
    courses = [1, 2, 3, 4];
  }
  try {
    const s = scope.assigned_specialties_json ? JSON.parse(scope.assigned_specialties_json) : null;
    if (Array.isArray(s) && s.length > 0) specs = s.map((x) => String(x));
  } catch {
    specs = null;
  }
  try {
    const y = scope.assigned_study_years_json ? JSON.parse(scope.assigned_study_years_json) : null;
    if (Array.isArray(y) && y.length > 0) {
      const ys = y
        .map((x) => parseStudyDuration(x))
        .filter((n): n is number => n != null);
      if (ys.length > 0) studyYears = ys;
    }
  } catch {
    studyYears = null;
  }
  perSchool = parseSchoolScopedFilters(scope.assigned_school_scopes_json);

  const school = String(ticket.school || ticket.faculty || "");
  if (schools.length > 0) {
    if (!school) return false;
    const schoolN = norm(school);
    const allowed = new Set(schools.map((x) => norm(x)));
    if (!allowed.has(schoolN)) return false;
  }
  const schoolScoped = Object.entries(perSchool).find(([k]) => norm(k) === norm(school))?.[1];
  if (schoolScoped?.langs && schoolScoped.langs.length > 0) langs = schoolScoped.langs;
  if (schoolScoped?.studyYears && schoolScoped.studyYears.length > 0) studyYears = schoolScoped.studyYears;
  if (schoolScoped?.courses && schoolScoped.courses.length > 0) courses = schoolScoped.courses;
  if (schoolScoped?.specialtyCodes && schoolScoped.specialtyCodes.length > 0) specs = schoolScoped.specialtyCodes;

  if (langs && langs.length > 0) {
    const lang = String(ticket.language_section || "").toLowerCase();
    if (!langs.includes(lang) && !langs.includes("any")) return false;
  }
  const cn = parseCourse(ticket.course);
  if (cn == null || !courses.includes(cn)) return false;
  if (specs && specs.length > 0) {
    const code = String(ticket.specialty_code || "");
    if (!code || !specs.includes(code)) return false;
  }
  if (studyYears && studyYears.length > 0) {
    const dur = Number(ticket.study_duration_years);
    if (!Number.isFinite(dur) || !studyYears.includes(dur)) return false;
  }
  return true;
}

/** Есть ли открытая запись хотя бы у одного менеджера, подходящего по профилю. */
function registrationOpenForStudent(body: {
  school?: string;
  language_section?: string;
  course?: string;
  specialty_code?: string;
  study_duration_years?: number | string;
}): { open: boolean; matchesAny: boolean } {
  const pseudo = {
    school: String(body.school || "").trim(),
    language_section: String(body.language_section || "").trim(),
    course: String(body.course || "").trim(),
    specialty_code: String(body.specialty_code || "").trim(),
    study_duration_years: parseStudyDuration(body.study_duration_years),
  };
  const advisors = db
    .prepare(
      `SELECT id, reception_open, assigned_schools_json, assigned_languages_json, assigned_courses_json, assigned_specialties_json, assigned_study_years_json, assigned_school_scopes_json
       FROM advisors`
    )
    .all() as any[];
  let matchesAny = false;
  let anyOpen = false;
  for (const a of advisors) {
    const scope: AdvisorScope = {
      assigned_schools_json: a.assigned_schools_json ?? "[]",
      assigned_languages_json: a.assigned_languages_json ?? null,
      assigned_courses_json: a.assigned_courses_json ?? "[1,2,3,4]",
      assigned_specialties_json: a.assigned_specialties_json ?? null,
      assigned_study_years_json: a.assigned_study_years_json ?? null,
      assigned_school_scopes_json: a.assigned_school_scopes_json ?? null,
    };
    if (ticketMatchesScope(pseudo, scope)) {
      matchesAny = true;
      if (Number(a.reception_open) !== 0) anyOpen = true;
    }
  }
  return { open: anyOpen, matchesAny };
}

/** Вызов разрешён, если брони нет или наступило/прошло время слота. */
function bookingCallableNow(preferred_slot_at: unknown, now: Date = new Date()): boolean {
  if (preferred_slot_at == null) return true;
  const raw = String(preferred_slot_at).trim();
  if (raw === "") return true;
  const t = backendInstantMs(raw);
  if (t == null) return false;
  return t <= now.getTime();
}

function computeEstimatedMinutes(newTicket: any): number {
  const waiting = db
    .prepare("SELECT * FROM tickets WHERE status = 'WAITING' ORDER BY queue_number ASC")
    .all() as any[];

  const sameLineAhead = waiting.filter((t) => t.queue_number < newTicket.queue_number).filter((t) => {
    // estimate per "virtual line": school+lang+course+spec_code (spec optional)
    return (
      String(t.school || "") === String(newTicket.school || "") &&
      String(t.language_section || "").toLowerCase() === String(newTicket.language_section || "").toLowerCase() &&
      parseCourse(t.course) === parseCourse(newTicket.course) &&
      String(t.specialty_code || "") === String(newTicket.specialty_code || "")
    );
  });
  // 7 min per student baseline
  return Math.max(3, sameLineAhead.length * 7);
}

function getLiveQueue() {
  const sessionState = getQueueSession();
  const advisors = advisorsRowsForRouting();
  const tickets = db
    .prepare(
      `SELECT id, queue_number, status, school, specialty, specialty_code, language_section, course,
              study_duration_years,
              student_first_name, student_last_name,
              advisor_id, route_advisor_id, advisor_name, advisor_desk, advisor_faculty, advisor_department,
              comment, case_type, student_comment, preferred_slot_at, created_at
       FROM tickets
       WHERE status IN ('WAITING','CALLED','IN_SERVICE')
       ORDER BY
         CASE status WHEN 'WAITING' THEN 0 ELSE 1 END,
         CASE WHEN status = 'WAITING' AND preferred_slot_at IS NOT NULL THEN preferred_slot_at ELSE '9999-12-31' END ASC,
         queue_number ASC`
    )
    .all() as any[];

  return {
    session: sessionState,
    tickets: tickets.map((t) => ({
      ...t,
      formatted_number: formatQueueNumber(t.queue_number),
      route_advisor_id: t.status === "WAITING" ? (t.route_advisor_id ?? null) : null,
      visible_manager_ids: t.status === "WAITING" ? visibleAdvisorIdsForTicket(t, advisors) : null,
    })),
  };
}

function broadcastQueue() {
  io.emit("queue:update", getLiveQueue());
}

// --- API
app.get("/api/session", (_req, res) => res.json(getQueueSession()));
app.post("/api/session/start", requireManager, (_req, res) => {
  db.prepare("UPDATE queue_session SET is_active = 1 WHERE id = 1").run();
  schedulePgCoreSync();
  broadcastQueue();
  res.json(getQueueSession());
});
app.post("/api/session/stop", requireManager, (_req, res) => {
  db.prepare("UPDATE queue_session SET is_active = 0 WHERE id = 1").run();
  schedulePgCoreSync();
  broadcastQueue();
  res.json(getQueueSession());
});

/** Проверка: открыта ли запись для выбранного профиля (школа · язык · курс · спец.). */
app.post("/api/registration/check", (req, res) => {
  const { school, specialtyCode, languageSection, course, studyDurationYears } = (req.body || {}) as Record<string, unknown>;
  const result = registrationOpenForStudent({
    school: String(school || ""),
    specialty_code: String(specialtyCode || ""),
    language_section: String(languageSection || ""),
    course: String(course || ""),
    study_duration_years: parseStudyDuration(studyDurationYears) ?? undefined,
  });
  res.json(result);
});

/** Чат-помощник студента: прокси к NVIDIA NIM (OpenAI-совместимый API). Ключ только на сервере: UNIQ_NVIDIA_API_KEY. */
const UNIQ_NVIDIA_API_KEY = String(process.env.UNIQ_NVIDIA_API_KEY || "").trim();
const UNIQ_NVIDIA_CHAT_MODEL = String(process.env.UNIQ_NVIDIA_CHAT_MODEL || "nvidia/nvidia-nemotron-nano-9b-v2").trim();
const UNIQ_NVIDIA_API_BASE = String(process.env.UNIQ_NVIDIA_API_BASE || "https://integrate.api.nvidia.com/v1").replace(/\/$/, "");
const UNIQ_CHAT_KB_XLSX_PATH = String(process.env.UNIQ_CHAT_KB_XLSX_PATH || path.join(process.cwd(), "chat_bot", "1300_вопросов_от_студентов_для_базы_данных.xlsx")).trim();
const UNIQ_CHAT_KB_MAX_MATCHES = Math.min(8, Math.max(1, Number(process.env.UNIQ_CHAT_KB_MAX_MATCHES || 5)));
const UNIQ_CHAT_DEBUG = String(process.env.UNIQ_CHAT_DEBUG || "0") === "1";
const STUDENT_CHAT_SYSTEM = `Role: You are an expert academic assistant of the university consultation center (uni-q), working with the local KB file "1300_вопросов_от_студентов_для_базы_данных.xlsx".

Main goal:
- Help students solve real issues using KB data as a foundation for clear and useful консультации.
- Do not behave like an auto-responder.

Core rules:
1) Context analysis:
- Never copy KB text verbatim.
- Analyze matched official answer(s), extract the essence, and paraphrase in clear student-friendly language.
- If the answer contains multiple actions, transform them into a logical algorithm.

2) Clarifications:
- If user question is incomplete, ask 1 concise clarifying question when needed.
- If KB implies multiple scenarios (e.g., technical issue vs registration window), explain the difference and help identify the likely case.

3) No technical category labels:
- Never start with tags like "[Регистрация]" or "Категория: ...".

4) Structure and formatting:
- Use readable blocks with short headings.
- Use **bold** for key terms, deadlines, and department names.
- Use bullet lists for causes/documents.
- Use numbered lists for step-by-step actions.
- Use separators "---" between major blocks when helpful.
- Use light emoji navigation (e.g., 📍, 📧, 🔐) moderately.

5) Actionable ending:
- Always finish with a short practical summary: where to go and what to prepare.

Response algorithm:
1. Brief acknowledgement of the problem.
2. Main solution first.
3. Fallbacks/nuances if it doesn't work.
4. Responsible department/contact direction.
5. Final call-to-action summary.

Safety and truthfulness:
- Prioritize LOCAL_KB_MATCHES when provided.
- Do not invent policies or requirements that are absent from relevant KB matches.
- If no relevant KB match exists, say so explicitly and route to consultation center/Student Service Centre.
- If personal records, private data, or account-specific actions are needed, direct student to staff desk/live queue.

Language:
- Reply in the same language as the student's last message (Russian/Kazakh/English), default Russian.
`;

type ChatKbEntry = {
  category: string;
  question: string;
  answer: string;
  qNorm: string;
  qTokens: Set<string>;
  qTrigrams: Set<string>;
  aNorm: string;
  aTokens: Set<string>;
  aTrigrams: Set<string>;
};
let chatKbCache: { mtimeMs: number; entries: ChatKbEntry[] } | null = null;
let chatFeedbackBoostCache: { atMs: number; byQuestionNorm: Map<string, number> } | null = null;
const KB_RU_STOPWORDS = new Set([
  "как",
  "что",
  "где",
  "когда",
  "почему",
  "зачем",
  "можно",
  "ли",
  "у",
  "в",
  "на",
  "по",
  "для",
  "я",
  "мне",
  "мой",
  "моя",
  "мое",
  "мы",
  "вы",
  "если",
  "это",
  "этот",
  "эта",
  "эту",
  "или",
  "и",
  "а",
  "но",
  "с",
  "со",
  "от",
  "до",
  "про",
  "о",
  "об",
  "под",
  "над",
  "за",
  "из",
  "же",
  "бы",
  "пожалуйста",
]);

function normalizeKbText(v: string): string {
  return String(v || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeKbText(v: string): Set<string> {
  const tokens = normalizeKbText(v)
    .split(" ")
    .map((x) => x.trim())
    .filter((x) => (x.length >= 3 || x === "it") && !KB_RU_STOPWORDS.has(x));
  return new Set(tokens);
}

function trigramsKbText(v: string): Set<string> {
  const s = normalizeKbText(v).replace(/\s+/g, " ");
  if (s.length < 3) return new Set(s ? [s] : []);
  const out = new Set<string>();
  for (let i = 0; i <= s.length - 3; i += 1) {
    out.add(s.slice(i, i + 3));
  }
  return out;
}

function loadChatKb(): ChatKbEntry[] {
  const p = UNIQ_CHAT_KB_XLSX_PATH;
  if (!p || !fs.existsSync(p)) return [];
  const st = fs.statSync(p);
  if (chatKbCache && chatKbCache.mtimeMs === st.mtimeMs) return chatKbCache.entries;

  const readFileFn =
    (xlsx as any)?.readFile || (xlsx as any)?.default?.readFile;
  if (typeof readFileFn !== "function") {
    console.warn("[student/chat] xlsx.readFile is unavailable in current runtime");
    return [];
  }
  const wb = readFileFn(p);
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) return [];
  const ws = wb.Sheets[firstSheet];
  if (!ws) return [];
  const rows = (xlsx as any).utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];
  const out: ChatKbEntry[] = [];
  const seenQ = new Set<string>();
  let currentCategory = "";
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const categoryCell = String(row[0] || "").trim();
    if (categoryCell) currentCategory = categoryCell;
    const question = String(row[1] || "").trim();
    const answer = String(row[2] || "").trim();
    if (!question || !answer) continue;
    const qNorm = normalizeKbText(question);
    if (seenQ.has(qNorm)) continue;
    const qTokens = tokenizeKbText(question);
    const qTrigrams = trigramsKbText(question);
    const aNorm = normalizeKbText(answer);
    const aTokens = tokenizeKbText(answer);
    const aTrigrams = trigramsKbText(answer);
    if (!qNorm || qTokens.size === 0) continue;
    out.push({
      category: currentCategory || "Прочее",
      question,
      answer,
      qNorm,
      qTokens,
      qTrigrams,
      aNorm,
      aTokens,
      aTrigrams,
    });
    seenQ.add(qNorm);
  }
  chatKbCache = { mtimeMs: st.mtimeMs, entries: out };
  console.log(`[student/chat] KB loaded: ${out.length} rows from ${p}`);
  return out;
}

function scoreTextAgainst(
  userNorm: string,
  userTokens: Set<string>,
  textNorm: string,
  textTokens: Set<string>,
  textTrigrams: Set<string>
): number {
  let s = 0;
  if (userNorm.includes(textNorm)) s += 8;
  if (textNorm.includes(userNorm) && userNorm.length >= 7) s += 6;
  let overlap = 0;
  for (const t of userTokens) {
    if (textTokens.has(t)) overlap += 1;
  }
  s += overlap * 1.7;
  const denom = Math.max(userTokens.size, textTokens.size, 1);
  s += (overlap / denom) * 4;
  if (userTokens.size > 0) {
    s += (overlap / userTokens.size) * 5;
  }
  const userTrigrams = trigramsKbText(userNorm);
  if (userTrigrams.size > 0 && textTrigrams.size > 0) {
    let tgOverlap = 0;
    for (const g of userTrigrams) {
      if (textTrigrams.has(g)) tgOverlap += 1;
    }
    const dice = (2 * tgOverlap) / (userTrigrams.size + textTrigrams.size);
    s += dice * 8;
  }
  return s;
}

function isLocationCabinetQuery(text: string): boolean {
  const s = normalizeKbText(text);
  return /(где|кабинет|кабинете|адрес|расположен|находится|где находится|where|office|room)/iu.test(s);
}

function answerHasCabinetInfo(answer: string): boolean {
  const s = normalizeKbText(answer);
  if (!s) return false;
  if (/кабинет\s*\d+/iu.test(s)) return true;
  if (/каб\.\s*\d+/iu.test(s)) return true;
  return /кабинет/iu.test(s) && /\d{2,4}/.test(s);
}

function scoreKbEntry(userNorm: string, userTokens: Set<string>, item: ChatKbEntry): number {
  const questionScore = scoreTextAgainst(userNorm, userTokens, item.qNorm, item.qTokens, item.qTrigrams);
  const answerScore = scoreTextAgainst(userNorm, userTokens, item.aNorm, item.aTokens, item.aTrigrams);
  // Question wording stays primary; answer-text similarity is contextual fallback.
  return questionScore + answerScore * 0.6;
}

function getChatFeedbackBoostMap(): Map<string, number> {
  const now = Date.now();
  if (chatFeedbackBoostCache && now - chatFeedbackBoostCache.atMs < 30_000) {
    return chatFeedbackBoostCache.byQuestionNorm;
  }
  const rows = db
    .prepare(
      `SELECT kb_question_norm,
              SUM(CASE WHEN helpful = 1 THEN 1 ELSE 0 END) AS up_count,
              SUM(CASE WHEN helpful = -1 THEN 1 ELSE 0 END) AS down_count
       FROM chat_feedback
       WHERE kb_question_norm IS NOT NULL AND TRIM(kb_question_norm) <> ''
       GROUP BY kb_question_norm`
    )
    .all() as { kb_question_norm: string; up_count: number; down_count: number }[];
  const map = new Map<string, number>();
  for (const r of rows) {
    const up = Number(r.up_count) || 0;
    const down = Number(r.down_count) || 0;
    const net = up - down;
    // Saturating boost/penalty to avoid instability.
    const boost = Math.max(-2.5, Math.min(2.5, net * 0.35));
    map.set(String(r.kb_question_norm || "").trim(), boost);
  }
  chatFeedbackBoostCache = { atMs: now, byQuestionNorm: map };
  return map;
}

function tokenOverlapCount(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n += 1;
  return n;
}

function findKbMatches(userQuestion: string, limit: number): ChatKbEntry[] {
  const entries = loadChatKb();
  if (entries.length === 0) return [];
  const userNorm = normalizeKbText(userQuestion);
  const userTokens = tokenizeKbText(userQuestion);
  if (!userNorm || userTokens.size === 0) return [];
  const scored = entries
    .map((e) => ({ e, score: scoreKbEntry(userNorm, userTokens, e) }))
    .filter((x) => x.score >= 2.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.e);
  return scored;
}

function getLastUserMessages(cleaned: { role: "user" | "assistant"; content: string }[], n = 2): string[] {
  const users = cleaned.filter((m) => m.role === "user").map((m) => m.content.trim()).filter(Boolean);
  return users.slice(-n);
}

function buildRetrievalQueries(cleaned: { role: "user" | "assistant"; content: string }[]): string[] {
  const users = getLastUserMessages(cleaned, 2);
  if (users.length === 0) return [];
  const last = users[users.length - 1]!;
  const queries = [last];

  // If latest message is short/elliptic, combine with previous user turn for context.
  const shortOrFollowup =
    tokenizeKbText(last).size <= 4 ||
    /^(нет|а|или|и|но|тогда|если|ещ[её]|что\s+для\s+этого|как\s+это|что\s+делать)\b/iu.test(last);
  if (shortOrFollowup && users.length >= 2) {
    const prev = users[users.length - 2]!;
    queries.push(`${prev}. ${last}`);
  }
  return Array.from(new Set(queries));
}

function isFollowupUserQuestion(text: string): boolean {
  const s = String(text || "").trim();
  if (!s) return false;
  const tok = tokenizeKbText(s).size;
  return tok <= 4 || /^(а|нет|то есть|т е|и|или|но|тогда|если|еще|ещ[её]|как это|что дальше|куда|где|когда)\b/iu.test(s);
}

function countUserTurnsAfterIndex(
  cleaned: { role: "user" | "assistant"; content: string; source?: string; kbQuestionNorm?: string }[],
  idxExclusive: number
): number {
  let n = 0;
  for (let i = idxExclusive + 1; i < cleaned.length; i += 1) {
    if (cleaned[i]?.role === "user") n += 1;
  }
  return n;
}

function isStrongTopicSwitch(userText: string, anchor: ChatKbEntry | null): boolean {
  if (!anchor) return false;
  const userTokens = tokenizeKbText(userText);
  if (userTokens.size < 5) return false;
  const overlap = tokenOverlapCount(userTokens, anchor.qTokens);
  return overlap <= 1;
}

function detectUnsafeAcademicCheating(text: string): boolean {
  const s = normalizeKbText(text);
  if (!s) return false;
  return /(списат|обман|шпаргал|подсказ|cheat|作弊|қулық|алдау)/iu.test(s);
}

type ChatIntent =
  | "military"
  | "grades"
  | "gpa"
  | "retake"
  | "registration"
  | "schedule"
  | "it_access"
  | "payment"
  | "scholarship"
  | "hostel"
  | "documents"
  | "academic_leave"
  | "other";

function detectIntent(text: string): ChatIntent {
  const s = normalizeKbText(text);
  if (!s) return "other";
  if (/(военн|кафедр|әскери|military)/iu.test(s)) return "military";
  if (/(финанс|оплат|договор|tuition|fee|долг по оплат|задолженност.*оплат)/iu.test(s)) return "payment";
  if (/(platonus|moodle|outlook|teams|парол|логин|доступ|it)/iu.test(s)) return "it_access";
  if (/(академическ.*задолж|fx\b|f\b)/iu.test(s)) return "retake";
  if (/(gpa|оценк|баға|транскрипт|успеваем)/iu.test(s)) return "grades";
  if (/(ретейк|пересдач|академ.*разниц)/iu.test(s)) return "retake";
  if (/(регистрац|запис|иуп|план дисциплин)/iu.test(s)) return "registration";
  if (/(расписан|экзамен|сесси)/iu.test(s)) return "schedule";
  if (/(долг|задолжен)/iu.test(s)) return "payment";
  if (/(стипенд|шәкіртақ)/iu.test(s)) return "scholarship";
  if (/(общежит|жатақхана|dorm)/iu.test(s)) return "hostel";
  if (/(справк|заявлен|документ|құжат|certificate)/iu.test(s)) return "documents";
  if (/(академ.*отпуск|академиялық.*демалыс)/iu.test(s)) return "academic_leave";
  return "other";
}

function meaningfullyDifferentQuestion(a: string, b: string): boolean {
  const ta = tokenizeKbText(a);
  const tb = tokenizeKbText(b);
  if (ta.size === 0 || tb.size === 0) return false;
  const overlap = tokenOverlapCount(ta, tb);
  const ratio = overlap / Math.max(ta.size, tb.size);
  return ratio < 0.35;
}

function getLastAssistantAnswer(cleaned: { role: "user" | "assistant"; content: string }[]): string | null {
  for (let i = cleaned.length - 1; i >= 0; i -= 1) {
    if (cleaned[i]?.role === "assistant") return String(cleaned[i]?.content || "");
  }
  return null;
}

function rankKbByQueries(
  queries: string[],
  continuity?: { category?: string; questionNorm?: string | null; topicLock?: boolean }
): { entry: ChatKbEntry; score: number; questionScore: number; qOverlap: number; aOverlap: number }[] {
  const entries = loadChatKb();
  if (entries.length === 0 || queries.length === 0) return [];
  const feedbackBoost = getChatFeedbackBoostMap();
  const byEntry = new Map<ChatKbEntry, { score: number; questionScore: number; qOverlap: number; aOverlap: number }>();

  for (const q of queries) {
    const userNorm = normalizeKbText(q);
    const userTokens = tokenizeKbText(q);
    const wantsLocation = isLocationCabinetQuery(q);
    const queryIntent = detectIntent(q);
    const asksSystemAccess = /(platonus|moodle|outlook|teams|доступ|логин|парол|it)/iu.test(q);
    if (!userNorm || userTokens.size === 0) continue;
    for (const e of entries) {
      const questionScore = scoreTextAgainst(userNorm, userTokens, e.qNorm, e.qTokens, e.qTrigrams);
      const answerScore = scoreTextAgainst(userNorm, userTokens, e.aNorm, e.aTokens, e.aTrigrams);
      let score = questionScore + answerScore * 0.6 + (feedbackBoost.get(e.qNorm) || 0);
      const entryIntent = detectIntent(`${e.qNorm} ${e.aNorm}`);
      if (queryIntent !== "other" && entryIntent !== "other") {
        if (queryIntent === entryIntent) score += 2.1;
        else score -= 2.7;
      }
      if ((queryIntent === "it_access" || queryIntent === "payment") && (entryIntent === "grades" || entryIntent === "retake")) {
        score -= 2.4;
      }
      if (asksSystemAccess && /(gpa|fx|f\b|средн.*бал|успеваем)/iu.test(`${e.qNorm} ${e.aNorm}`)) {
        score -= 2.2;
      }
      if (wantsLocation && answerHasCabinetInfo(e.answer)) score += 2.2;
      if (wantsLocation && /it|поддержк|platonus|moodle|outlook|teams/iu.test(e.qNorm + " " + e.aNorm)) score += 1.1;
      if (continuity?.category && e.category === continuity.category) score += continuity?.topicLock ? 1.6 : 0.9;
      if (continuity?.questionNorm && e.qNorm === continuity.questionNorm) score += continuity?.topicLock ? 3.2 : 0.4;
      const qOverlap = tokenOverlapCount(userTokens, e.qTokens);
      const aOverlap = tokenOverlapCount(userTokens, e.aTokens);
      const prev = byEntry.get(e);
      if (!prev || score > prev.score) byEntry.set(e, { score, questionScore, qOverlap, aOverlap });
    }
  }

  return Array.from(byEntry.entries())
    .map(([entry, m]) => ({ entry, ...m }))
    .sort((a, b) => b.score - a.score);
}

app.post("/api/student/chat", async (req, res) => {
  if (!UNIQ_NVIDIA_API_KEY) {
    return res.status(503).json({ error: "chat_unavailable" });
  }
  const raw = (req.body || {}) as { messages?: unknown; debug?: unknown };
  const debugRequested = UNIQ_CHAT_DEBUG || raw.debug === true || String((req.query as any)?.debug || "") === "1";
  if (!Array.isArray(raw.messages) || raw.messages.length === 0) {
    return res.status(400).json({ error: "chat_invalid" });
  }
  const cleaned: { role: "user" | "assistant"; content: string; source?: string; kbQuestionNorm?: string }[] = [];
  for (const m of raw.messages.slice(-24)) {
    if (!m || typeof m !== "object") continue;
    const role = String((m as any).role || "").toLowerCase();
    const content = String((m as any).content ?? "").trim();
    if (!content || content.length > 6000) continue;
    if (role !== "user" && role !== "assistant") continue;
    const source = String((m as any).source || "").trim();
    const kbQuestionNorm = String((m as any).kbQuestionNorm || "").trim();
    cleaned.push({ role, content, source: source || undefined, kbQuestionNorm: kbQuestionNorm || undefined });
  }
  if (cleaned.length === 0 || cleaned[cleaned.length - 1]!.role !== "user") {
    return res.status(400).json({ error: "chat_invalid" });
  }
  const lastUserQuestion = cleaned[cleaned.length - 1]!.content;
  if (detectUnsafeAcademicCheating(lastUserQuestion)) {
    return res.json({
      reply:
        "Я не могу помогать с обходом правил или списыванием на экзамене. Вместо этого помогу подготовиться честно: могу составить краткий план подготовки по предмету, список тем для повторения и шаблон вопросов к преподавателю/тьютору.",
      source: "policy_refusal",
      kbQuestionNorm: null,
      ...(debugRequested
        ? {
            debug: {
              reason: "policy_refusal",
              intentNow: detectIntent(lastUserQuestion),
              lastUserQuestion,
            },
          }
        : {}),
    });
  }
  let linkedAssistantIdx = -1;
  for (let i = cleaned.length - 1; i >= 0; i -= 1) {
    const m = cleaned[i];
    if (m?.role === "assistant" && m?.source === "local_kb_best" && m?.kbQuestionNorm) {
      linkedAssistantIdx = i;
      break;
    }
  }
  const linkedAssistant = linkedAssistantIdx >= 0 ? cleaned[linkedAssistantIdx] : null;
  const linkedKbEntry = linkedAssistant
    ? loadChatKb().find((e) => e.qNorm === String(linkedAssistant.kbQuestionNorm || ""))
    : null;
  const userTurnsAfterAnchor = linkedAssistantIdx >= 0 ? countUserTurnsAfterIndex(cleaned, linkedAssistantIdx) : 99;
  const lastAnchorUserQuestion =
    linkedAssistantIdx >= 0
      ? [...cleaned.slice(0, linkedAssistantIdx)]
          .reverse()
          .find((m) => m.role === "user")?.content || ""
      : "";
  const intentNow = detectIntent(lastUserQuestion);
  const intentPrev = detectIntent(lastAnchorUserQuestion);
  const hardIntentShift = intentPrev !== "other" && intentNow !== "other" && intentPrev !== intentNow;
  const topicLock =
    !!linkedKbEntry &&
    userTurnsAfterAnchor <= 3 &&
    isFollowupUserQuestion(lastUserQuestion) &&
    !isStrongTopicSwitch(lastUserQuestion, linkedKbEntry) &&
    !hardIntentShift;
  const retrievalQueries = buildRetrievalQueries(cleaned);
  const ranked = rankKbByQueries(retrievalQueries, {
    category: topicLock || isFollowupUserQuestion(lastUserQuestion) ? linkedKbEntry?.category : undefined,
    questionNorm: linkedKbEntry?.qNorm || null,
    topicLock,
  });
  const bestKb = ranked[0] ?? null;
  const secondKb = ranked[1] ?? null;
  const lastAssistantAnswer = getLastAssistantAnswer(cleaned);
  const repeatedAnswer =
    !!bestKb &&
    !!lastAssistantAnswer &&
    normalizeKbText(String(lastAssistantAnswer || "")) === normalizeKbText(bestKb.entry.answer) &&
    meaningfullyDifferentQuestion(lastUserQuestion, lastAnchorUserQuestion);
  // Direct KB reply only when confidence is strong by question semantics (avoid wrong answer by one shared word).
  const canReplyDirectKb =
    !!bestKb &&
    (bestKb.questionScore >= 8.0 || (bestKb.score >= 8.8 && bestKb.qOverlap >= 2) || (bestKb.score >= 9.4 && bestKb.aOverlap >= 3)) &&
    (!secondKb || bestKb.score - secondKb.score >= 0.9) &&
    !repeatedAnswer &&
    !hardIntentShift;
  const locationFallback =
    !!bestKb &&
    isLocationCabinetQuery(lastUserQuestion) &&
    answerHasCabinetInfo(bestKb.entry.answer) &&
    bestKb.score >= 4.6;
  if ((canReplyDirectKb || locationFallback) && bestKb) {
    return res.json({
      reply: bestKb.entry.answer.trim(),
      source: "local_kb_best",
      kbQuestionNorm: bestKb.entry.qNorm,
      ...(debugRequested
        ? {
            debug: {
              reason: "direct_kb",
              intentNow,
              intentPrev,
              hardIntentShift,
              topicLock,
              userTurnsAfterAnchor,
              bestScore: bestKb.score,
              bestQuestionScore: bestKb.questionScore,
              bestQOverlap: bestKb.qOverlap,
              bestAOverlap: bestKb.aOverlap,
              secondScore: secondKb?.score ?? null,
              retrievalQueries,
              bestQuestion: bestKb.entry.question,
              bestCategory: bestKb.entry.category,
            },
          }
        : {}),
    });
  }
  const kbMatches =
    ranked.length > 0
      ? ranked.slice(0, UNIQ_CHAT_KB_MAX_MATCHES).map((x) => x.entry)
      : findKbMatches(lastUserQuestion, UNIQ_CHAT_KB_MAX_MATCHES);
  const kbContext =
    kbMatches.length > 0
      ? `LOCAL_KB_MATCHES:\n${kbMatches
          .map((m, i) => `${i + 1}. category=${m.category}\nquestion=${m.question}\nanswer=${m.answer}`)
          .join("\n\n")}`
      : "LOCAL_KB_MATCHES: none";
  const dialogKbContext = linkedKbEntry
    ? `DIALOG_CONTEXT_FROM_PREVIOUS_MATCH:\ncategory=${linkedKbEntry.category}\nquestion=${linkedKbEntry.question}\nanswer=${linkedKbEntry.answer}`
    : "DIALOG_CONTEXT_FROM_PREVIOUS_MATCH: none";

  const payload = {
    model: UNIQ_NVIDIA_CHAT_MODEL,
    messages: [
      { role: "system", content: STUDENT_CHAT_SYSTEM },
      { role: "system", content: kbContext },
      { role: "system", content: dialogKbContext },
      ...cleaned,
    ],
    max_tokens: 1024,
    temperature: 0.6,
    stream: false,
  };

  try {
    const r = await fetch(`${UNIQ_NVIDIA_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${UNIQ_NVIDIA_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(502).json({ error: "chat_upstream" });
    }
    if (!r.ok) {
      const msg = data?.error?.message || data?.message || r.statusText;
      console.warn("[student/chat] NVIDIA error", r.status, msg);
      return res.status(502).json({ error: "chat_upstream" });
    }
    const reply = data?.choices?.[0]?.message?.content;
    if (typeof reply !== "string" || !reply.trim()) {
      return res.status(502).json({ error: "chat_upstream" });
    }
    res.json({
      reply: reply.trim(),
      source: "nvidia",
      kbQuestionNorm: bestKb?.entry?.qNorm || null,
      ...(debugRequested
        ? {
            debug: {
              reason: "nvidia",
              intentNow,
              intentPrev,
              hardIntentShift,
              topicLock,
              userTurnsAfterAnchor,
              bestScore: bestKb?.score ?? null,
              bestQuestionScore: bestKb?.questionScore ?? null,
              bestQOverlap: bestKb?.qOverlap ?? null,
              bestAOverlap: bestKb?.aOverlap ?? null,
              secondScore: secondKb?.score ?? null,
              repeatedAnswer,
              retrievalQueries,
              kbMatches: kbMatches.map((m) => ({ category: m.category, question: m.question })),
            },
          }
        : {}),
    });
  } catch (e) {
    console.warn("[student/chat] fetch failed", e);
    return res.status(502).json({ error: "chat_upstream" });
  }
});

app.post("/api/student/chat/feedback", (req, res) => {
  const raw = (req.body || {}) as {
    userQuestion?: unknown;
    answer?: unknown;
    source?: unknown;
    kbQuestionNorm?: unknown;
    helpful?: unknown;
  };
  const helpfulRaw = Number(raw.helpful);
  const helpful = helpfulRaw === 1 ? 1 : helpfulRaw === -1 ? -1 : 0;
  if (!helpful) return res.status(400).json({ error: "feedback_invalid" });
  const userQuestion = String(raw.userQuestion ?? "").trim().slice(0, 6000);
  const answer = String(raw.answer ?? "").trim().slice(0, 12000);
  const source = String(raw.source ?? "").trim().slice(0, 120);
  const kbQuestionNorm = String(raw.kbQuestionNorm ?? "").trim().slice(0, 600);
  db.prepare(
    `INSERT INTO chat_feedback (user_question, user_question_norm, answer_text, kb_question_norm, source, helpful)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    userQuestion || null,
    userQuestion ? normalizeKbText(userQuestion) : null,
    answer || null,
    kbQuestionNorm || null,
    source || null,
    helpful
  );
  chatFeedbackBoostCache = null;
  res.json({ ok: true });
});

function base64UrlDecodeToString(input: string): string {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b64 = (input + pad).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64").toString("utf8");
}

function parseJwtPayload(token: string): any | null {
  const parts = String(token || "").split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(base64UrlDecodeToString(parts[1]!));
  } catch {
    return null;
  }
}

function splitName(full: string): { firstName: string; lastName: string } {
  const s = String(full || "").trim().replace(/\s+/g, " ");
  if (!s) return { firstName: "", lastName: "" };
  const parts = s.split(" ");
  if (parts.length === 1) return { firstName: parts[0]!, lastName: "" };
  return { firstName: parts[0]!, lastName: parts.slice(1).join(" ") };
}

function microsoftOAuthConfig() {
  const tenant = String(process.env.MS_TENANT_ID || "common").trim() || "common";
  const clientId = String(process.env.MS_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.MS_CLIENT_SECRET || "").trim();
  const redirectUri = String(process.env.MS_REDIRECT_URI || `${WEB_ORIGIN}/api/auth/microsoft/callback`).trim();
  return { tenant, clientId, clientSecret, redirectUri };
}

app.get("/api/auth/microsoft/start", (req, res) => {
  const { tenant, clientId, redirectUri } = microsoftOAuthConfig();
  if (!clientId) return res.status(500).send("MS_CLIENT_ID is not configured");

  const state = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  (req.session as any).msState = state;

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: "openid profile email User.Read",
    state,
  });
  const authUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize?${params.toString()}`;
  res.redirect(authUrl);
});

app.get("/api/auth/microsoft/callback", async (req, res) => {
  const code = String(req.query.code || "");
  const state = String(req.query.state || "");
  const expectedState = String((req.session as any).msState || "");
  delete (req.session as any).msState;

  if (!code) return res.redirect(`${WEB_ORIGIN}/student?ms=error`);
  if (!state || !expectedState || state !== expectedState) return res.redirect(`${WEB_ORIGIN}/student?ms=state`);

  const { tenant, clientId, clientSecret, redirectUri } = microsoftOAuthConfig();
  if (!clientId || !clientSecret) return res.redirect(`${WEB_ORIGIN}/student?ms=cfg`);

  try {
    const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;
    const form = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      scope: "openid profile email User.Read",
    });
    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const tokenText = await tokenRes.text();
    const tokenJson = tokenText ? JSON.parse(tokenText) : {};
    if (!tokenRes.ok) {
      console.error("[ms oauth token]", tokenRes.status, tokenJson);
      return res.redirect(`${WEB_ORIGIN}/student?ms=token`);
    }

    const idToken = String(tokenJson.id_token || "");
    const accessToken = String(tokenJson.access_token || "");
    const payload = idToken ? parseJwtPayload(idToken) : null;

    let firstName = String(payload?.given_name || "");
    let lastName = String(payload?.family_name || "");
    const displayName = String(payload?.name || "");
    const email = String(payload?.preferred_username || payload?.email || "");
    const oid = String(payload?.oid || payload?.sub || "");

    if ((!firstName || !lastName) && displayName) {
      const sp = splitName(displayName);
      firstName = firstName || sp.firstName;
      lastName = lastName || sp.lastName;
    }

    if ((!firstName || !lastName) && accessToken) {
      try {
        const meRes = await fetch("https://graph.microsoft.com/v1.0/me", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const me = (await meRes.json().catch(() => null)) as any;
        if (meRes.ok && me) {
          firstName = firstName || String(me.givenName || "");
          lastName = lastName || String(me.surname || "");
        }
      } catch (e) {
        console.warn("[ms graph /me]", e);
      }
    }

    const student: StudentSession = {
      oid: oid || null,
      email: email || null,
      firstName: firstName || null,
      lastName: lastName || null,
      name: displayName || null,
    };
    (req.session as any).student = student;
    return res.redirect(`${WEB_ORIGIN}/student?ms=ok`);
  } catch (e) {
    console.error("[ms oauth callback]", e);
    return res.redirect(`${WEB_ORIGIN}/student?ms=error`);
  }
});

app.post("/api/auth/microsoft/logout", (req, res) => {
  delete (req.session as any).student;
  res.json({ ok: true });
});

app.get("/api/student/me", (req, res) => {
  const student = ((req.session as any).student || null) as StudentSession | null;
  if (!student) return res.json({ ok: true, student: null });
  res.json({ ok: true, student });
});

app.post("/api/auth/login", (req, res) => {
  const { login, password } = (req.body || {}) as { login?: string; password?: string };
  if (!login || !password) return res.status(400).json({ error: "Введите логин и пароль" });
  const row = db
    .prepare("SELECT id, login, password_hash FROM advisors WHERE login = ?")
    .get(String(login)) as { id: number; login: string; password_hash: string } | undefined;
  if (!row) return res.status(401).json({ error: "Неверный логин или пароль" });
  if (!bcrypt.compareSync(String(password), row.password_hash)) {
    return res.status(401).json({ error: "Неверный логин или пароль" });
  }
  delete (req.session as any).adminId;
  (req.session as any).managerId = row.id;
  res.json({ ok: true });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.post("/api/admin/login", (req, res) => {
  const { login, password } = (req.body || {}) as { login?: string; password?: string };
  if (!login || !password) return res.status(400).json({ error: "Введите логин и пароль" });
  const row = db
    .prepare("SELECT id, login, password_hash, name FROM admin_users WHERE login = ?")
    .get(String(login)) as { id: number; login: string; password_hash: string; name: string | null } | undefined;
  if (!row) return res.status(401).json({ error: "Неверный логин или пароль" });
  if (!bcrypt.compareSync(String(password), row.password_hash)) {
    return res.status(401).json({ error: "Неверный логин или пароль" });
  }
  delete (req.session as any).managerId;
  (req.session as any).adminId = row.id;
  res.json({ ok: true, id: row.id, login: row.login, name: row.name || "Admin" });
});

app.post("/api/admin/logout", (req, res) => {
  delete (req.session as any).adminId;
  res.json({ ok: true });
});

app.get("/api/admin/me", requireAdmin, (req, res) => {
  const adminId = (req.session as any).adminId as number;
  const row = db.prepare("SELECT id, login, name FROM admin_users WHERE id = ?").get(adminId) as
    | { id: number; login: string; name: string | null }
    | undefined;
  if (!row) return res.status(401).json({ error: "Нет доступа" });
  res.json({ id: row.id, login: row.login, name: row.name || "Admin" });
});

app.patch("/api/admin/me/password", requireAdmin, (req, res) => {
  const adminId = (req.session as any).adminId as number;
  const { currentPassword, newPassword } = (req.body || {}) as { currentPassword?: string; newPassword?: string };
  if (!currentPassword || !newPassword) return res.status(400).json({ error: "Укажите текущий и новый пароль" });
  if (String(newPassword).length < 6) return res.status(400).json({ error: "Новый пароль минимум 6 символов" });
  const row = db.prepare("SELECT password_hash FROM admin_users WHERE id = ?").get(adminId) as
    | { password_hash: string }
    | undefined;
  if (!row) return res.status(404).json({ error: "Админ не найден" });
  if (!bcrypt.compareSync(String(currentPassword), row.password_hash)) {
    return res.status(400).json({ error: "Текущий пароль неверный" });
  }
  const hash = bcrypt.hashSync(String(newPassword), 10);
  db.prepare("UPDATE admin_users SET password_hash = ? WHERE id = ?").run(hash, adminId);
  schedulePgCoreSync();
  res.json({ ok: true });
});

app.patch("/api/managers/me/password", requireManager, (req, res) => {
  const advisorId = (req.session as any).managerId as number;
  const { currentPassword, newPassword } = (req.body || {}) as { currentPassword?: string; newPassword?: string };
  if (!currentPassword || !newPassword) return res.status(400).json({ error: "Укажите текущий и новый пароль" });
  if (String(newPassword).length < 6) return res.status(400).json({ error: "Новый пароль минимум 6 символов" });
  const row = db.prepare("SELECT password_hash FROM advisors WHERE id = ?").get(advisorId) as
    | { password_hash: string | null }
    | undefined;
  if (!row) return res.status(404).json({ error: "Сотрудник не найден" });
  const ph = String(row.password_hash || "");
  if (!ph || !bcrypt.compareSync(String(currentPassword), ph)) {
    return res.status(400).json({ error: "Текущий пароль неверный" });
  }
  const hash = bcrypt.hashSync(String(newPassword), 10);
  db.prepare("UPDATE advisors SET password_hash = ? WHERE id = ?").run(hash, advisorId);
  schedulePgCoreSync();
  res.json({ ok: true });
});

app.get("/api/admin/managers", requireAdmin, (req, res) => {
  const dayQ = parseYmdParam(String(req.query.day || ""));
  const today = dayQ ?? (db.prepare(`SELECT date('now', 'localtime') AS d`).get() as { d: string }).d;
  const rows = db
    .prepare(
      `SELECT a.id, a.name, a.faculty, a.department, a.desk_number, a.login,
              a.assigned_schools_json, a.assigned_languages_json, a.assigned_courses_json, a.assigned_specialties_json,
              a.assigned_study_years_json,
              COALESCE(d.work_ms, 0) AS work_ms_today
       FROM advisors a
       LEFT JOIN advisor_work_daily d ON d.advisor_id = a.id AND d.day = ?
       ORDER BY a.id ASC`
    )
    .all(today) as any[];
  res.json({ rows });
});

/** Создать менеджера: имя, фамилия, логин, пароль; зона приёма по умолчанию — любые школы / курсы 1–4. */
app.post("/api/admin/managers", requireAdmin, (req, res) => {
  const body = (req.body || {}) as {
    firstName?: string;
    lastName?: string;
    login?: string;
    password?: string;
  };
  const firstName = String(body.firstName || "").trim();
  const lastName = String(body.lastName || "").trim();
  const login = String(body.login || "").trim();
  const password = String(body.password || "");
  if (!firstName || !lastName) return res.status(400).json({ error: "Укажите имя и фамилию" });
  if (!login) return res.status(400).json({ error: "Укажите логин" });
  if (password.length < 4) return res.status(400).json({ error: "Пароль не короче 4 символов" });
  const dup = db.prepare("SELECT 1 AS ok FROM advisors WHERE login = ?").get(login) as { ok: 1 } | undefined;
  if (dup) return res.status(409).json({ error: "Логин уже занят" });
  const name = `${firstName} ${lastName}`.trim();
  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare(
      `INSERT INTO advisors (
         name, faculty, department, desk_number, login, password_hash,
         assigned_schools_json, assigned_language, assigned_languages_json, assigned_courses_json, assigned_specialties_json, assigned_study_years_json,
         reception_open
       ) VALUES (?, NULL, NULL, NULL, ?, ?, '[]', NULL, NULL, '[1,2,3,4]', NULL, NULL, 1)`
    )
    .run(name, login, hash);
  schedulePgCoreSync();
  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});

/** Назначить сотруднику окно 1…6 (в `desk_number` сохраняется «1»…«6»). У других сотрудников это окно сбрасывается. */
app.patch("/api/admin/managers/:id/desk", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Неверный id" });
  const raw = (req.body || {}).window;
  const window =
    raw === null || raw === undefined || raw === ""
      ? null
      : Number(raw);
  if (window !== null && (!Number.isFinite(window) || window < 1 || window > 6)) {
    return res.status(400).json({ error: "Окно должно быть от 1 до 6 или пусто" });
  }
  const exists = db.prepare("SELECT 1 as ok FROM advisors WHERE id = ?").get(id) as { ok: 1 } | undefined;
  if (!exists) return res.status(404).json({ error: "Сотрудник не найден" });

  const deskStr = window === null ? null : String(Math.floor(window));

  const tx = db.transaction(() => {
    if (window !== null) {
      const others = db
        .prepare("SELECT id, desk_number FROM advisors WHERE id != ?")
        .all(id) as { id: number; desk_number: string | null }[];
      for (const o of others) {
        if (deskWindowFromDb(o.desk_number) === window) {
          db.prepare("UPDATE advisors SET desk_number = NULL WHERE id = ?").run(o.id);
        }
      }
    }
    db.prepare("UPDATE advisors SET desk_number = ? WHERE id = ?").run(deskStr, id);
  });
  tx();
  schedulePgCoreSync();
  res.json({ ok: true });
});

app.delete("/api/admin/managers/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Неверный id" });
  const exists = db.prepare("SELECT 1 as ok FROM advisors WHERE id = ?").get(id) as { ok: 1 } | undefined;
  if (!exists) return res.status(404).json({ error: "Сотрудник не найден" });

  const active = db
    .prepare("SELECT COUNT(*) as c FROM tickets WHERE advisor_id = ? AND status IN ('WAITING','CALLED','IN_SERVICE')")
    .get(id) as { c: number };
  if (active.c > 0) {
    return res.status(409).json({ error: "Нельзя удалить: у сотрудника есть активные талоны" });
  }

  db.prepare("UPDATE tickets SET advisor_id = NULL WHERE advisor_id = ?").run(id);
  db.prepare("DELETE FROM advisor_work_daily WHERE advisor_id = ?").run(id);
  db.prepare("DELETE FROM advisor_work_totals WHERE advisor_id = ?").run(id);
  db.prepare("DELETE FROM advisors WHERE id = ?").run(id);
  schedulePgCoreSync();
  res.json({ ok: true });
});

app.get("/api/managers/me", requireManager, (req, res) => {
  const advisorId = (req.session as any).managerId as number;
  const row = db
    .prepare(
      `SELECT a.id, a.name, a.faculty, a.department, a.desk_number,
              COALESCE(a.reception_open, 1) AS reception_open,
              a.assigned_schools_json, a.assigned_language,
              a.assigned_languages_json, a.assigned_courses_json, a.assigned_specialties_json, a.assigned_study_years_json, a.assigned_school_scopes_json,
              COALESCE(w.total_ms, 0) AS total_work_ms
       FROM advisors a
       LEFT JOIN advisor_work_totals w ON w.advisor_id = a.id
       WHERE a.id = ?`
    )
    .get(advisorId);
  res.json(row);
});

/** Открыть/закрыть запись только для своей зоны приёма (не вся очередь). */
app.patch("/api/managers/me/reception", requireManager, (req, res) => {
  const advisorId = (req.session as any).managerId as number;
  const open = Boolean((req.body || {}).open);
  db.prepare("UPDATE advisors SET reception_open = ? WHERE id = ?").run(open ? 1 : 0, advisorId);
  recomputeRouteOwnersForWaitingTickets();
  schedulePgCoreSync();
  broadcastQueue();
  const row = db
    .prepare(
      `SELECT a.id, a.name, a.faculty, a.department, a.desk_number,
              COALESCE(a.reception_open, 1) AS reception_open,
              a.assigned_schools_json, a.assigned_language,
              a.assigned_languages_json, a.assigned_courses_json, a.assigned_specialties_json, a.assigned_study_years_json, a.assigned_school_scopes_json,
              COALESCE(w.total_ms, 0) AS total_work_ms
       FROM advisors a
       LEFT JOIN advisor_work_totals w ON w.advisor_id = a.id
       WHERE a.id = ?`
    )
    .get(advisorId);
  res.json(row);
});

app.patch("/api/managers/me/work-total", requireManager, (req, res) => {
  const advisorId = (req.session as any).managerId as number;
  const totalMs = Number((req.body || {}).totalMs);
  if (!Number.isFinite(totalMs) || totalMs < 0) return res.status(400).json({ error: "Некорректное totalMs" });
  db.prepare(
    `INSERT INTO advisor_work_totals (advisor_id, total_ms, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(advisor_id) DO UPDATE SET
       total_ms = MAX(total_ms, excluded.total_ms),
       updated_at = CURRENT_TIMESTAMP`
  ).run(advisorId, Math.floor(totalMs));

  const todayMs = Number((req.body || {}).todayMs);
  if (Number.isFinite(todayMs) && todayMs >= 0) {
    const dayBody = parseYmdParam(String((req.body || {}).day || ""));
    const day = dayBody ?? (db.prepare(`SELECT date('now', 'localtime') AS d`).get() as { d: string }).d;
    db.prepare(
      `INSERT INTO advisor_work_daily (advisor_id, day, work_ms)
       VALUES (?, ?, ?)
       ON CONFLICT(advisor_id, day) DO UPDATE SET
         work_ms = MAX(work_ms, excluded.work_ms)`
    ).run(advisorId, day, Math.floor(todayMs));
  }
  schedulePgCoreSync();
  res.json({ ok: true });
});

app.get("/api/managers/me/history", requireManager, async (req, res) => {
  const advisorId = (req.session as any).managerId as number;
  const limitRaw = Number((req.query.limit as string) || 200);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 200;
  const dateQ = parseYmdParam(String(req.query.date || ""));
  const dayFilter = dateQ ?? (db.prepare(`SELECT date('now', 'localtime') AS d`).get() as { d: string }).d;

  const advisorHistorySqlite = () =>
    db
      .prepare(
        `SELECT
         l.id AS log_id,
         l.ticket_id AS id,
         l.queue_number,
         l.status,
         l.student_first_name,
         l.student_last_name,
         l.school,
         l.specialty,
         l.language_section,
         l.course,
         l.created_at,
         l.called_at,
         l.started_at,
         l.finished_at,
         l.advisor_name,
         l.advisor_desk,
         l.comment,
         t.student_comment,
         t.study_duration_years,
         l.case_type,
         l.is_repeat,
         CAST(ROUND((julianday(l.started_at) - julianday(l.created_at)) * 24 * 60) AS INTEGER) AS queue_wait_minutes,
         CAST(ROUND((julianday(l.finished_at) - julianday(l.started_at)) * 24 * 60) AS INTEGER) AS desk_service_minutes,
         CAST(ROUND((julianday(l.finished_at) - julianday(l.created_at)) * 24 * 60) AS INTEGER) AS total_minutes,
         CASE
           WHEN t.status IN ('DONE','MISSED')
             AND t.finished_at IS NOT NULL
             AND t.finished_at = l.finished_at
             AND (julianday('now') - julianday(t.finished_at)) * 24 * 60 <= 60
           THEN 1
           ELSE 0
         END AS reopen_eligible
       FROM ticket_visit_log l
       JOIN tickets t ON t.id = l.ticket_id
       WHERE l.advisor_id = ?
         AND date(l.finished_at, 'localtime') = ?
       ORDER BY l.finished_at DESC, l.id DESC
       LIMIT ?`
      )
      .all(advisorId, dayFilter, limit) as any[];

  let rows: any[];
  if (isPgHistoryEnabled()) {
    try {
      rows = await pgAdvisorVisitRows(advisorId, dayFilter, limit);
      const ticketStmt = db.prepare(`SELECT status, finished_at, student_comment, study_duration_years FROM tickets WHERE id = ?`);
      for (const r of rows) {
        const tid = Number(r.id);
        const t = ticketStmt.get(tid) as
          | { status?: string; finished_at?: unknown; student_comment?: unknown; study_duration_years?: unknown }
          | undefined;
        r.reopen_eligible = reopenEligibleForLogRow(r.finished_at, t);
        r.student_comment = t?.student_comment ?? null;
        r.study_duration_years = t?.study_duration_years ?? null;
        r.queue_wait_minutes = minutesBetweenTimestamps(r.created_at, r.started_at);
        r.desk_service_minutes = minutesBetweenTimestamps(r.started_at, r.finished_at);
        r.total_minutes = minutesBetweenTimestamps(r.created_at, r.finished_at);
      }
    } catch (e) {
      console.error("[manager history pg]", e);
      console.warn(
        "[manager history] ответ из SQLite: PostgreSQL недоступен. На Render задайте pooler Supabase (IPv4) или см. DEPLOY-RENDER.md."
      );
      rows = advisorHistorySqlite();
    }
  } else {
    rows = advisorHistorySqlite();
  }

  res.json({
    rows: rows.map((r) => ({
      ...r,
      formatted_number: formatQueueNumber(r.queue_number as number),
      queue_wait_minutes: Number.isFinite(r.queue_wait_minutes) ? r.queue_wait_minutes : null,
      desk_service_minutes: Number.isFinite(r.desk_service_minutes) ? r.desk_service_minutes : null,
      total_minutes: Number.isFinite(r.total_minutes) ? r.total_minutes : null,
    })),
  });
});

app.patch("/api/managers/me/scope", requireManager, (req, res) => {
  const advisorId = (req.session as any).managerId as number;
  const body = req.body || {};
  const schools = Array.isArray(body.assigned_schools_json) ? body.assigned_schools_json.map(String) : [];
  const langs = Array.isArray(body.assigned_languages_json) ? body.assigned_languages_json.map((x: any) => String(x).toLowerCase()) : [];
  const courses = Array.isArray(body.assigned_courses_json) ? body.assigned_courses_json.map((x: any) => Number(x)).filter((n: number) => n >= 1 && n <= 4) : [1, 2, 3, 4];
  const specs = Array.isArray(body.assigned_specialties_json) ? body.assigned_specialties_json.map(String) : [];
  const studyYears = Array.isArray(body.assigned_study_years_json)
    ? body.assigned_study_years_json.map((x: any) => parseStudyDuration(x)).filter((n: any): n is number => n != null)
    : [];
  const schoolScopesRaw = body.assigned_school_scopes_json;
  const schoolScopes = parseSchoolScopedFilters(
    schoolScopesRaw && typeof schoolScopesRaw === "object" ? JSON.stringify(schoolScopesRaw) : null
  );

  if (schools.length === 0) return res.status(400).json({ error: "Выберите хотя бы одну школу" });

  db.prepare(
    `UPDATE advisors
     SET assigned_schools_json = ?,
         assigned_languages_json = ?,
         assigned_courses_json = ?,
         assigned_specialties_json = ?,
         assigned_study_years_json = ?,
         assigned_school_scopes_json = ?
     WHERE id = ?`
  ).run(
    JSON.stringify(schools),
    langs.length > 0 ? JSON.stringify(langs) : null,
    JSON.stringify(courses.length > 0 ? courses : [1, 2, 3, 4]),
    specs.length > 0 ? JSON.stringify(specs) : null,
    studyYears.length > 0 ? JSON.stringify(studyYears) : null,
    Object.keys(schoolScopes).length > 0 ? JSON.stringify(schoolScopes) : null,
    advisorId
  );
  recomputeRouteOwnersForWaitingTickets();
  schedulePgCoreSync();
  const row = db
    .prepare(
      `SELECT id, name, faculty, department, desk_number, assigned_schools_json, assigned_language,
              assigned_languages_json, assigned_courses_json, assigned_specialties_json, assigned_study_years_json, assigned_school_scopes_json
       FROM advisors WHERE id = ?`
    )
    .get(advisorId);
  broadcastQueue();
  res.json(row);
});

app.get("/api/queue/live", (_req, res) => res.json(getLiveQueue()));

app.get("/api/admin/queues/all", requireAdmin, (_req, res) => {
  const advisors = db
    .prepare(
      `SELECT id, name, desk_number, assigned_schools_json, assigned_languages_json, assigned_courses_json, assigned_specialties_json, assigned_study_years_json, assigned_school_scopes_json
       FROM advisors
       ORDER BY id ASC`
    )
    .all() as {
    id: number;
    name: string;
    desk_number: string | null;
    assigned_schools_json: string | null;
    assigned_languages_json: string | null;
    assigned_courses_json: string | null;
    assigned_specialties_json: string | null;
    assigned_study_years_json: string | null;
    assigned_school_scopes_json: string | null;
  }[];
  const byId = new Map<number, (typeof advisors)[number]>();
  for (const a of advisors) byId.set(Number(a.id), a);

  const rows = db
    .prepare(
      `SELECT id, queue_number, status, student_first_name, student_last_name, school, specialty, specialty_code,
              language_section, course, study_duration_years, route_advisor_id, advisor_id, advisor_name, advisor_desk,
              preferred_slot_at, created_at
       FROM tickets
       WHERE status IN ('WAITING','CALLED','IN_SERVICE')
       ORDER BY
         CASE status WHEN 'WAITING' THEN 0 WHEN 'CALLED' THEN 1 ELSE 2 END,
         queue_number ASC`
    )
    .all() as any[];

  const out = rows.map((r) => {
    const routeId = Number(r.route_advisor_id);
    const activeAdvisorId = Number(r.advisor_id);
    const ownerId = r.status === "WAITING" ? (Number.isFinite(routeId) ? routeId : null) : Number.isFinite(activeAdvisorId) ? activeAdvisorId : null;
    const owner = ownerId != null ? byId.get(ownerId) : undefined;

    let waitingTargets: (typeof advisors)[number][] = [];
    if (String(r.status || "").toUpperCase() === "WAITING") {
      waitingTargets = advisors.filter((a) =>
        ticketMatchesScope(r, {
          assigned_schools_json: a.assigned_schools_json ?? "[]",
          assigned_languages_json: a.assigned_languages_json ?? null,
          assigned_courses_json: a.assigned_courses_json ?? "[1,2,3,4]",
          assigned_specialties_json: a.assigned_specialties_json ?? null,
          assigned_study_years_json: a.assigned_study_years_json ?? null,
          assigned_school_scopes_json: a.assigned_school_scopes_json ?? null,
        })
      );
    }
    const waitingNames = waitingTargets.map((a) => a.name).filter(Boolean);
    const waitingDesks = waitingTargets
      .map((a) => String(a.desk_number || "").trim())
      .filter((x) => x.length > 0)
      .join(", ");
    return {
      ...r,
      formatted_number: formatQueueNumber(Number(r.queue_number)),
      owner_manager_id: owner?.id ?? (waitingTargets[0]?.id ?? null),
      owner_manager_name: owner?.name ?? r.advisor_name ?? (waitingNames.length ? waitingNames.join(", ") : null),
      owner_manager_desk: owner?.desk_number ?? r.advisor_desk ?? (waitingDesks || null),
    };
  });
  res.json({ rows: out });
});

app.post("/api/tickets", (req, res) => {
  const {
    firstName,
    lastName,
    school,
    specialty,
    specialtyCode,
    languageSection,
    course,
    studyDurationYears,
    preferredSlotAt,
  } = (req.body || {}) as any;

  if (!String(firstName || "").trim() || !String(lastName || "").trim() || !String(school || "").trim()) {
    return res.status(400).json({ error: "Заполните имя, фамилию и школу" });
  }
  if (!String(languageSection || "").trim() || !String(course || "").trim() || !String(specialtyCode || "").trim()) {
    return res.status(400).json({ error: "Заполните все поля профиля" });
  }
  const studyDuration = parseStudyDuration(studyDurationYears);
  if (studyDuration == null) {
    return res.status(400).json({ error: "Выберите тип обучения" });
  }

  const reg = registrationOpenForStudent({
    school: String(school || ""),
    specialty_code: String(specialtyCode || ""),
    language_section: String(languageSection || ""),
    course: String(course || ""),
    study_duration_years: studyDuration,
  });
  if (!reg.matchesAny) {
    return res.status(409).json({ error: "Нет линии приёма для указанных данных" });
  }
  if (!reg.open) {
    return res.status(409).json({ error: "Запись по вашему направлению сейчас закрыта менеджером" });
  }

  let slot: string | null = null;
  if (preferredSlotAt != null && String(preferredSlotAt).trim() !== "") {
    const raw = String(preferredSlotAt).trim();
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return res.status(400).json({ error: "Некорректное время брони" });
    if (d.getTime() < Date.now() - 60_000) return res.status(400).json({ error: "Выберите время в будущем" });
    const startOf = (x: Date) => {
      const z = new Date(x);
      z.setHours(0, 0, 0, 0);
      return z.getTime();
    };
    if (startOf(d) !== startOf(new Date())) {
      return res.status(400).json({ error: "Бронирование доступно только на сегодня" });
    }
    slot = d.toISOString();
  }

  const qn = nextQueueNumber();
  const routeAdvisorId = pickRouteAdvisorIdForTicket(
    {
      school: String(school || "").trim(),
      specialty_code: String(specialtyCode || "").trim(),
      language_section: String(languageSection || "").trim(),
      course: String(course || "").trim(),
      study_duration_years: studyDuration,
    },
    advisorsRowsForRouting()
  );
  const stmt = db.prepare(
    `INSERT INTO tickets
     (queue_number, status, student_first_name, student_last_name, school, specialty, specialty_code, language_section, course, study_duration_years, route_advisor_id, preferred_slot_at)
     VALUES (@qn, 'WAITING', @fn, @ln, @school, @spec, @specCode, @lang, @course, @studyYears, @routeAdvisorId, @slot)`
  );
  const info = stmt.run({
    qn,
    fn: String(firstName || "").trim(),
    ln: String(lastName || "").trim(),
    school: String(school || "").trim(),
    spec: String(specialty || "").trim(),
    specCode: String(specialtyCode || "").trim(),
    lang: String(languageSection || "").trim(),
    course: String(course || "").trim(),
    studyYears: studyDuration,
    routeAdvisorId,
    slot,
  });

  const ticket = db
    .prepare(
      `SELECT id, queue_number, status, school, specialty, specialty_code, language_section, course, study_duration_years, route_advisor_id, preferred_slot_at
       FROM tickets WHERE id = ?`
    )
    .get(info.lastInsertRowid) as any;

  const estimated_time = computeEstimatedMinutes(ticket);
  schedulePgCoreSync();
  broadcastQueue();
  res.json({ ...ticket, formatted_number: formatQueueNumber(ticket.queue_number), estimated_time });
});

app.get("/api/tickets/:id/status", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Неверный идентификатор" });
  const t = db
    .prepare(
      `SELECT t.id, t.queue_number, t.status, t.school, t.specialty, t.specialty_code, t.language_section, t.course, t.study_duration_years, t.route_advisor_id,
              t.advisor_name, t.advisor_desk, t.advisor_faculty, t.advisor_department,
              t.comment, t.case_type, t.student_comment, t.manager_attachment_name, t.manager_attachment_data_url, t.send_email_requested,
              t.preferred_slot_at, t.missed_student_note,
              CASE WHEN r.ticket_id IS NOT NULL THEN 1 ELSE 0 END AS has_review
       FROM tickets t
       LEFT JOIN ticket_reviews r ON r.ticket_id = t.id
       WHERE t.id = ?`
    )
    .get(id) as any;
  if (!t) return res.status(404).json({ error: "Талон не найден" });
  const estimated_time = t.status === "WAITING" ? computeEstimatedMinutes(t) : null;
  res.json({ ...t, formatted_number: formatQueueNumber(t.queue_number), estimated_time });
});

app.post("/api/tickets/:id/cancel", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Неверный идентификатор" });
  const row = db.prepare("SELECT id, status FROM tickets WHERE id = ?").get(id) as { id: number; status: TicketStatus } | undefined;
  if (!row) return res.status(404).json({ error: "Талон не найден" });
  if (row.status !== "WAITING") return res.status(409).json({ error: "Отмена доступна только для талонов в ожидании" });
  db.prepare("UPDATE tickets SET status = 'CANCELLED', finished_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
  schedulePgCoreSync();
  broadcastQueue();
  res.json({ ok: true, id });
});

app.post("/api/tickets/call-next", requireManager, (req, res) => {
  const advisorId = (req.session as any).managerId as number;

  const advisorRow = db
    .prepare(
      "SELECT id, name, desk_number, faculty, department, reception_open, assigned_schools_json, assigned_languages_json, assigned_courses_json, assigned_specialties_json, assigned_study_years_json, assigned_school_scopes_json FROM advisors WHERE id = ?"
    )
    .get(advisorId) as any;
  if (!advisorRow) return res.status(404).json({ error: "Сотрудник не найден" });
  if (Number(advisorRow.reception_open) === 0) return res.status(403).json({ error: "Откройте запись студентов, чтобы вызывать" });

  const waiting = db
    .prepare(
      `SELECT * FROM tickets WHERE status = 'WAITING'
       ORDER BY CASE WHEN preferred_slot_at IS NOT NULL THEN preferred_slot_at ELSE '9999-12-31' END ASC,
                queue_number ASC`
    )
    .all() as any[];
  const now = new Date();
  const scope: AdvisorScope = {
    assigned_schools_json: advisorRow.assigned_schools_json ?? "[]",
    assigned_languages_json: advisorRow.assigned_languages_json ?? null,
    assigned_courses_json: advisorRow.assigned_courses_json ?? "[1,2,3,4]",
    assigned_specialties_json: advisorRow.assigned_specialties_json ?? null,
    assigned_study_years_json: advisorRow.assigned_study_years_json ?? null,
    assigned_school_scopes_json: advisorRow.assigned_school_scopes_json ?? null,
  };
  const next = waiting.find((t) => ticketMatchesScope(t, scope) && bookingCallableNow(t.preferred_slot_at, now));
  if (!next) {
    return res.status(404).json({
      error:
        "Нет студентов, доступных для вызова в вашей зоне. Если у всех есть бронь — дождитесь указанного времени или используйте «Позвать по брони».",
    });
  }

  db.prepare(
    `UPDATE tickets
     SET status = 'CALLED', called_at = CURRENT_TIMESTAMP,
         advisor_id = ?, advisor_name = ?, advisor_desk = ?, advisor_faculty = ?, advisor_department = ?
     WHERE id = ?`
  ).run(advisorId, advisorRow.name, advisorRow.desk_number, advisorRow.faculty, advisorRow.department, next.id);

  schedulePgCoreSync();
  broadcastQueue();
  res.json({ ok: true, ticketId: next.id });
});

app.post("/api/tickets/:id/call-booked", requireManager, (req, res) => {
  const advisorId = (req.session as any).managerId as number;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Неверный идентификатор" });

  const row = db.prepare(`SELECT * FROM tickets WHERE id = ?`).get(id) as any;
  if (!row) return res.status(404).json({ error: "Талон не найден" });
  if (row.status !== "WAITING") return res.status(409).json({ error: "Вызов доступен только для талона в ожидании" });

  const slotRaw = row.preferred_slot_at;
  if (slotRaw == null || String(slotRaw).trim() === "") {
    return res.status(400).json({ error: "У талона нет брони времени — используйте «Вызвать следующего»" });
  }

  const now = new Date();
  if (!bookingCallableNow(slotRaw, now)) {
    return res.status(409).json({ error: "Нельзя вызвать раньше времени брони" });
  }

  const a = db
    .prepare(
      "SELECT reception_open, assigned_schools_json, assigned_languages_json, assigned_courses_json, assigned_specialties_json, assigned_study_years_json, assigned_school_scopes_json FROM advisors WHERE id = ?"
    )
    .get(advisorId) as any;
  if (!a) return res.status(404).json({ error: "Сотрудник не найден" });
  if (Number(a.reception_open) === 0) return res.status(403).json({ error: "Откройте запись студентов, чтобы вызывать" });
  const scope: AdvisorScope = {
    assigned_schools_json: a.assigned_schools_json ?? "[]",
    assigned_languages_json: a.assigned_languages_json ?? null,
    assigned_courses_json: a.assigned_courses_json ?? "[1,2,3,4]",
    assigned_specialties_json: a.assigned_specialties_json ?? null,
    assigned_study_years_json: a.assigned_study_years_json ?? null,
    assigned_school_scopes_json: a.assigned_school_scopes_json ?? null,
  };
  if (!ticketMatchesScope(row, scope)) {
    return res.status(403).json({ error: "Этот талон не относится к вашей зоне приёма" });
  }

  const advisorRow = db
    .prepare("SELECT id, name, desk_number, faculty, department FROM advisors WHERE id = ?")
    .get(advisorId) as any;

  db.prepare(
    `UPDATE tickets
     SET status = 'CALLED', called_at = CURRENT_TIMESTAMP,
         advisor_id = ?, advisor_name = ?, advisor_desk = ?, advisor_faculty = ?, advisor_department = ?
     WHERE id = ?`
  ).run(advisorId, advisorRow.name, advisorRow.desk_number, advisorRow.faculty, advisorRow.department, id);

  schedulePgCoreSync();
  broadcastQueue();
  res.json({ ok: true, ticketId: id });
});

/**
 * Вызвать конкретного студента из очереди к себе, без проверки «маршрутизации зоны».
 * Нужен при режиме «вся очередь»: менеджер расширил настройки или принимает вне своей линии.
 */
app.post("/api/tickets/:id/call-to-my-desk", requireManager, (req, res) => {
  const advisorId = (req.session as any).managerId as number;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Неверный идентификатор" });

  const openRow = db.prepare("SELECT reception_open FROM advisors WHERE id = ?").get(advisorId) as { reception_open: number } | undefined;
  if (!openRow || Number(openRow.reception_open) === 0) {
    return res.status(403).json({ error: "Откройте запись студентов, чтобы вызывать из очереди" });
  }

  const row = db.prepare("SELECT * FROM tickets WHERE id = ?").get(id) as any;
  if (!row) return res.status(404).json({ error: "Талон не найден" });
  if (row.status !== "WAITING") return res.status(409).json({ error: "Вызов доступен только для талона в ожидании" });

  const now = new Date();
  if (!bookingCallableNow(row.preferred_slot_at, now)) {
    return res.status(409).json({ error: "Для этого талона ещё не наступило время брони" });
  }

  const advisorRow = db
    .prepare("SELECT id, name, desk_number, faculty, department FROM advisors WHERE id = ?")
    .get(advisorId) as any;

  db.prepare(
    `UPDATE tickets
     SET status = 'CALLED', called_at = CURRENT_TIMESTAMP,
         advisor_id = ?, advisor_name = ?, advisor_desk = ?, advisor_faculty = ?, advisor_department = ?
     WHERE id = ?`
  ).run(advisorId, advisorRow.name, advisorRow.desk_number, advisorRow.faculty, advisorRow.department, id);

  schedulePgCoreSync();
  broadcastQueue();
  res.json({ ok: true, ticketId: id });
});

app.patch("/api/tickets/:id", requireManager, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Неверный идентификатор" });
  const { status, comment, case_type, case_subtype, contact_type, student_comment, manager_attachment_name, manager_attachment_data_url, send_email_requested } = (req.body || {}) as {
    status?: TicketStatus;
    comment?: string;
    case_type?: string | null;
    case_subtype?: string | null;
    contact_type?: "QUESTION" | "CONSULTATION" | "PROBLEM" | null;
    student_comment?: string;
    manager_attachment_name?: string | null;
    manager_attachment_data_url?: string | null;
    send_email_requested?: boolean | number | null;
  };

  let row = db.prepare("SELECT * FROM tickets WHERE id = ?").get(id) as any;
  if (!row) return res.status(404).json({ error: "Талон не найден" });

  if (comment !== undefined) {
    db.prepare("UPDATE tickets SET comment = ? WHERE id = ?").run(String(comment), id);
    schedulePgCoreSync();
  }
  if (case_type !== undefined) {
    db.prepare("UPDATE tickets SET case_type = ? WHERE id = ?").run(case_type === null ? null : String(case_type), id);
    schedulePgCoreSync();
  }
  if (case_subtype !== undefined) {
    db.prepare("UPDATE tickets SET case_subtype = ? WHERE id = ?").run(case_subtype === null ? null : String(case_subtype), id);
    schedulePgCoreSync();
  }
  if (contact_type !== undefined) {
    db.prepare("UPDATE tickets SET contact_type = ? WHERE id = ?").run(contact_type === null ? null : String(contact_type), id);
    schedulePgCoreSync();
  }
  if (student_comment !== undefined) {
    db.prepare("UPDATE tickets SET student_comment = ? WHERE id = ?").run(String(student_comment || "").trim() || null, id);
    schedulePgCoreSync();
  }
  if (manager_attachment_name !== undefined || manager_attachment_data_url !== undefined) {
    const name = String(manager_attachment_name || "").trim() || null;
    const dataUrl = String(manager_attachment_data_url || "").trim() || null;
    if (dataUrl && !dataUrl.startsWith("data:")) return res.status(400).json({ error: "Некорректный файл" });
    if (dataUrl && dataUrl.length > 900_000) return res.status(400).json({ error: "Файл слишком большой" });
    db.prepare("UPDATE tickets SET manager_attachment_name = ?, manager_attachment_data_url = ? WHERE id = ?").run(name, dataUrl, id);
    schedulePgCoreSync();
  }
  if (send_email_requested !== undefined) {
    db.prepare("UPDATE tickets SET send_email_requested = ? WHERE id = ?").run(send_email_requested ? 1 : 0, id);
    schedulePgCoreSync();
  }

  row = db.prepare("SELECT * FROM tickets WHERE id = ?").get(id) as any;

  if (status !== undefined) {
    const valid: TicketStatus[] = ["WAITING", "CALLED", "IN_SERVICE", "MISSED", "DONE", "CANCELLED"];
    if (!valid.includes(status)) return res.status(400).json({ error: "Неверный статус" });
    if (status === "DONE") {
      const validTypes = ["ACADEMIC", "FINANCIAL", "STATEMENTS", "CERTIFICATES", "ONAY", "MILITARY_DEPT", "ACADEMIC_MOBILITY", "TECHNICAL"];
      const validContactTypes = ["QUESTION", "CONSULTATION", "PROBLEM"];
      if (!row.case_type || !validTypes.includes(String(row.case_type))) {
        return res.status(400).json({ error: "Укажите категорию обращения" });
      }
      if (!row.case_subtype || !String(row.case_subtype).trim()) {
        return res.status(400).json({ error: "Укажите подкатегорию обращения" });
      }
      if (!row.contact_type || !validContactTypes.includes(String(row.contact_type))) {
        return res.status(400).json({ error: "Укажите тип обращения" });
      }
      const wc = countWords(row.comment);
      if (wc < 1) return res.status(400).json({ error: "Комментарий обязателен" });
      if (wc > 300) return res.status(400).json({ error: "Комментарий не более 300 слов" });
    }
    const wasTerminal = ["DONE", "MISSED", "CANCELLED"].includes(String(row.status));
    const terminal = status === "DONE" || status === "MISSED" || status === "CANCELLED";
    const started_at = status === "IN_SERVICE" ? "CURRENT_TIMESTAMP" : null;
    db.prepare(
      `UPDATE tickets
       SET status = ?,
           started_at = CASE WHEN ? IS NULL THEN started_at ELSE ${started_at} END,
           finished_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE finished_at END
       WHERE id = ?`
    ).run(status, status === "IN_SERVICE" ? 1 : null, terminal ? 1 : 0, id);
    schedulePgCoreSync();

    if (terminal && !wasTerminal) {
      const trow = db.prepare("SELECT * FROM tickets WHERE id = ?").get(id) as any;
      const prev = db.prepare("SELECT COUNT(*) as c FROM ticket_visit_log WHERE ticket_id = ?").get(id) as { c: number };
      insertVisitLogFromTicket(trow, prev.c > 0 ? 1 : 0);
      schedulePgCoreSync();
    }
  }

  broadcastQueue();
  await flushPgCoreSyncNow();
  res.json({ ok: true });
});

app.post("/api/tickets/:id/review", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Неверный идентификатор" });
  const trow = db.prepare("SELECT id, status FROM tickets WHERE id = ?").get(id) as { id: number; status: string } | undefined;
  if (!trow) return res.status(404).json({ error: "Талон не найден" });
  if (trow.status !== "DONE") return res.status(409).json({ error: "Отзыв доступен после завершения приёма" });
  const dup = db.prepare("SELECT 1 as ok FROM ticket_reviews WHERE ticket_id = ?").get(id) as { ok: 1 } | undefined;
  if (dup) return res.status(409).json({ error: "Отзыв уже отправлен" });
  const { stars, comment } = (req.body || {}) as { stars?: number; comment?: string };
  const st = Number(stars);
  if (!Number.isFinite(st) || st < 1 || st > 5 || !Number.isInteger(st)) {
    return res.status(400).json({ error: "Оцените от 1 до 5 звёзд" });
  }
  const reviewComment = String(comment || "").trim();
  if (st <= 3 && reviewComment.length === 0) {
    return res.status(400).json({ error: "Для оценки 3 и ниже комментарий обязателен" });
  }
  db.prepare(`INSERT INTO ticket_reviews (ticket_id, stars, comment) VALUES (?, ?, ?)`).run(
    id,
    st,
    reviewComment || null
  );
  await flushPgCoreSyncNow();
  res.json({ ok: true });
});

/** Студент: по желанию причина пропуска после MISSED (NULL → показать форму). */
app.post("/api/tickets/:id/missed-feedback", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Неверный идентификатор" });
  const row = db.prepare("SELECT id, status, missed_student_note FROM tickets WHERE id = ?").get(id) as
    | { id: number; status: string; missed_student_note: string | null }
    | undefined;
  if (!row) return res.status(404).json({ error: "Талон не найден" });
  if (row.status !== "MISSED") return res.status(409).json({ error: "Талон не в статусе пропуска" });
  if (row.missed_student_note != null) return res.status(409).json({ error: "Уже отправлено" });
  const raw = (req.body || {}) as { reason?: string };
  const note = String(raw.reason ?? "").trim().slice(0, 2000);
  db.prepare("UPDATE tickets SET missed_student_note = ? WHERE id = ?").run(note, id);
  schedulePgCoreSync();
  res.json({ ok: true });
});

/** Вернуть в очередь / снова на приём / правка комментария — не позже часа после завершения. */
app.post("/api/tickets/:id/reopen", requireManager, (req, res) => {
  const advisorId = (req.session as any).managerId as number;
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Неверный идентификатор" });
  const action = String((req.body || {}).action || "").trim();
  if (!["queue", "service", "comment"].includes(action)) {
    return res.status(400).json({ error: "Нужно action: queue | service | comment" });
  }

  const row = db.prepare("SELECT * FROM tickets WHERE id = ?").get(id) as any;
  if (!row) return res.status(404).json({ error: "Талон не найден" });
  if (Number(row.advisor_id) !== advisorId) return res.status(403).json({ error: "Не ваш талон" });
  if (!["DONE", "MISSED"].includes(String(row.status))) {
    return res.status(400).json({ error: "Доступно только для завершённых визитов" });
  }
  if (!row.finished_at) return res.status(400).json({ error: "Нет времени завершения" });
  const age = db
    .prepare(`SELECT (julianday('now') - julianday(?)) * 24 * 60 AS m`)
    .get(String(row.finished_at)) as { m: number };
  if (age.m > 60 || age.m < 0) return res.status(400).json({ error: "Прошло больше часа с завершения" });

  if (action === "comment") {
    const comment = String((req.body || {}).comment ?? "");
    if (comment.length > 12000) return res.status(400).json({ error: "Комментарий слишком длинный" });
    db.prepare("UPDATE tickets SET comment = ? WHERE id = ?").run(comment, id);
    schedulePgCoreSync();
    broadcastQueue();
    return res.json({ ok: true });
  }

  if (action === "queue") {
    const qn = nextQueueNumber();
    const routeAdvisorId = pickRouteAdvisorIdForTicket(row, advisorsRowsForRouting());
    db.prepare(
      `UPDATE tickets SET
         status = 'WAITING',
         queue_number = ?,
         route_advisor_id = ?,
         called_at = NULL,
         started_at = NULL,
         finished_at = NULL,
         advisor_id = NULL,
         advisor_name = NULL,
         advisor_desk = NULL,
         advisor_faculty = NULL,
         advisor_department = NULL
       WHERE id = ?`
    ).run(qn, routeAdvisorId, id);
    schedulePgCoreSync();
    broadcastQueue();
    return res.json({ ok: true });
  }

  if (action === "service") {
    db.prepare(
      `UPDATE tickets SET
         status = 'IN_SERVICE',
         finished_at = NULL,
         started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
       WHERE id = ?`
    ).run(id);
    schedulePgCoreSync();
    broadcastQueue();
    return res.json({ ok: true });
  }

  res.status(400).json({ error: "Неизвестное действие" });
});

app.post("/api/stats/event", async (req, res) => {
  const { event_type, meta } = (req.body || {}) as { event_type?: string; meta?: unknown };
  if (!event_type || typeof event_type !== "string") return res.status(400).json({ error: "Нужен event_type" });
  db.prepare(`INSERT INTO stats_events (event_type, meta) VALUES (?, ?)`).run(
    event_type.slice(0, 80),
    meta !== undefined ? JSON.stringify(meta) : null
  );
  await flushPgCoreSyncNow();
  res.json({ ok: true });
});

app.get("/api/admin/stats/summary", requireAdmin, async (_req, res) => {
  if (isPgCoreEnabled()) {
    const pg = await fastPg("pg admin summary", () => pgAdminSummary());
    if (pg) {
      return res.json(pg);
    }
  }
  const events = db.prepare(`SELECT event_type, COUNT(*) as count FROM stats_events GROUP BY event_type`).all() as {
    event_type: string;
    count: number;
  }[];
  const r = db.prepare(`SELECT COUNT(*) as c FROM ticket_reviews`).get() as { c: number };
  const today = db
    .prepare(`SELECT COUNT(*) as c FROM tickets WHERE date(created_at) = date('now', 'localtime')`)
    .get() as { c: number };
  const bookedLive = db
    .prepare(
      `SELECT COUNT(*) as c FROM tickets WHERE preferred_slot_at IS NOT NULL AND status IN ('WAITING','CALLED','IN_SERVICE')`
    )
    .get() as { c: number };
  res.json({ events, reviewsTotal: r.c, ticketsToday: today.c, bookedSlotsLive: bookedLive.c });
});

/** Открытия FAQ без талона по дням (событие faq_no_queue). from/to — фильтр по дате события; format=csv — Excel. */
app.get("/api/admin/stats/faq-no-queue", requireAdmin, async (req, res) => {
  const format = String(req.query.format || "json").toLowerCase();
  const from = parseYmdParam(String(req.query.from || ""));
  const to = parseYmdParam(String(req.query.to || ""));
  if ((from && !to) || (!from && to)) {
    return res.status(400).json({ error: "Укажите обе даты from и to или ни одной" });
  }
  if (from && to && from > to) return res.status(400).json({ error: "Дата «с» не может быть позже «по»" });
  let rows: { day: string; count: number }[];
  if (isPgCoreEnabled()) {
    const pgRows = await fastPg("pg faq no queue", () => pgFaqNoQueue(from, to));
    if (pgRows) {
      rows = pgRows;
    } else {
      let sql = `SELECT date(created_at, 'localtime') AS day, COUNT(*) AS count
           FROM stats_events
           WHERE event_type = 'faq_no_queue'`;
      const params: string[] = [];
      if (from && to) {
        sql += ` AND date(created_at, 'localtime') >= ? AND date(created_at, 'localtime') <= ?`;
        params.push(from, to);
      }
      sql += ` GROUP BY date(created_at, 'localtime') ORDER BY day ASC`;
      rows = db.prepare(sql).all(...params) as { day: string; count: number }[];
    }
  } else {
    let sql = `SELECT date(created_at, 'localtime') AS day, COUNT(*) AS count
         FROM stats_events
         WHERE event_type = 'faq_no_queue'`;
    const params: string[] = [];
    if (from && to) {
      sql += ` AND date(created_at, 'localtime') >= ? AND date(created_at, 'localtime') <= ?`;
      params.push(from, to);
    }
    sql += ` GROUP BY date(created_at, 'localtime') ORDER BY day ASC`;
    rows = db.prepare(sql).all(...params) as { day: string; count: number }[];
  }

  if (format === "csv") {
    const header = "date;count";
    const lines = rows.map((r) => `${r.day};${r.count}`);
    const csv = "\uFEFF" + [header, ...lines].join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="faq-no-queue.csv"');
    return res.send(csv);
  }

  res.json({ from: from || null, to: to || null, series: rows });
});

/** Время ожидания (мин) от регистрации до вызова или начала приёма; фильтр по дате регистрации. */
app.get("/api/admin/stats/wait-times", requireAdmin, async (req, res) => {
  const from = parseYmdParam(String(req.query.from || ""));
  const to = parseYmdParam(String(req.query.to || ""));
  if (!from || !to) return res.status(400).json({ error: "Укажите from и to в формате YYYY-MM-DD" });
  if (from > to) return res.status(400).json({ error: "Дата «с» не может быть позже «по»" });
  const statusFilter = String(req.query.status || "").trim().toUpperCase();
  const validStatuses = new Set(["WAITING", "CALLED", "IN_SERVICE", "MISSED", "DONE", "CANCELLED"]);
  const format = String(req.query.format || "json").toLowerCase();
  const schoolQ = String(req.query.school || "").trim().toLowerCase();

  const minWait = Number(req.query.minWait ?? "");
  const maxWait = Number(req.query.maxWait ?? "");
  let rows: any[] = [];
  let count = 0;
  let avgMin = 0;
  let medianMin = 0;
  if (isPgCoreEnabled()) {
    try {
      const pgRes = await pgAdminWaitTimes(
        from,
        to,
        statusFilter && validStatuses.has(statusFilter) ? statusFilter : undefined,
        schoolQ || undefined,
        Number.isFinite(minWait) ? minWait : null,
        Number.isFinite(maxWait) ? maxWait : null
      );
      rows = pgRes.rows;
      count = pgRes.summary.count;
      avgMin = pgRes.summary.avgMin;
      medianMin = pgRes.summary.medianMin;
    } catch (e) {
      console.error("[pg wait times]", e);
    }
  }
  if (rows.length === 0 && !count && !avgMin && !medianMin) {
    const active = db
      .prepare(
        `SELECT
           t.id AS ticket_id,
           t.queue_number,
           t.student_first_name,
           t.student_last_name,
           t.school,
           t.status,
           t.created_at,
           t.called_at,
           t.started_at,
           CASE
             WHEN t.called_at IS NOT NULL
               THEN (strftime('%s', t.called_at) - strftime('%s', t.created_at)) / 60.0
             WHEN t.started_at IS NOT NULL
               THEN (strftime('%s', t.started_at) - strftime('%s', t.created_at)) / 60.0
             ELSE NULL
           END AS wait_minutes
         FROM tickets t
         WHERE date(t.created_at, 'localtime') >= ? AND date(t.created_at, 'localtime') <= ?
           AND t.status IN ('WAITING','CALLED','IN_SERVICE')
           AND (t.called_at IS NOT NULL OR t.started_at IS NOT NULL)`
      )
      .all(from, to) as any[];
    const terminal = db
      .prepare(
        `SELECT
           l.ticket_id,
           l.queue_number,
           l.student_first_name,
           l.student_last_name,
           l.school,
           l.status,
           l.created_at,
           l.called_at,
           l.started_at,
           CASE
             WHEN l.called_at IS NOT NULL
               THEN (strftime('%s', l.called_at) - strftime('%s', l.created_at)) / 60.0
             WHEN l.started_at IS NOT NULL
               THEN (strftime('%s', l.started_at) - strftime('%s', l.created_at)) / 60.0
             ELSE NULL
           END AS wait_minutes
         FROM ticket_visit_log l
         WHERE date(l.created_at, 'localtime') >= ? AND date(l.created_at, 'localtime') <= ?
           AND l.status IN ('DONE','MISSED','CANCELLED')
           AND (l.called_at IS NOT NULL OR l.started_at IS NOT NULL)`
      )
      .all(from, to) as any[];
    const raw = [...active, ...terminal];
    rows = raw.filter((r) => r.wait_minutes != null && Number.isFinite(Number(r.wait_minutes)) && Number(r.wait_minutes) >= 0);
    if (statusFilter && validStatuses.has(statusFilter)) rows = rows.filter((r) => r.status === statusFilter);
    if (schoolQ) rows = rows.filter((r) => String(r.school || "").toLowerCase().includes(schoolQ));
    if (Number.isFinite(minWait)) rows = rows.filter((r) => Number(r.wait_minutes) >= minWait);
    if (Number.isFinite(maxWait)) rows = rows.filter((r) => Number(r.wait_minutes) <= maxWait);
    const waits = rows.map((r) => Number(r.wait_minutes)).sort((a, b) => a - b);
    count = waits.length;
    const sum = waits.reduce((a, b) => a + b, 0);
    avgMin = count ? sum / count : 0;
    medianMin =
      count === 0 ? 0 : count % 2 === 1 ? waits[(count - 1) / 2]! : (waits[count / 2 - 1]! + waits[count / 2]!) / 2;
  }

  if (format === "csv") {
    const header =
      "ticket_id;queue;wait_minutes;status;created_at;called_at;started_at;student_last;student_first;school";
    const lines = rows.map((r) =>
      [
        r.ticket_id,
        formatQueueNumber(Number(r.queue_number)),
        Number(r.wait_minutes).toFixed(2),
        r.status,
        r.created_at,
        r.called_at,
        r.started_at,
        r.student_last_name,
        r.student_first_name,
        r.school,
      ]
        .map(csvCell)
        .join(";")
    );
    const csv = "\uFEFF" + [header, ...lines].join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="wait-times.csv"');
    return res.send(csv);
  }

  res.json({
    from,
    to,
    summary: { count, avgMin, medianMin },
    rows: rows.map((r) => ({
      ...r,
      formatted_number: formatQueueNumber(Number(r.queue_number)),
      wait_minutes: Number(Number(r.wait_minutes).toFixed(2)),
    })),
  });
});

/** Сколько визитов (DONE) по школам за период по дате завершения. */
app.get("/api/admin/stats/schools-served", requireAdmin, (req, res) => {
  const from = parseYmdParam(String(req.query.from || ""));
  const to = parseYmdParam(String(req.query.to || ""));
  if (!from || !to) return res.status(400).json({ error: "Укажите from и to в формате YYYY-MM-DD" });
  if (from > to) return res.status(400).json({ error: "Дата «с» не может быть позже «по»" });
  const format = String(req.query.format || "json").toLowerCase();

  const rows = db
    .prepare(
      `SELECT
         l.school AS school,
         COUNT(*) AS count
       FROM ticket_visit_log l
       WHERE l.status = 'DONE'
         AND l.finished_at IS NOT NULL
         AND date(l.finished_at, 'localtime') >= ?
         AND date(l.finished_at, 'localtime') <= ?
       GROUP BY l.school
       ORDER BY count DESC, l.school ASC`
    )
    .all(from, to) as any[];

  if (format === "csv") {
    const header = "school;count";
    const lines = rows.map((r) => [r.school, r.count].map(csvCell).join(";"));
    const csv = "\uFEFF" + [header, ...lines].join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="schools-served.csv"');
    return res.send(csv);
  }

  res.json({
    from,
    to,
    rows: rows.map((r) => ({ school: String(r.school || ""), count: Number(r.count) || 0 })),
  });
});

/** Талоны с бронью (preferred_slot_at): кто на какое время, фильтр по дате слота. */
app.get("/api/admin/stats/bookings", requireAdmin, async (req, res) => {
  const from = parseYmdParam(String(req.query.from || ""));
  const to = parseYmdParam(String(req.query.to || ""));
  if (!from || !to) return res.status(400).json({ error: "Укажите from и to в формате YYYY-MM-DD" });
  if (from > to) return res.status(400).json({ error: "Дата «с» не может быть позже «по»" });
  const statusFilter = String(req.query.status || "").trim().toUpperCase();
  const validStatuses = new Set(["WAITING", "CALLED", "IN_SERVICE", "MISSED", "DONE", "CANCELLED"]);
  const format = String(req.query.format || "json").toLowerCase();
  const managerIdQ = Number(req.query.managerId ?? "");
  const managerId = Number.isFinite(managerIdQ) && managerIdQ > 0 ? Math.trunc(managerIdQ) : null;

  const schoolQ = String(req.query.school || "").trim().toLowerCase();
  let rows: any[] = [];
  if (isPgCoreEnabled()) {
    rows =
      (await fastPg("pg bookings", () =>
        pgAdminBookings(
        from,
        to,
        statusFilter && validStatuses.has(statusFilter) ? statusFilter : undefined,
        schoolQ || undefined,
        managerId
        )
      )) ?? [];
  }
  if (rows.length === 0) {
    let sql = `SELECT t.id AS ticket_id, t.queue_number, t.student_first_name, t.student_last_name, t.school, t.specialty,
         t.preferred_slot_at, t.status, t.created_at,
         COALESCE(t.advisor_name, ra.name) AS advisor_name,
         COALESCE(t.advisor_desk, ra.desk_number) AS advisor_desk,
         t.route_advisor_id
       FROM tickets t
       LEFT JOIN advisors ra ON ra.id = t.route_advisor_id
       WHERE t.preferred_slot_at IS NOT NULL
         AND date(t.preferred_slot_at, 'localtime') >= ? AND date(t.preferred_slot_at, 'localtime') <= ?`;
    const params: (string | number)[] = [from, to];
    if (statusFilter && validStatuses.has(statusFilter)) {
      sql += " AND t.status = ?";
      params.push(statusFilter);
    }
    if (managerId != null) {
      sql += " AND COALESCE(t.route_advisor_id, t.advisor_id) = ?";
      params.push(managerId);
    }
    sql += " ORDER BY t.preferred_slot_at ASC, t.id ASC";
    rows = db.prepare(sql).all(...params) as any[];
    if (schoolQ) rows = rows.filter((r) => String(r.school || "").toLowerCase().includes(schoolQ));
  }

  if (format === "csv") {
    const header =
      "ticket_id;queue;slot_local;status;registered_at;student_last;student_first;school;specialty;manager;desk";
    const lines = rows.map((r) =>
      [
        r.ticket_id,
        formatQueueNumber(Number(r.queue_number)),
        r.preferred_slot_at,
        r.status,
        r.created_at,
        r.student_last_name,
        r.student_first_name,
        r.school,
        r.specialty,
        r.advisor_name,
        r.advisor_desk,
      ]
        .map(csvCell)
        .join(";")
    );
    const csv = "\uFEFF" + [header, ...lines].join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="bookings-by-slot.csv"');
    return res.send(csv);
  }

  res.json({
    from,
    to,
    rows: rows.map((r) => ({
      ...r,
      formatted_number: formatQueueNumber(Number(r.queue_number)),
    })),
  });
});

/** Нагрузка по дням выбранного месяца и по месяцам выбранного года. */
app.get("/api/admin/stats/load", requireAdmin, async (req, res) => {
  const dateStr = String(req.query.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return res.status(400).json({ error: "Укажите дату в формате YYYY-MM-DD" });
  }
  const statusFilter = String(req.query.status || "").trim().toUpperCase();
  const validStatuses = new Set(["WAITING", "CALLED", "IN_SERVICE", "MISSED", "DONE", "CANCELLED"]);
  const managerIdQ = Number(req.query.managerId ?? "");
  const managerId = Number.isFinite(managerIdQ) && managerIdQ > 0 ? Math.trunc(managerIdQ) : null;
  const hasExtraFilters = (statusFilter && validStatuses.has(statusFilter)) || managerId != null;

  if (isPgCoreEnabled() && !hasExtraFilters) {
    const pg = await fastPg("pg admin load", () => pgAdminLoad(dateStr));
    if (pg) {
      return res.json(pg);
    }
  }
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(5, 7));
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return res.status(400).json({ error: "Некорректная дата" });
  }

  const regDayRows = db
    .prepare(
      `SELECT CAST(strftime('%d', created_at, 'localtime') AS INTEGER) AS k, COUNT(*) AS c
       FROM tickets
       WHERE strftime('%Y', created_at, 'localtime') = ?
         AND strftime('%m', created_at, 'localtime') = ?
         AND (? = '' OR status = ?)
         AND (? IS NULL OR COALESCE(route_advisor_id, advisor_id) = ?)
       GROUP BY CAST(strftime('%d', created_at, 'localtime') AS INTEGER)`
    )
    .all(
      String(year),
      String(month).padStart(2, "0"),
      statusFilter && validStatuses.has(statusFilter) ? statusFilter : "",
      statusFilter && validStatuses.has(statusFilter) ? statusFilter : "",
      managerId,
      managerId
    ) as { k: number; c: number }[];
  const callDayRows = db
    .prepare(
      `SELECT CAST(strftime('%d', called_at, 'localtime') AS INTEGER) AS k, COUNT(*) AS c
       FROM tickets
       WHERE called_at IS NOT NULL
         AND strftime('%Y', called_at, 'localtime') = ?
         AND strftime('%m', called_at, 'localtime') = ?
         AND (? = '' OR status = ?)
         AND (? IS NULL OR COALESCE(route_advisor_id, advisor_id) = ?)
       GROUP BY CAST(strftime('%d', called_at, 'localtime') AS INTEGER)`
    )
    .all(
      String(year),
      String(month).padStart(2, "0"),
      statusFilter && validStatuses.has(statusFilter) ? statusFilter : "",
      statusFilter && validStatuses.has(statusFilter) ? statusFilter : "",
      managerId,
      managerId
    ) as { k: number; c: number }[];

  const regMonthRows = db
    .prepare(
      `SELECT CAST(strftime('%m', created_at, 'localtime') AS INTEGER) AS k, COUNT(*) AS c
       FROM tickets
       WHERE strftime('%Y', created_at, 'localtime') = ?
         AND (? = '' OR status = ?)
         AND (? IS NULL OR COALESCE(route_advisor_id, advisor_id) = ?)
       GROUP BY CAST(strftime('%m', created_at, 'localtime') AS INTEGER)`
    )
    .all(
      String(year),
      statusFilter && validStatuses.has(statusFilter) ? statusFilter : "",
      statusFilter && validStatuses.has(statusFilter) ? statusFilter : "",
      managerId,
      managerId
    ) as { k: number; c: number }[];
  const callMonthRows = db
    .prepare(
      `SELECT CAST(strftime('%m', called_at, 'localtime') AS INTEGER) AS k, COUNT(*) AS c
       FROM tickets
       WHERE called_at IS NOT NULL
         AND strftime('%Y', called_at, 'localtime') = ?
         AND (? = '' OR status = ?)
         AND (? IS NULL OR COALESCE(route_advisor_id, advisor_id) = ?)
       GROUP BY CAST(strftime('%m', called_at, 'localtime') AS INTEGER)`
    )
    .all(
      String(year),
      statusFilter && validStatuses.has(statusFilter) ? statusFilter : "",
      statusFilter && validStatuses.has(statusFilter) ? statusFilter : "",
      managerId,
      managerId
    ) as { k: number; c: number }[];

  const regDayMap = new Map<number, number>(regDayRows.map((r) => [Number(r.k), Number(r.c)]));
  const callDayMap = new Map<number, number>(callDayRows.map((r) => [Number(r.k), Number(r.c)]));
  const regMonthMap = new Map<number, number>(regMonthRows.map((r) => [Number(r.k), Number(r.c)]));
  const callMonthMap = new Map<number, number>(callMonthRows.map((r) => [Number(r.k), Number(r.c)]));

  const daily: { day: number; registrations: number; calls: number }[] = [];
  for (let d = 1; d <= 31; d++) daily.push({ day: d, registrations: regDayMap.get(d) ?? 0, calls: callDayMap.get(d) ?? 0 });
  const monthly: { month: number; registrations: number; calls: number }[] = [];
  for (let mm = 1; mm <= 12; mm++) monthly.push({ month: mm, registrations: regMonthMap.get(mm) ?? 0, calls: callMonthMap.get(mm) ?? 0 });

  res.json({ year, month, daily, monthly });
});

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  if (/[;\r\n"]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** История завершённых визитов за период (все менеджеры). format=csv — выгрузка для Excel. */
app.get("/api/admin/visits/history", requireAdmin, async (req, res) => {
  const from = parseYmdParam(String(req.query.from || ""));
  const to = parseYmdParam(String(req.query.to || ""));
  if (!from || !to) return res.status(400).json({ error: "Укажите from и to в формате YYYY-MM-DD" });
  if (from > to) return res.status(400).json({ error: "Дата «с» не может быть позже «по»" });
  const format = String(req.query.format || "json").toLowerCase();

  const adminVisitsSqlite = () =>
    db
      .prepare(
        `SELECT
         l.id AS log_id,
         l.ticket_id,
         l.queue_number,
         l.status,
         l.student_first_name,
         l.student_last_name,
         l.school,
         l.specialty,
         l.language_section,
         l.course,
         l.created_at,
         l.called_at,
         l.started_at,
         l.finished_at,
         l.advisor_name,
         l.advisor_desk,
         l.comment,
         t.student_comment,
         t.study_duration_years,
         l.case_type,
         l.is_repeat
       FROM ticket_visit_log l
       LEFT JOIN tickets t ON t.id = l.ticket_id
       WHERE date(l.finished_at, 'localtime') >= ? AND date(l.finished_at, 'localtime') <= ?
       ORDER BY l.finished_at DESC, l.id DESC`
      )
      .all(from, to) as any[];

  let rows: any[];
  if (isPgHistoryEnabled()) {
    const pgRows = await fastPg("admin visits pg", () => pgAdminVisitsBetween(from, to));
    if (pgRows) {
      rows = pgRows;
    } else {
      console.warn(
        "[admin visits] ответ из SQLite: PostgreSQL недоступен. На Render используйте pooler Supabase (IPv4), см. DEPLOY-RENDER.md."
      );
      rows = adminVisitsSqlite();
    }
  } else {
    rows = adminVisitsSqlite();
  }

  const statusFilter = String(req.query.status || "").trim().toUpperCase();
  const validStatuses = new Set(["DONE", "MISSED", "CANCELLED"]);
  if (statusFilter && validStatuses.has(statusFilter)) {
    rows = rows.filter((r) => String(r.status).toUpperCase() === statusFilter);
  }
  const schoolQ = String(req.query.school || "").trim().toLowerCase();
  if (schoolQ) {
    rows = rows.filter((r) => String(r.school || "").toLowerCase().includes(schoolQ));
  }

  rows = rows.map((r) => ({
    ...r,
    queue_wait_minutes: minutesBetweenTimestamps(r.created_at, r.started_at),
    desk_service_minutes: minutesBetweenTimestamps(r.started_at, r.finished_at),
    total_minutes: minutesBetweenTimestamps(r.created_at, r.finished_at),
  }));

  if (format === "csv") {
    const header =
      "ticket_id;queue_number;finished_date;status;repeat_call;student_last;student_first;school;specialty;lang_section;course;study_duration_years;manager;desk;case_type;comment;student_comment;called_at;started_at;finished_at;queue_wait_min;service_min;total_min";
    const lines = rows.map((r) =>
      [
        r.ticket_id,
        formatQueueNumber(Number(r.queue_number)),
        String(r.finished_at || "").slice(0, 10),
        r.status,
        Number(r.is_repeat) === 1 ? "да" : "нет",
        r.student_last_name,
        r.student_first_name,
        r.school,
        r.specialty,
        r.language_section,
        r.course,
        r.study_duration_years,
        r.advisor_name,
        r.advisor_desk,
        r.case_type,
        r.comment,
        r.student_comment,
        r.called_at,
        r.started_at,
        r.finished_at,
        r.queue_wait_minutes,
        r.desk_service_minutes,
        r.total_minutes,
      ]
        .map(csvCell)
        .join(";")
    );
    const csv = "\uFEFF" + [header, ...lines].join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="visits-history.csv"');
    return res.send(csv);
  }

  res.json({
    from,
    to,
    rows: rows.map((r) => ({
      ...r,
      formatted_number: formatQueueNumber(Number(r.queue_number)),
      queue_wait_minutes: Number.isFinite(r.queue_wait_minutes) ? r.queue_wait_minutes : null,
      desk_service_minutes: Number.isFinite(r.desk_service_minutes) ? r.desk_service_minutes : null,
      total_minutes: Number.isFinite(r.total_minutes) ? r.total_minutes : null,
    })),
  });
});

/** Отзывы студентов за период (дата отправки отзыва). format=csv — Excel. */
app.get("/api/admin/stats/reviews", requireAdmin, async (req, res) => {
  const from = parseYmdParam(String(req.query.from || ""));
  const to = parseYmdParam(String(req.query.to || ""));
  if (!from || !to) return res.status(400).json({ error: "Укажите from и to в формате YYYY-MM-DD" });
  if (from > to) return res.status(400).json({ error: "Дата «с» не может быть позже «по»" });
  const format = String(req.query.format || "json").toLowerCase();

  const starsRaw = String(req.query.stars || "").trim();
  const starsEq = starsRaw === "" ? null : Number(starsRaw);
  const schoolQ = String(req.query.school || "").trim().toLowerCase();

  let rows: any[] = [];
  if (isPgCoreEnabled()) {
    rows =
      (await fastPg("pg admin reviews", () =>
        pgAdminReviews(
        from,
        to,
        starsEq != null && Number.isFinite(starsEq) && starsEq >= 1 && starsEq <= 5 ? Math.round(starsEq) : null,
        schoolQ || undefined
        )
      )) ?? [];
  }
  if (rows.length === 0) {
    let sql = `SELECT
           r.ticket_id,
           r.stars,
           r.comment AS review_comment,
           r.created_at AS review_at,
           t.queue_number,
           t.student_first_name,
           t.student_last_name,
           t.advisor_name,
           t.advisor_desk,
           t.school,
           t.specialty,
           t.finished_at AS visit_finished_at
         FROM ticket_reviews r
         JOIN tickets t ON t.id = r.ticket_id
         WHERE date(r.created_at, 'localtime') >= ? AND date(r.created_at, 'localtime') <= ?`;
    const params: (string | number)[] = [from, to];
    if (starsEq != null && Number.isFinite(starsEq) && starsEq >= 1 && starsEq <= 5) {
      sql += " AND r.stars = ?";
      params.push(Math.round(starsEq));
    }
    sql += " ORDER BY r.created_at DESC, r.ticket_id DESC";
    rows = db.prepare(sql).all(...params) as any[];
    if (schoolQ) rows = rows.filter((r) => String(r.school || "").toLowerCase().includes(schoolQ));
  }

  if (format === "csv") {
    const header =
      "ticket_id;queue_number;review_date;stars;student_last;student_first;manager;desk;school;specialty;visit_finished_at;review_text";
    const lines = rows.map((r) =>
      [
        r.ticket_id,
        formatQueueNumber(Number(r.queue_number)),
        String(r.review_at || "").slice(0, 19).replace("T", " "),
        r.stars,
        r.student_last_name,
        r.student_first_name,
        r.advisor_name,
        r.advisor_desk,
        r.school,
        r.specialty,
        r.visit_finished_at,
        r.review_comment,
      ]
        .map(csvCell)
        .join(";")
    );
    const csv = "\uFEFF" + [header, ...lines].join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="student-reviews.csv"');
    return res.send(csv);
  }

  res.json({
    from,
    to,
    rows: rows.map((r) => ({
      ...r,
      formatted_number: formatQueueNumber(Number(r.queue_number)),
    })),
  });
});

io.on("connection", (socket) => {
  socket.emit("queue:update", getLiveQueue());
});

if (NODE_ENV === "production") {
  const dist = path.join(process.cwd(), "dist");
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    // Express 5 / path-to-regexp: нельзя использовать app.get('*', …) — падает с PathError.
    app.use((req, res, next) => {
      if (
        req.method !== "GET" ||
        req.path.startsWith("/api") ||
        req.path.startsWith("/socket.io") ||
        req.path.startsWith("/flappy-bird")
      )
        return next();
      res.sendFile(path.join(dist, "index.html"));
    });
  }
}

const onListen = () => {
  console.log(`uni-q server listening on port ${PORT} (${NODE_ENV})`);
  console.log(`SQLite (очередь и талоны): ${path.resolve(SQLITE_PATH)}`);
  if (isPgCoreEnabled()) {
    console.log("PostgreSQL (core data mirror + restore): ON");
  }
  if (isPgHistoryEnabled()) {
    console.log(`PostgreSQL (история визитов ticket_visit_log): ON, UNIQ_REPORT_TZ=${reportTzLabel()}`);
  }
};

async function bootstrapPersistence() {
  if (!isPgCoreEnabled()) return;
  try {
    await ensurePgCoreSchema();
    const hasRemote = await pgCoreHasData();
    const localChecks = [
      Number((db.prepare("SELECT COUNT(*) AS c FROM advisors").get() as any)?.c || 0),
      Number((db.prepare("SELECT COUNT(*) AS c FROM tickets").get() as any)?.c || 0),
      Number((db.prepare("SELECT COUNT(*) AS c FROM admin_users").get() as any)?.c || 0),
      Number((db.prepare("SELECT COUNT(*) AS c FROM stats_events").get() as any)?.c || 0),
    ];
    const localHasData = localChecks.some((n) => Number(n) > 0);

    // Preferred behavior:
    // - If local SQLite already has data, keep it as source-of-truth and push to PostgreSQL.
    // - Only restore from PostgreSQL when local DB is empty (new disk / first deploy).
    if (hasRemote && !localHasData) {
      await pgRestoreCoreToSqlite(db);
      ensureRouteOwnersForWaitingTickets();
      console.log("[pg core] restored SQLite snapshot from PostgreSQL");
    } else {
      ensureRouteOwnersForWaitingTickets();
      await pgSyncCoreFromSqlite(db);
      console.log(hasRemote ? "[pg core] synced local SQLite snapshot to PostgreSQL" : "[pg core] pushed initial SQLite snapshot to PostgreSQL");
    }
  } catch (e) {
    console.error("[pg core bootstrap]", e);
  }
}

void (async () => {
  await bootstrapPersistence();
  // Ensure core users exist even if DB was empty/restored.
  ensureAdminSeed();
  ensureManagerSeed();
  schedulePgCoreSync();
  if (NODE_ENV === "production") {
    httpServer.listen(PORT, "0.0.0.0", onListen);
  } else {
    httpServer.listen(PORT, onListen);
  }
})();

async function gracefulFlushAndExit(signal: string) {
  console.log(`[shutdown] ${signal}`);
  try {
    await flushPgCoreSyncNow();
  } catch (e) {
    console.error("[shutdown flush]", e);
  }
  process.exit(0);
}

process.once("SIGTERM", () => {
  void gracefulFlushAndExit("SIGTERM");
});
process.once("SIGINT", () => {
  void gracefulFlushAndExit("SIGINT");
});

