import cors from "cors";
import express from "express";
import session from "express-session";
import cookieParser from "cookie-parser";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import path from "path";
import fs from "fs";

type TicketStatus = "WAITING" | "CALLED" | "IN_SERVICE" | "MISSED" | "DONE" | "CANCELLED";

type AdvisorScope = {
  assigned_schools_json: string; // JSON array
  assigned_languages_json: string | null; // JSON array, null/[] => any
  assigned_courses_json: string; // JSON array
  assigned_specialties_json: string | null; // JSON array
};

const PORT = Number(process.env.PORT || 5174);
const WEB_ORIGIN = process.env.WEB_ORIGIN || "http://localhost:5173";
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";
const NODE_ENV = process.env.NODE_ENV || "development";
const SQLITE_PATH = process.env.SQLITE_PATH || "uni-q.sqlite";

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

// --- DB (файл на диске; на Render задайте SQLITE_PATH, см. DEPLOY-RENDER.md)
const dbDir = path.dirname(path.resolve(SQLITE_PATH));
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const db = new Database(SQLITE_PATH);
db.pragma("journal_mode = WAL");

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
  assigned_specialties_json TEXT
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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  called_at TEXT,
  started_at TEXT,
  finished_at TEXT,
  advisor_id INTEGER,
  advisor_name TEXT,
  advisor_desk TEXT,
  advisor_faculty TEXT,
  advisor_department TEXT,
  comment TEXT,
  case_type TEXT
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
  const advisorCols = db.prepare("PRAGMA table_info(advisors)").all() as { name: string }[];
  const advisorNames = new Set(advisorCols.map((c) => c.name));
  if (!advisorNames.has("reception_open")) {
    db.exec("ALTER TABLE advisors ADD COLUMN reception_open INTEGER NOT NULL DEFAULT 1");
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
  const has = db.prepare("SELECT 1 as ok FROM advisors LIMIT 1").get() as { ok: 1 } | undefined;
  if (!has) {
    db.prepare(
      `INSERT INTO advisors (name, faculty, department, desk_number, login, password_hash, assigned_schools_json, assigned_language, assigned_courses_json)
       VALUES (@name, @faculty, @department, @desk, @login, @hash, @schools, @lang, @courses)`
    ).run({
      name: "Д-р Смирнов",
      faculty: "Школа Цифровых Технологий",
      department: "Окно 1",
      desk: "1",
      login: "smirnov",
      hash: bcrypt.hashSync("Advisor2026!", 10),
      schools: JSON.stringify(["Школа Цифровых Технологий"]),
      lang: "any",
      courses: JSON.stringify([1, 2, 3, 4]),
    });
    db.prepare(
      `INSERT INTO advisors (name, faculty, department, desk_number, login, password_hash, assigned_schools_json, assigned_language, assigned_courses_json)
       VALUES (@name, @faculty, @department, @desk, @login, @hash, @schools, @lang, @courses)`
    ).run({
      name: "Проф. Иванов",
      faculty: "Школа Бизнеса",
      department: "Окно 2",
      desk: "2",
      login: "ivanov",
      hash: bcrypt.hashSync("Advisor2026!", 10),
      schools: JSON.stringify([]),
      lang: "any",
      courses: JSON.stringify([1, 2, 3, 4]),
    });
  }

  const s = db.prepare("SELECT 1 as ok FROM queue_session WHERE id = 1").get() as { ok: 1 } | undefined;
  if (!s) db.prepare("INSERT INTO queue_session (id, is_active) VALUES (1, 1)").run();
}
ensureSeed();

function ensureAdminSeed() {
  const has = db.prepare("SELECT 1 as ok FROM admin_users WHERE login = ?").get("timaadmin") as { ok: 1 } | undefined;
  if (!has) {
    db.prepare(`INSERT INTO admin_users (login, password_hash, name) VALUES (?, ?, ?)`).run(
      "timaadmin",
      bcrypt.hashSync("admin2010", 10),
      "Администратор"
    );
  }
}
ensureAdminSeed();
migrateDb();

function countWords(text: string | null | undefined): number {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/** Согласовано с клиентом `parseDeskWindowNumber`: номер окна 1…5 из поля стола. */
function deskWindowFromDb(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const m = String(raw).match(/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1 || n > 5) return null;
  return n;
}

function requireAdvisor(req: express.Request, res: express.Response, next: express.NextFunction) {
  const advisorId = (req.session as any).advisorId as number | undefined;
  if (!advisorId) return res.status(401).json({ error: "Не авторизован" });
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
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
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
}

function parseYmdParam(s: string): string | null {
  const t = String(s || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

function parseCourse(course: string | null | undefined): number | null {
  if (!course) return null;
  const m = String(course).match(/\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function advisorScope(advisorId: number): AdvisorScope {
  const row = db
    .prepare(
      `SELECT assigned_schools_json, assigned_languages_json, assigned_courses_json, assigned_specialties_json
       FROM advisors WHERE id = ?`
    )
    .get(advisorId) as Partial<AdvisorScope> | undefined;
  return {
    assigned_schools_json: row?.assigned_schools_json ?? "[]",
    assigned_languages_json: row?.assigned_languages_json ?? null,
    assigned_courses_json: row?.assigned_courses_json ?? "[1,2,3,4]",
    assigned_specialties_json: row?.assigned_specialties_json ?? null,
  };
}

/** Список эдвайзеров для расчёта маршрутизации талонов (кэш на один снимок очереди). */
function advisorsRowsForRouting(): any[] {
  return db
    .prepare(
      `SELECT id, reception_open, assigned_schools_json, assigned_languages_json, assigned_courses_json, assigned_specialties_json
       FROM advisors`
    )
    .all() as any[];
}

/**
 * Один «владелец» WAITING-талона среди эдвайзеров с открытой записью и подходящей зоной,
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
    };
    if (!ticketMatchesScope(ticket, scope)) continue;
    const id = Number(a.id);
    if (!Number.isFinite(id)) continue;
    if (best === null || id < best) best = id;
  }
  return best;
}

function ticketMatchesScope(ticket: any, scope: AdvisorScope): boolean {
  let schools: string[] = [];
  let langs: string[] | null = null;
  let courses: number[] = [1, 2, 3, 4];
  let specs: string[] | null = null;
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

  if (schools.length > 0) {
    const school = String(ticket.school || ticket.faculty || "");
    if (!school || !schools.includes(school)) return false;
  }
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
  return true;
}

/** Есть ли открытая запись хотя бы у одного эдвайзера, подходящего по профилю. */
function registrationOpenForStudent(body: {
  school?: string;
  language_section?: string;
  course?: string;
  specialty_code?: string;
}): { open: boolean; matchesAny: boolean } {
  const pseudo = {
    school: String(body.school || "").trim(),
    language_section: String(body.language_section || "").trim(),
    course: String(body.course || "").trim(),
    specialty_code: String(body.specialty_code || "").trim(),
  };
  const advisors = db
    .prepare(
      `SELECT id, reception_open, assigned_schools_json, assigned_languages_json, assigned_courses_json, assigned_specialties_json
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
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() <= now.getTime();
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
  const tickets = db
    .prepare(
      `SELECT id, queue_number, status, school, specialty, specialty_code, language_section, course,
              advisor_id, advisor_name, advisor_desk, advisor_faculty, advisor_department,
              comment, case_type, preferred_slot_at, created_at
       FROM tickets
       WHERE status IN ('WAITING','CALLED','IN_SERVICE')
       ORDER BY
         CASE status WHEN 'WAITING' THEN 0 ELSE 1 END,
         CASE WHEN status = 'WAITING' AND preferred_slot_at IS NOT NULL THEN preferred_slot_at ELSE '9999-12-31' END ASC,
         queue_number ASC`
    )
    .all() as any[];

  const advisorRows = advisorsRowsForRouting();
  return {
    session: sessionState,
    tickets: tickets.map((t) => ({
      ...t,
      formatted_number: formatQueueNumber(t.queue_number),
      route_advisor_id: t.status === "WAITING" ? pickRouteAdvisorIdForTicket(t, advisorRows) : null,
    })),
  };
}

function broadcastQueue() {
  io.emit("queue:update", getLiveQueue());
}

// --- API
app.get("/api/session", (_req, res) => res.json(getQueueSession()));
app.post("/api/session/start", requireAdvisor, (_req, res) => {
  db.prepare("UPDATE queue_session SET is_active = 1 WHERE id = 1").run();
  broadcastQueue();
  res.json(getQueueSession());
});
app.post("/api/session/stop", requireAdvisor, (_req, res) => {
  db.prepare("UPDATE queue_session SET is_active = 0 WHERE id = 1").run();
  broadcastQueue();
  res.json(getQueueSession());
});

/** Проверка: открыта ли запись для выбранного профиля (школа · язык · курс · спец.). */
app.post("/api/registration/check", (req, res) => {
  const { school, specialtyCode, languageSection, course } = (req.body || {}) as Record<string, unknown>;
  const result = registrationOpenForStudent({
    school: String(school || ""),
    specialty_code: String(specialtyCode || ""),
    language_section: String(languageSection || ""),
    course: String(course || ""),
  });
  res.json(result);
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
  (req.session as any).advisorId = row.id;
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
  delete (req.session as any).advisorId;
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

app.get("/api/admin/advisors", requireAdmin, (_req, res) => {
  const today = (db.prepare(`SELECT date('now', 'localtime') AS d`).get() as { d: string }).d;
  const rows = db
    .prepare(
      `SELECT a.id, a.name, a.faculty, a.department, a.desk_number, a.login,
              a.assigned_schools_json, a.assigned_languages_json, a.assigned_courses_json, a.assigned_specialties_json,
              COALESCE(d.work_ms, 0) AS work_ms_today
       FROM advisors a
       LEFT JOIN advisor_work_daily d ON d.advisor_id = a.id AND d.day = ?
       ORDER BY a.id ASC`
    )
    .all(today) as any[];
  res.json({ rows });
});

/** Назначить сотруднику окно 1…5 (в `desk_number` сохраняется «1»…«5»). У других сотрудников это окно сбрасывается. */
app.patch("/api/admin/advisors/:id/desk", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Неверный id" });
  const raw = (req.body || {}).window;
  const window =
    raw === null || raw === undefined || raw === ""
      ? null
      : Number(raw);
  if (window !== null && (!Number.isFinite(window) || window < 1 || window > 5)) {
    return res.status(400).json({ error: "Окно должно быть от 1 до 5 или пусто" });
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
  res.json({ ok: true });
});

app.get("/api/advisors/me", requireAdvisor, (req, res) => {
  const advisorId = (req.session as any).advisorId as number;
  const row = db
    .prepare(
      `SELECT a.id, a.name, a.faculty, a.department, a.desk_number,
              COALESCE(a.reception_open, 1) AS reception_open,
              a.assigned_schools_json, a.assigned_language,
              a.assigned_languages_json, a.assigned_courses_json, a.assigned_specialties_json,
              COALESCE(w.total_ms, 0) AS total_work_ms
       FROM advisors a
       LEFT JOIN advisor_work_totals w ON w.advisor_id = a.id
       WHERE a.id = ?`
    )
    .get(advisorId);
  res.json(row);
});

/** Открыть/закрыть запись только для своей зоны приёма (не вся очередь). */
app.patch("/api/advisors/me/reception", requireAdvisor, (req, res) => {
  const advisorId = (req.session as any).advisorId as number;
  const open = Boolean((req.body || {}).open);
  db.prepare("UPDATE advisors SET reception_open = ? WHERE id = ?").run(open ? 1 : 0, advisorId);
  broadcastQueue();
  const row = db
    .prepare(
      `SELECT a.id, a.name, a.faculty, a.department, a.desk_number,
              COALESCE(a.reception_open, 1) AS reception_open,
              a.assigned_schools_json, a.assigned_language,
              a.assigned_languages_json, a.assigned_courses_json, a.assigned_specialties_json,
              COALESCE(w.total_ms, 0) AS total_work_ms
       FROM advisors a
       LEFT JOIN advisor_work_totals w ON w.advisor_id = a.id
       WHERE a.id = ?`
    )
    .get(advisorId);
  res.json(row);
});

app.patch("/api/advisors/me/work-total", requireAdvisor, (req, res) => {
  const advisorId = (req.session as any).advisorId as number;
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
    const day = (db.prepare(`SELECT date('now', 'localtime') AS d`).get() as { d: string }).d;
    db.prepare(
      `INSERT INTO advisor_work_daily (advisor_id, day, work_ms)
       VALUES (?, ?, ?)
       ON CONFLICT(advisor_id, day) DO UPDATE SET
         work_ms = MAX(work_ms, excluded.work_ms)`
    ).run(advisorId, day, Math.floor(todayMs));
  }
  res.json({ ok: true });
});

app.get("/api/advisors/me/history", requireAdvisor, (req, res) => {
  const advisorId = (req.session as any).advisorId as number;
  const limitRaw = Number((req.query.limit as string) || 200);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 200;
  const dateQ = parseYmdParam(String(req.query.date || ""));
  const dayFilter = dateQ ?? (db.prepare(`SELECT date('now', 'localtime') AS d`).get() as { d: string }).d;

  const rows = db
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

app.patch("/api/advisors/me/scope", requireAdvisor, (req, res) => {
  const advisorId = (req.session as any).advisorId as number;
  const body = req.body || {};
  const schools = Array.isArray(body.assigned_schools_json) ? body.assigned_schools_json.map(String) : [];
  const langs = Array.isArray(body.assigned_languages_json) ? body.assigned_languages_json.map((x: any) => String(x).toLowerCase()) : [];
  const courses = Array.isArray(body.assigned_courses_json) ? body.assigned_courses_json.map((x: any) => Number(x)).filter((n: number) => n >= 1 && n <= 4) : [1, 2, 3, 4];
  const specs = Array.isArray(body.assigned_specialties_json) ? body.assigned_specialties_json.map(String) : [];

  if (schools.length === 0) return res.status(400).json({ error: "Выберите хотя бы одну школу" });

  db.prepare(
    `UPDATE advisors
     SET assigned_schools_json = ?,
         assigned_languages_json = ?,
         assigned_courses_json = ?,
         assigned_specialties_json = ?
     WHERE id = ?`
  ).run(
    JSON.stringify(schools),
    langs.length > 0 ? JSON.stringify(langs) : null,
    JSON.stringify(courses.length > 0 ? courses : [1, 2, 3, 4]),
    specs.length > 0 ? JSON.stringify(specs) : null,
    advisorId
  );
  const row = db
    .prepare(
      `SELECT id, name, faculty, department, desk_number, assigned_schools_json, assigned_language,
              assigned_languages_json, assigned_courses_json, assigned_specialties_json
       FROM advisors WHERE id = ?`
    )
    .get(advisorId);
  broadcastQueue();
  res.json(row);
});

app.get("/api/queue/live", (_req, res) => res.json(getLiveQueue()));

app.post("/api/tickets", (req, res) => {
  const {
    firstName,
    lastName,
    school,
    specialty,
    specialtyCode,
    languageSection,
    course,
    preferredSlotAt,
  } = (req.body || {}) as any;

  const reg = registrationOpenForStudent({
    school: String(school || ""),
    specialty_code: String(specialtyCode || ""),
    language_section: String(languageSection || ""),
    course: String(course || ""),
  });
  if (!reg.matchesAny) {
    return res.status(409).json({ error: "Нет линии приёма для указанных данных" });
  }
  if (!reg.open) {
    return res.status(409).json({ error: "Запись по вашему направлению сейчас закрыта эдвайзером" });
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
  const stmt = db.prepare(
    `INSERT INTO tickets
     (queue_number, status, student_first_name, student_last_name, school, specialty, specialty_code, language_section, course, preferred_slot_at)
     VALUES (@qn, 'WAITING', @fn, @ln, @school, @spec, @specCode, @lang, @course, @slot)`
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
    slot,
  });

  const ticket = db
    .prepare(
      `SELECT id, queue_number, status, school, specialty, specialty_code, language_section, course, preferred_slot_at
       FROM tickets WHERE id = ?`
    )
    .get(info.lastInsertRowid) as any;

  const estimated_time = computeEstimatedMinutes(ticket);
  broadcastQueue();
  res.json({ ...ticket, formatted_number: formatQueueNumber(ticket.queue_number), estimated_time });
});

app.get("/api/tickets/:id/status", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Неверный идентификатор" });
  const t = db
    .prepare(
      `SELECT t.id, t.queue_number, t.status, t.school, t.specialty, t.specialty_code, t.language_section, t.course,
              t.advisor_name, t.advisor_desk, t.advisor_faculty, t.advisor_department,
              t.comment, t.case_type, t.preferred_slot_at, t.missed_student_note,
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
  broadcastQueue();
  res.json({ ok: true, id });
});

app.post("/api/tickets/call-next", requireAdvisor, (req, res) => {
  const advisorId = (req.session as any).advisorId as number;

  const advisorRow = db
    .prepare("SELECT id, name, desk_number, faculty, department FROM advisors WHERE id = ?")
    .get(advisorId) as any;

  const waiting = db
    .prepare(
      `SELECT * FROM tickets WHERE status = 'WAITING'
       ORDER BY CASE WHEN preferred_slot_at IS NOT NULL THEN preferred_slot_at ELSE '9999-12-31' END ASC,
                queue_number ASC`
    )
    .all() as any[];
  const advisorRows = advisorsRowsForRouting();
  const now = new Date();
  const next = waiting.find(
    (t) => pickRouteAdvisorIdForTicket(t, advisorRows) === advisorId && bookingCallableNow(t.preferred_slot_at, now)
  );
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

  broadcastQueue();
  res.json({ ok: true, ticketId: next.id });
});

app.post("/api/tickets/:id/call-booked", requireAdvisor, (req, res) => {
  const advisorId = (req.session as any).advisorId as number;
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

  const routeId = pickRouteAdvisorIdForTicket(row, advisorsRowsForRouting());
  if (routeId !== advisorId) {
    return res.status(403).json({ error: "Этот талон в очереди другого эдвайзера по распределению зоны" });
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

  broadcastQueue();
  res.json({ ok: true, ticketId: id });
});

app.patch("/api/tickets/:id", requireAdvisor, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Неверный идентификатор" });
  const { status, comment, case_type } = (req.body || {}) as { status?: TicketStatus; comment?: string; case_type?: string | null };

  let row = db.prepare("SELECT * FROM tickets WHERE id = ?").get(id) as any;
  if (!row) return res.status(404).json({ error: "Талон не найден" });

  if (comment !== undefined) {
    db.prepare("UPDATE tickets SET comment = ? WHERE id = ?").run(String(comment), id);
  }
  if (case_type !== undefined) {
    db.prepare("UPDATE tickets SET case_type = ? WHERE id = ?").run(case_type === null ? null : String(case_type), id);
  }

  row = db.prepare("SELECT * FROM tickets WHERE id = ?").get(id) as any;

  if (status !== undefined) {
    const valid: TicketStatus[] = ["WAITING", "CALLED", "IN_SERVICE", "MISSED", "DONE", "CANCELLED"];
    if (!valid.includes(status)) return res.status(400).json({ error: "Неверный статус" });
    if (status === "DONE") {
      const validTypes = ["RETAKE", "PAYMENT", "DISCIPLINE", "OTHER"];
      if (!row.case_type || !validTypes.includes(String(row.case_type))) {
        return res.status(400).json({ error: "Укажите категорию обращения" });
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

    if (terminal && !wasTerminal) {
      const trow = db.prepare("SELECT * FROM tickets WHERE id = ?").get(id) as any;
      const prev = db.prepare("SELECT COUNT(*) as c FROM ticket_visit_log WHERE ticket_id = ?").get(id) as { c: number };
      insertVisitLogFromTicket(trow, prev.c > 0 ? 1 : 0);
    }
  }

  broadcastQueue();
  res.json({ ok: true });
});

app.post("/api/tickets/:id/review", (req, res) => {
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
  db.prepare(`INSERT INTO ticket_reviews (ticket_id, stars, comment) VALUES (?, ?, ?)`).run(
    id,
    st,
    String(comment || "").trim() || null
  );
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
  res.json({ ok: true });
});

/** Вернуть в очередь / снова на приём / правка комментария — не позже часа после завершения. */
app.post("/api/tickets/:id/reopen", requireAdvisor, (req, res) => {
  const advisorId = (req.session as any).advisorId as number;
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
    broadcastQueue();
    return res.json({ ok: true });
  }

  if (action === "queue") {
    const qn = nextQueueNumber();
    db.prepare(
      `UPDATE tickets SET
         status = 'WAITING',
         queue_number = ?,
         called_at = NULL,
         started_at = NULL,
         finished_at = NULL,
         advisor_id = NULL,
         advisor_name = NULL,
         advisor_desk = NULL,
         advisor_faculty = NULL,
         advisor_department = NULL
       WHERE id = ?`
    ).run(qn, id);
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
    broadcastQueue();
    return res.json({ ok: true });
  }

  res.status(400).json({ error: "Неизвестное действие" });
});

app.post("/api/stats/event", (req, res) => {
  const { event_type, meta } = (req.body || {}) as { event_type?: string; meta?: unknown };
  if (!event_type || typeof event_type !== "string") return res.status(400).json({ error: "Нужен event_type" });
  db.prepare(`INSERT INTO stats_events (event_type, meta) VALUES (?, ?)`).run(
    event_type.slice(0, 80),
    meta !== undefined ? JSON.stringify(meta) : null
  );
  res.json({ ok: true });
});

app.get("/api/admin/stats/summary", requireAdmin, (_req, res) => {
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

/** Открытия FAQ без талона по дням (событие faq_no_queue). format=csv — таблица для Excel. */
app.get("/api/admin/stats/faq-no-queue", requireAdmin, (req, res) => {
  const format = String(req.query.format || "json").toLowerCase();
  const rows = db
    .prepare(
      `SELECT date(created_at, 'localtime') AS day, COUNT(*) AS count
       FROM stats_events
       WHERE event_type = 'faq_no_queue'
       GROUP BY date(created_at, 'localtime')
       ORDER BY day ASC`
    )
    .all() as { day: string; count: number }[];

  if (format === "csv") {
    const header = "date;count";
    const lines = rows.map((r) => `${r.day};${r.count}`);
    const csv = "\uFEFF" + [header, ...lines].join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="faq-no-queue.csv"');
    return res.send(csv);
  }

  res.json({ series: rows });
});

/** Нагрузка по часам (локальное время): регистрации талонов и вызовы к окну, 9:00–18:00. */
app.get("/api/admin/stats/load", requireAdmin, (req, res) => {
  const dateStr = String(req.query.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return res.status(400).json({ error: "Укажите дату в формате YYYY-MM-DD" });
  }
  const startHour = 9;
  const endHour = 18;

  const regRows = db
    .prepare(
      `SELECT CAST(strftime('%H', created_at, 'localtime') AS INTEGER) AS hour, COUNT(*) AS c
       FROM tickets
       WHERE date(created_at, 'localtime') = ?
         AND CAST(strftime('%H', created_at, 'localtime') AS INTEGER) BETWEEN ? AND ?
       GROUP BY CAST(strftime('%H', created_at, 'localtime') AS INTEGER)`
    )
    .all(dateStr, startHour, endHour) as { hour: number; c: number }[];

  const callRows = db
    .prepare(
      `SELECT CAST(strftime('%H', called_at, 'localtime') AS INTEGER) AS hour, COUNT(*) AS c
       FROM tickets
       WHERE called_at IS NOT NULL
         AND date(called_at, 'localtime') = ?
         AND CAST(strftime('%H', called_at, 'localtime') AS INTEGER) BETWEEN ? AND ?
       GROUP BY CAST(strftime('%H', called_at, 'localtime') AS INTEGER)`
    )
    .all(dateStr, startHour, endHour) as { hour: number; c: number }[];

  const regMap = new Map<number, number>();
  for (const r of regRows) {
    if (r.hour != null && Number.isFinite(Number(r.hour))) regMap.set(Number(r.hour), Number(r.c));
  }
  const callMap = new Map<number, number>();
  for (const r of callRows) {
    if (r.hour != null && Number.isFinite(Number(r.hour))) callMap.set(Number(r.hour), Number(r.c));
  }

  const registrations: { hour: number; count: number }[] = [];
  const calls: { hour: number; count: number }[] = [];
  for (let h = startHour; h <= endHour; h++) {
    registrations.push({ hour: h, count: regMap.get(h) ?? 0 });
    calls.push({ hour: h, count: callMap.get(h) ?? 0 });
  }

  res.json({ date: dateStr, startHour, endHour, registrations, calls });
});

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  if (/[;\r\n"]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** История завершённых визитов за период (все эдвайзеры). format=csv — выгрузка для Excel. */
app.get("/api/admin/visits/history", requireAdmin, (req, res) => {
  const from = parseYmdParam(String(req.query.from || ""));
  const to = parseYmdParam(String(req.query.to || ""));
  if (!from || !to) return res.status(400).json({ error: "Укажите from и to в формате YYYY-MM-DD" });
  if (from > to) return res.status(400).json({ error: "Дата «с» не может быть позже «по»" });
  const format = String(req.query.format || "json").toLowerCase();

  const rows = db
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
         l.case_type,
         l.is_repeat
       FROM ticket_visit_log l
       WHERE date(l.finished_at, 'localtime') >= ? AND date(l.finished_at, 'localtime') <= ?
       ORDER BY l.finished_at DESC, l.id DESC`
    )
    .all(from, to) as any[];

  if (format === "csv") {
    const header =
      "ticket_id;queue_number;finished_date;status;repeat_call;student_last;student_first;school;specialty;lang_section;course;advisor;desk;case_type;comment;called_at;started_at;finished_at";
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
        r.advisor_name,
        r.advisor_desk,
        r.case_type,
        r.comment,
        r.called_at,
        r.started_at,
        r.finished_at,
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
      if (req.method !== "GET" || req.path.startsWith("/api") || req.path.startsWith("/socket.io")) return next();
      res.sendFile(path.join(dist, "index.html"));
    });
  }
}

const onListen = () => {
  console.log(`uni-q server listening on port ${PORT} (${NODE_ENV})`);
};
if (NODE_ENV === "production") {
  httpServer.listen(PORT, "0.0.0.0", onListen);
} else {
  httpServer.listen(PORT, onListen);
}

