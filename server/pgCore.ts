import pg from "pg";
import type Database from "better-sqlite3";

let pool: pg.Pool | null = null;
const REPORT_TZ = process.env.UNIQ_REPORT_TZ || "Asia/Almaty";

export function isPgCoreEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function initPgCorePool(): void {
  if (!isPgCoreEnabled()) return;
  if (pool) return;
  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "0" ? false : { rejectUnauthorized: false },
    max: 4,
  });
  pool.on("error", (e) => console.error("[pg core]", e));
}

export async function ensurePgCoreSchema(): Promise<void> {
  if (!pool) return;
  await q("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS student_comment TEXT");
  await q("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS study_duration_years INTEGER");
  await q("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS route_advisor_id INTEGER");
  await q("ALTER TABLE advisors ADD COLUMN IF NOT EXISTS assigned_study_years_json TEXT");
}

async function q(sql: string, params: unknown[] = []): Promise<pg.QueryResult<any>> {
  if (!pool) throw new Error("pg core pool is not initialized");
  return pool.query(sql, params);
}

export async function pgAdminSummary(): Promise<{
  events: { event_type: string; count: number }[];
  reviewsTotal: number;
  ticketsToday: number;
  bookedSlotsLive: number;
}> {
  const [eventsR, reviewsR, todayR, bookedR] = await Promise.all([
    q("SELECT event_type, COUNT(*)::int AS count FROM stats_events GROUP BY event_type ORDER BY event_type ASC"),
    q("SELECT COUNT(*)::int AS c FROM ticket_reviews"),
    q(`SELECT COUNT(*)::int AS c FROM tickets WHERE (created_at AT TIME ZONE $1)::date = (NOW() AT TIME ZONE $1)::date`, [
      REPORT_TZ,
    ]),
    q(
      `SELECT COUNT(*)::int AS c FROM tickets WHERE preferred_slot_at IS NOT NULL AND status IN ('WAITING','CALLED','IN_SERVICE')`
    ),
  ]);
  return {
    events: eventsR.rows,
    reviewsTotal: Number(reviewsR.rows[0]?.c || 0),
    ticketsToday: Number(todayR.rows[0]?.c || 0),
    bookedSlotsLive: Number(bookedR.rows[0]?.c || 0),
  };
}

export async function pgFaqNoQueue(from?: string | null, to?: string | null): Promise<{ day: string; count: number }[]> {
  const params: unknown[] = [REPORT_TZ];
  let sql = `SELECT ((created_at AT TIME ZONE $1)::date)::text AS day, COUNT(*)::int AS count
             FROM stats_events
             WHERE event_type = 'faq_no_queue'`;
  if (from && to) {
    params.push(from, to);
    sql += ` AND (created_at AT TIME ZONE $1)::date >= $2::date AND (created_at AT TIME ZONE $1)::date <= $3::date`;
  }
  sql += ` GROUP BY (created_at AT TIME ZONE $1)::date ORDER BY day ASC`;
  const { rows } = await q(sql, params);
  return rows;
}

export async function pgAdminLoad(dateStr: string): Promise<{
  date: string;
  startHour: number;
  endHour: number;
  registrations: { hour: number; count: number }[];
  calls: { hour: number; count: number }[];
}> {
  const startHour = 9;
  const endHour = 18;
  const [regRows, callRows] = await Promise.all([
    q(
      `SELECT EXTRACT(HOUR FROM (created_at AT TIME ZONE $1))::int AS hour, COUNT(*)::int AS c
       FROM tickets
       WHERE (created_at AT TIME ZONE $1)::date = $2::date
         AND EXTRACT(HOUR FROM (created_at AT TIME ZONE $1)) BETWEEN $3 AND $4
       GROUP BY 1`,
      [REPORT_TZ, dateStr, startHour, endHour]
    ),
    q(
      `SELECT EXTRACT(HOUR FROM (called_at AT TIME ZONE $1))::int AS hour, COUNT(*)::int AS c
       FROM tickets
       WHERE called_at IS NOT NULL
         AND (called_at AT TIME ZONE $1)::date = $2::date
         AND EXTRACT(HOUR FROM (called_at AT TIME ZONE $1)) BETWEEN $3 AND $4
       GROUP BY 1`,
      [REPORT_TZ, dateStr, startHour, endHour]
    ),
  ]);
  const regMap = new Map<number, number>(regRows.rows.map((r) => [Number(r.hour), Number(r.c)]));
  const callMap = new Map<number, number>(callRows.rows.map((r) => [Number(r.hour), Number(r.c)]));
  const registrations = [];
  const calls = [];
  for (let h = startHour; h <= endHour; h++) {
    registrations.push({ hour: h, count: regMap.get(h) ?? 0 });
    calls.push({ hour: h, count: callMap.get(h) ?? 0 });
  }
  return { date: dateStr, startHour, endHour, registrations, calls };
}

export async function pgAdminBookings(from: string, to: string, status?: string, school?: string): Promise<any[]> {
  const params: unknown[] = [REPORT_TZ, from, to];
  let sql = `SELECT id AS ticket_id, queue_number, student_first_name, student_last_name, school, specialty,
                    preferred_slot_at, status, created_at, advisor_name, advisor_desk
             FROM tickets
             WHERE preferred_slot_at IS NOT NULL
               AND (preferred_slot_at AT TIME ZONE $1)::date >= $2::date
               AND (preferred_slot_at AT TIME ZONE $1)::date <= $3::date`;
  if (status) {
    params.push(status);
    sql += ` AND status = $${params.length}`;
  }
  if (school) {
    params.push(`%${school.toLowerCase()}%`);
    sql += ` AND LOWER(COALESCE(school, '')) LIKE $${params.length}`;
  }
  sql += ` ORDER BY preferred_slot_at ASC NULLS LAST, id ASC`;
  const { rows } = await q(sql, params);
  return rows;
}

export async function pgAdminReviews(from: string, to: string, stars?: number | null, school?: string): Promise<any[]> {
  const params: unknown[] = [REPORT_TZ, from, to];
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
             WHERE (r.created_at AT TIME ZONE $1)::date >= $2::date
               AND (r.created_at AT TIME ZONE $1)::date <= $3::date`;
  if (stars != null) {
    params.push(stars);
    sql += ` AND r.stars = $${params.length}`;
  }
  if (school) {
    params.push(`%${school.toLowerCase()}%`);
    sql += ` AND LOWER(COALESCE(t.school, '')) LIKE $${params.length}`;
  }
  sql += ` ORDER BY r.created_at DESC, r.ticket_id DESC`;
  const { rows } = await q(sql, params);
  return rows;
}

export async function pgAdminWaitTimes(
  from: string,
  to: string,
  status?: string,
  minWait?: number | null,
  maxWait?: number | null
): Promise<{
  summary: { count: number; avgMin: number; medianMin: number };
  rows: any[];
}> {
  const { rows } = await q(
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
         WHEN t.called_at IS NOT NULL THEN EXTRACT(EPOCH FROM (t.called_at - t.created_at)) / 60.0
         WHEN t.started_at IS NOT NULL THEN EXTRACT(EPOCH FROM (t.started_at - t.created_at)) / 60.0
         ELSE NULL
       END AS wait_minutes
     FROM tickets t
     WHERE (t.created_at AT TIME ZONE $1)::date >= $2::date
       AND (t.created_at AT TIME ZONE $1)::date <= $3::date
       AND t.status IN ('WAITING','CALLED','IN_SERVICE')
       AND (t.called_at IS NOT NULL OR t.started_at IS NOT NULL)
     UNION ALL
     SELECT
       l.ticket_id AS ticket_id,
       l.queue_number,
       l.student_first_name,
       l.student_last_name,
       l.school,
       l.status,
       l.created_at,
       l.called_at,
       l.started_at,
       CASE
         WHEN l.called_at IS NOT NULL THEN EXTRACT(EPOCH FROM (l.called_at - l.created_at)) / 60.0
         WHEN l.started_at IS NOT NULL THEN EXTRACT(EPOCH FROM (l.started_at - l.created_at)) / 60.0
         ELSE NULL
       END AS wait_minutes
     FROM ticket_visit_log l
     WHERE (l.created_at AT TIME ZONE $1)::date >= $2::date
       AND (l.created_at AT TIME ZONE $1)::date <= $3::date
       AND l.status IN ('DONE','MISSED','CANCELLED')
       AND (l.called_at IS NOT NULL OR l.started_at IS NOT NULL)`,
    [REPORT_TZ, from, to]
  );
  let filtered = rows.filter((r) => r.wait_minutes != null && Number(r.wait_minutes) >= 0);
  if (status) filtered = filtered.filter((r) => String(r.status || "").toUpperCase() === String(status).toUpperCase());
  if (minWait != null) filtered = filtered.filter((r) => Number(r.wait_minutes) >= minWait);
  if (maxWait != null) filtered = filtered.filter((r) => Number(r.wait_minutes) <= maxWait);
  const waits = filtered.map((r) => Number(r.wait_minutes)).sort((a, b) => a - b);
  const count = waits.length;
  const sum = waits.reduce((a, b) => a + b, 0);
  const avgMin = count ? sum / count : 0;
  const medianMin =
    count === 0 ? 0 : count % 2 === 1 ? waits[(count - 1) / 2]! : (waits[count / 2 - 1]! + waits[count / 2]!) / 2;
  return { summary: { count, avgMin, medianMin }, rows: filtered };
}

export async function pgCoreHasData(): Promise<boolean> {
  if (!pool) return false;
  const checks = await Promise.all([
    q("SELECT COUNT(*)::int AS c FROM advisors"),
    q("SELECT COUNT(*)::int AS c FROM tickets"),
    q("SELECT COUNT(*)::int AS c FROM admin_users"),
    q("SELECT COUNT(*)::int AS c FROM stats_events"),
  ]);
  return checks.some((r) => Number(r.rows[0]?.c || 0) > 0);
}

function sqliteRows(db: Database.Database, sql: string): any[] {
  return db.prepare(sql).all() as any[];
}

async function insertRows(
  client: pg.PoolClient,
  table: string,
  columns: string[],
  rows: Record<string, unknown>[]
): Promise<void> {
  if (rows.length === 0) return;
  const colsSql = columns.map((c) => `"${c}"`).join(", ");
  for (const row of rows) {
    const vals = columns.map((c) => row[c]);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    await client.query(`INSERT INTO ${table} (${colsSql}) VALUES (${placeholders})`, vals);
  }
}

async function setSerial(client: pg.PoolClient, table: string): Promise<void> {
  await client.query(
    `SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1), true)`,
    [table]
  );
}

export async function pgSyncCoreFromSqlite(db: Database.Database): Promise<void> {
  if (!pool) return;
  const snapshot = {
    queue_session: sqliteRows(db, "SELECT id, is_active, created_at FROM queue_session ORDER BY id ASC"),
    advisors: sqliteRows(
      db,
      "SELECT id, name, faculty, department, desk_number, login, password_hash, assigned_schools_json, assigned_language, assigned_languages_json, assigned_courses_json, assigned_specialties_json, assigned_study_years_json, reception_open FROM advisors ORDER BY id ASC"
    ),
    admin_users: sqliteRows(db, "SELECT id, login, password_hash, name FROM admin_users ORDER BY id ASC"),
    advisor_work_totals: sqliteRows(
      db,
      "SELECT advisor_id, total_ms, updated_at FROM advisor_work_totals ORDER BY advisor_id ASC"
    ),
    advisor_work_daily: sqliteRows(
      db,
      "SELECT advisor_id, day, work_ms FROM advisor_work_daily ORDER BY advisor_id ASC, day ASC"
    ),
    tickets: sqliteRows(
      db,
      "SELECT id, queue_number, status, student_first_name, student_last_name, school, specialty, specialty_code, language_section, course, study_duration_years, created_at, called_at, started_at, finished_at, advisor_id, route_advisor_id, advisor_name, advisor_desk, advisor_faculty, advisor_department, comment, case_type, student_comment, preferred_slot_at, missed_student_note FROM tickets ORDER BY id ASC"
    ),
    ticket_reviews: sqliteRows(
      db,
      "SELECT ticket_id, stars, comment, created_at FROM ticket_reviews ORDER BY ticket_id ASC"
    ),
    stats_events: sqliteRows(
      db,
      "SELECT id, event_type, meta, created_at FROM stats_events ORDER BY id ASC"
    ),
    ticket_visit_log: sqliteRows(
      db,
      "SELECT id, ticket_id, advisor_id, queue_number, status, student_first_name, student_last_name, school, specialty, language_section, course, created_at, called_at, started_at, finished_at, advisor_name, advisor_desk, comment, case_type, is_repeat FROM ticket_visit_log ORDER BY id ASC"
    ),
  };

  const hasAny =
    snapshot.advisors.length > 0 ||
    snapshot.admin_users.length > 0 ||
    snapshot.tickets.length > 0 ||
    snapshot.ticket_reviews.length > 0 ||
    snapshot.stats_events.length > 0 ||
    snapshot.ticket_visit_log.length > 0;
  if (!hasAny) {
    // Safety: never wipe remote core DB from an empty / ephemeral SQLite.
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "TRUNCATE TABLE ticket_reviews, stats_events, advisor_work_daily, advisor_work_totals, ticket_visit_log, tickets, admin_users, advisors, queue_session RESTART IDENTITY CASCADE"
    );
    await insertRows(client, "queue_session", ["id", "is_active", "created_at"], snapshot.queue_session);
    await insertRows(
      client,
      "advisors",
      [
        "id",
        "name",
        "faculty",
        "department",
        "desk_number",
        "login",
        "password_hash",
        "assigned_schools_json",
        "assigned_language",
        "assigned_languages_json",
        "assigned_courses_json",
        "assigned_specialties_json",
        "assigned_study_years_json",
        "reception_open",
      ],
      snapshot.advisors
    );
    await insertRows(client, "admin_users", ["id", "login", "password_hash", "name"], snapshot.admin_users);
    await insertRows(
      client,
      "advisor_work_totals",
      ["advisor_id", "total_ms", "updated_at"],
      snapshot.advisor_work_totals
    );
    await insertRows(
      client,
      "advisor_work_daily",
      ["advisor_id", "day", "work_ms"],
      snapshot.advisor_work_daily
    );
    await insertRows(
      client,
      "tickets",
      [
        "id",
        "queue_number",
        "status",
        "student_first_name",
        "student_last_name",
        "school",
        "specialty",
        "specialty_code",
        "language_section",
        "course",
        "study_duration_years",
        "created_at",
        "called_at",
        "started_at",
        "finished_at",
        "advisor_id",
        "route_advisor_id",
        "advisor_name",
        "advisor_desk",
        "advisor_faculty",
        "advisor_department",
        "comment",
        "case_type",
        "student_comment",
        "preferred_slot_at",
        "missed_student_note",
      ],
      snapshot.tickets
    );
    await insertRows(
      client,
      "ticket_reviews",
      ["ticket_id", "stars", "comment", "created_at"],
      snapshot.ticket_reviews
    );
    await insertRows(client, "stats_events", ["id", "event_type", "meta", "created_at"], snapshot.stats_events);
    await insertRows(
      client,
      "ticket_visit_log",
      [
        "id",
        "ticket_id",
        "advisor_id",
        "queue_number",
        "status",
        "student_first_name",
        "student_last_name",
        "school",
        "specialty",
        "language_section",
        "course",
        "created_at",
        "called_at",
        "started_at",
        "finished_at",
        "advisor_name",
        "advisor_desk",
        "comment",
        "case_type",
        "is_repeat",
      ],
      snapshot.ticket_visit_log
    );
    await setSerial(client, "advisors");
    await setSerial(client, "admin_users");
    await setSerial(client, "tickets");
    await setSerial(client, "stats_events");
    await setSerial(client, "ticket_visit_log");
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function pgRestoreCoreToSqlite(db: Database.Database): Promise<void> {
  if (!pool) return;
  const [
    queueSession,
    advisors,
    adminUsers,
    workTotals,
    workDaily,
    tickets,
    reviews,
    statsEvents,
    visitLog,
  ] = await Promise.all([
    q("SELECT id, is_active, created_at FROM queue_session ORDER BY id ASC"),
    q(
      "SELECT id, name, faculty, department, desk_number, login, password_hash, assigned_schools_json, assigned_language, assigned_languages_json, assigned_courses_json, assigned_specialties_json, assigned_study_years_json, reception_open FROM advisors ORDER BY id ASC"
    ),
    q("SELECT id, login, password_hash, name FROM admin_users ORDER BY id ASC"),
    q("SELECT advisor_id, total_ms, updated_at FROM advisor_work_totals ORDER BY advisor_id ASC"),
    q("SELECT advisor_id, day, work_ms FROM advisor_work_daily ORDER BY advisor_id ASC, day ASC"),
    q(
      "SELECT id, queue_number, status, student_first_name, student_last_name, school, specialty, specialty_code, language_section, course, study_duration_years, created_at, called_at, started_at, finished_at, advisor_id, route_advisor_id, advisor_name, advisor_desk, advisor_faculty, advisor_department, comment, case_type, student_comment, preferred_slot_at, missed_student_note FROM tickets ORDER BY id ASC"
    ),
    q("SELECT ticket_id, stars, comment, created_at FROM ticket_reviews ORDER BY ticket_id ASC"),
    q("SELECT id, event_type, meta, created_at FROM stats_events ORDER BY id ASC"),
    q(
      "SELECT id, ticket_id, advisor_id, queue_number, status, student_first_name, student_last_name, school, specialty, language_section, course, created_at, called_at, started_at, finished_at, advisor_name, advisor_desk, comment, case_type, is_repeat FROM ticket_visit_log ORDER BY id ASC"
    ),
  ]);

  const localAdvisorCount = Number((db.prepare("SELECT COUNT(*) AS c FROM advisors").get() as any)?.c || 0);
  const localAdminCount = Number((db.prepare("SELECT COUNT(*) AS c FROM admin_users").get() as any)?.c || 0);
  // Safety: do not wipe local users if remote snapshot lacks them.
  // This prevents "employees disappear after deploy restart" when PostgreSQL has tickets/stats but empty advisors/admins.
  const shouldRestoreAdvisors = advisors.rows.length > 0 || localAdvisorCount === 0;
  const shouldRestoreAdmins = adminUsers.rows.length > 0 || localAdminCount === 0;

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM ticket_reviews").run();
    db.prepare("DELETE FROM stats_events").run();
    db.prepare("DELETE FROM advisor_work_daily").run();
    db.prepare("DELETE FROM advisor_work_totals").run();
    db.prepare("DELETE FROM ticket_visit_log").run();
    db.prepare("DELETE FROM tickets").run();
    if (shouldRestoreAdmins) db.prepare("DELETE FROM admin_users").run();
    if (shouldRestoreAdvisors) db.prepare("DELETE FROM advisors").run();
    db.prepare("DELETE FROM queue_session").run();

    for (const r of queueSession.rows) {
      db.prepare("INSERT INTO queue_session (id, is_active, created_at) VALUES (?, ?, ?)").run(r.id, r.is_active, r.created_at);
    }
    if (shouldRestoreAdvisors) {
      for (const r of advisors.rows) {
        db.prepare(
          `INSERT INTO advisors (id, name, faculty, department, desk_number, login, password_hash, assigned_schools_json, assigned_language, assigned_languages_json, assigned_courses_json, assigned_specialties_json, assigned_study_years_json, reception_open)
           VALUES (@id, @name, @faculty, @department, @desk_number, @login, @password_hash, @assigned_schools_json, @assigned_language, @assigned_languages_json, @assigned_courses_json, @assigned_specialties_json, @assigned_study_years_json, @reception_open)`
        ).run(r as any);
      }
    }
    if (shouldRestoreAdmins) {
      for (const r of adminUsers.rows) {
        db.prepare("INSERT INTO admin_users (id, login, password_hash, name) VALUES (?, ?, ?, ?)").run(r.id, r.login, r.password_hash, r.name);
      }
    }
    for (const r of workTotals.rows) {
      db.prepare("INSERT INTO advisor_work_totals (advisor_id, total_ms, updated_at) VALUES (?, ?, ?)").run(r.advisor_id, r.total_ms, r.updated_at);
    }
    for (const r of workDaily.rows) {
      db.prepare("INSERT INTO advisor_work_daily (advisor_id, day, work_ms) VALUES (?, ?, ?)").run(r.advisor_id, r.day, r.work_ms);
    }
    for (const r of tickets.rows) {
      db.prepare(
        `INSERT INTO tickets (id, queue_number, status, student_first_name, student_last_name, school, specialty, specialty_code, language_section, course, study_duration_years, created_at, called_at, started_at, finished_at, advisor_id, route_advisor_id, advisor_name, advisor_desk, advisor_faculty, advisor_department, comment, case_type, student_comment, preferred_slot_at, missed_student_note)
         VALUES (@id, @queue_number, @status, @student_first_name, @student_last_name, @school, @specialty, @specialty_code, @language_section, @course, @study_duration_years, @created_at, @called_at, @started_at, @finished_at, @advisor_id, @route_advisor_id, @advisor_name, @advisor_desk, @advisor_faculty, @advisor_department, @comment, @case_type, @student_comment, @preferred_slot_at, @missed_student_note)`
      ).run(r as any);
    }
    for (const r of reviews.rows) {
      db.prepare("INSERT INTO ticket_reviews (ticket_id, stars, comment, created_at) VALUES (?, ?, ?, ?)").run(r.ticket_id, r.stars, r.comment, r.created_at);
    }
    for (const r of statsEvents.rows) {
      db.prepare("INSERT INTO stats_events (id, event_type, meta, created_at) VALUES (?, ?, ?, ?)").run(r.id, r.event_type, r.meta, r.created_at);
    }
    for (const r of visitLog.rows) {
      db.prepare(
        `INSERT INTO ticket_visit_log (id, ticket_id, advisor_id, queue_number, status, student_first_name, student_last_name, school, specialty, language_section, course, created_at, called_at, started_at, finished_at, advisor_name, advisor_desk, comment, case_type, is_repeat)
         VALUES (@id, @ticket_id, @advisor_id, @queue_number, @status, @student_first_name, @student_last_name, @school, @specialty, @language_section, @course, @created_at, @called_at, @started_at, @finished_at, @advisor_name, @advisor_desk, @comment, @case_type, @is_repeat)`
      ).run(r as any);
    }
  });
  tx();
}
