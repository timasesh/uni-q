import pg from "pg";
import type Database from "better-sqlite3";

let pool: pg.Pool | null = null;

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

async function q(sql: string, params: unknown[] = []): Promise<pg.QueryResult<any>> {
  if (!pool) throw new Error("pg core pool is not initialized");
  return pool.query(sql, params);
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
      "SELECT id, name, faculty, department, desk_number, login, password_hash, assigned_schools_json, assigned_language, assigned_languages_json, assigned_courses_json, assigned_specialties_json, reception_open FROM advisors ORDER BY id ASC"
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
      "SELECT id, queue_number, status, student_first_name, student_last_name, school, specialty, specialty_code, language_section, course, created_at, called_at, started_at, finished_at, advisor_id, advisor_name, advisor_desk, advisor_faculty, advisor_department, comment, case_type, preferred_slot_at, missed_student_note FROM tickets ORDER BY id ASC"
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
        "created_at",
        "called_at",
        "started_at",
        "finished_at",
        "advisor_id",
        "advisor_name",
        "advisor_desk",
        "advisor_faculty",
        "advisor_department",
        "comment",
        "case_type",
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
      "SELECT id, name, faculty, department, desk_number, login, password_hash, assigned_schools_json, assigned_language, assigned_languages_json, assigned_courses_json, assigned_specialties_json, reception_open FROM advisors ORDER BY id ASC"
    ),
    q("SELECT id, login, password_hash, name FROM admin_users ORDER BY id ASC"),
    q("SELECT advisor_id, total_ms, updated_at FROM advisor_work_totals ORDER BY advisor_id ASC"),
    q("SELECT advisor_id, day, work_ms FROM advisor_work_daily ORDER BY advisor_id ASC, day ASC"),
    q(
      "SELECT id, queue_number, status, student_first_name, student_last_name, school, specialty, specialty_code, language_section, course, created_at, called_at, started_at, finished_at, advisor_id, advisor_name, advisor_desk, advisor_faculty, advisor_department, comment, case_type, preferred_slot_at, missed_student_note FROM tickets ORDER BY id ASC"
    ),
    q("SELECT ticket_id, stars, comment, created_at FROM ticket_reviews ORDER BY ticket_id ASC"),
    q("SELECT id, event_type, meta, created_at FROM stats_events ORDER BY id ASC"),
    q(
      "SELECT id, ticket_id, advisor_id, queue_number, status, student_first_name, student_last_name, school, specialty, language_section, course, created_at, called_at, started_at, finished_at, advisor_name, advisor_desk, comment, case_type, is_repeat FROM ticket_visit_log ORDER BY id ASC"
    ),
  ]);

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM ticket_reviews").run();
    db.prepare("DELETE FROM stats_events").run();
    db.prepare("DELETE FROM advisor_work_daily").run();
    db.prepare("DELETE FROM advisor_work_totals").run();
    db.prepare("DELETE FROM ticket_visit_log").run();
    db.prepare("DELETE FROM tickets").run();
    db.prepare("DELETE FROM admin_users").run();
    db.prepare("DELETE FROM advisors").run();
    db.prepare("DELETE FROM queue_session").run();

    for (const r of queueSession.rows) {
      db.prepare("INSERT INTO queue_session (id, is_active, created_at) VALUES (?, ?, ?)").run(r.id, r.is_active, r.created_at);
    }
    for (const r of advisors.rows) {
      db.prepare(
        `INSERT INTO advisors (id, name, faculty, department, desk_number, login, password_hash, assigned_schools_json, assigned_language, assigned_languages_json, assigned_courses_json, assigned_specialties_json, reception_open)
         VALUES (@id, @name, @faculty, @department, @desk_number, @login, @password_hash, @assigned_schools_json, @assigned_language, @assigned_languages_json, @assigned_courses_json, @assigned_specialties_json, @reception_open)`
      ).run(r as any);
    }
    for (const r of adminUsers.rows) {
      db.prepare("INSERT INTO admin_users (id, login, password_hash, name) VALUES (?, ?, ?, ?)").run(r.id, r.login, r.password_hash, r.name);
    }
    for (const r of workTotals.rows) {
      db.prepare("INSERT INTO advisor_work_totals (advisor_id, total_ms, updated_at) VALUES (?, ?, ?)").run(r.advisor_id, r.total_ms, r.updated_at);
    }
    for (const r of workDaily.rows) {
      db.prepare("INSERT INTO advisor_work_daily (advisor_id, day, work_ms) VALUES (?, ?, ?)").run(r.advisor_id, r.day, r.work_ms);
    }
    for (const r of tickets.rows) {
      db.prepare(
        `INSERT INTO tickets (id, queue_number, status, student_first_name, student_last_name, school, specialty, specialty_code, language_section, course, created_at, called_at, started_at, finished_at, advisor_id, advisor_name, advisor_desk, advisor_faculty, advisor_department, comment, case_type, preferred_slot_at, missed_student_note)
         VALUES (@id, @queue_number, @status, @student_first_name, @student_last_name, @school, @specialty, @specialty_code, @language_section, @course, @created_at, @called_at, @started_at, @finished_at, @advisor_id, @advisor_name, @advisor_desk, @advisor_faculty, @advisor_department, @comment, @case_type, @preferred_slot_at, @missed_student_note)`
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
