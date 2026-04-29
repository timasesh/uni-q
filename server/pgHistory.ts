/**
 * Дублирование ticket_visit_log в PostgreSQL (Supabase), когда задан DATABASE_URL.
 * Очередь и талоны остаются в локальном SQLite; в облаке — строки истории визитов.
 */
import pg from "pg";

/** Часовой пояс для фильтрации по календарной дате (как date(..., 'localtime') в SQLite). */
const REPORT_TZ = process.env.UNIQ_REPORT_TZ || "Asia/Almaty";

let pool: pg.Pool | null = null;

export function isPgHistoryEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function initPgHistoryPool(): void {
  if (!isPgHistoryEnabled()) return;
  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "0" ? false : { rejectUnauthorized: false },
    max: 8,
  });
  pool.on("error", (e) => console.error("[pg history]", e));
}

export async function closePgHistoryPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** Асинхронная вставка; ошибки только в лог (не блокируем завершение талона в SQLite). */
export function fireVisitLogInsertPg(t: Record<string, unknown>, isRepeat: number): void {
  if (!pool) return;
  const vals = [
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
    isRepeat ? 1 : 0,
  ];
  void pool
    .query(
      `INSERT INTO ticket_visit_log (
         ticket_id, advisor_id, queue_number, status,
         student_first_name, student_last_name, school, specialty, language_section, course,
         created_at, called_at, started_at, finished_at,
         advisor_name, advisor_desk, comment, case_type, is_repeat
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      vals
    )
    .catch((e) => console.error("[pg ticket_visit_log insert]", e.message || e));
}

export async function pgAdminVisitsBetween(from: string, to: string): Promise<any[]> {
  if (!pool) return [];
  const { rows } = await pool.query(
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
       l.case_type,
       l.is_repeat
     FROM ticket_visit_log l
     LEFT JOIN tickets t ON t.id = l.ticket_id
     WHERE (l.finished_at AT TIME ZONE $1)::date >= $2::date
       AND (l.finished_at AT TIME ZONE $1)::date <= $3::date
     ORDER BY l.finished_at DESC NULLS LAST, l.id DESC`,
    [REPORT_TZ, from, to]
  );
  return rows;
}

export async function pgAdvisorVisitRows(advisorId: number, dayYmd: string, limit: number): Promise<any[]> {
  if (!pool) return [];
  const { rows } = await pool.query(
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
       l.is_repeat
     FROM ticket_visit_log l
     WHERE l.advisor_id = $1
       AND (l.finished_at AT TIME ZONE $3)::date = $2::date
     ORDER BY l.finished_at DESC NULLS LAST, l.id DESC
     LIMIT $4`,
    [advisorId, dayYmd, REPORT_TZ, limit]
  );
  return rows;
}

export function reportTzLabel(): string {
  return REPORT_TZ;
}
