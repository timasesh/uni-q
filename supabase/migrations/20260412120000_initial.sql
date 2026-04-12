-- Схема PostgreSQL, эквивалентная SQLite-приложению uni-q.
-- Выполните в Supabase: SQL Editor → New query → вставить → Run.
-- Использование: зеркало для отчётов, будущая миграция с better-sqlite3 на pg, или ручная синхронизация.

CREATE TABLE IF NOT EXISTS queue_session (
  id INTEGER PRIMARY KEY,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS advisors (
  id SERIAL PRIMARY KEY,
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
  reception_open INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS tickets (
  id SERIAL PRIMARY KEY,
  queue_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'WAITING',
  student_first_name TEXT,
  student_last_name TEXT,
  school TEXT,
  specialty TEXT,
  specialty_code TEXT,
  language_section TEXT,
  course TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  called_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  advisor_id INTEGER REFERENCES advisors (id),
  advisor_name TEXT,
  advisor_desk TEXT,
  advisor_faculty TEXT,
  advisor_department TEXT,
  comment TEXT,
  case_type TEXT,
  preferred_slot_at TIMESTAMPTZ,
  missed_student_note TEXT
);

CREATE TABLE IF NOT EXISTS admin_users (
  id SERIAL PRIMARY KEY,
  login TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT
);

CREATE TABLE IF NOT EXISTS advisor_work_totals (
  advisor_id INTEGER PRIMARY KEY REFERENCES advisors (id) ON DELETE CASCADE,
  total_ms BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS advisor_work_daily (
  advisor_id INTEGER NOT NULL REFERENCES advisors (id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  work_ms BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (advisor_id, day)
);

CREATE TABLE IF NOT EXISTS ticket_reviews (
  ticket_id INTEGER PRIMARY KEY REFERENCES tickets (id) ON DELETE CASCADE,
  stars INTEGER NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stats_events (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  meta TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ticket_visit_log (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
  advisor_id INTEGER REFERENCES advisors (id),
  queue_number INTEGER NOT NULL,
  status TEXT NOT NULL,
  student_first_name TEXT,
  student_last_name TEXT,
  school TEXT,
  specialty TEXT,
  language_section TEXT,
  course TEXT,
  created_at TIMESTAMPTZ,
  called_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  advisor_name TEXT,
  advisor_desk TEXT,
  comment TEXT,
  case_type TEXT,
  is_repeat INTEGER NOT NULL DEFAULT 0
);

INSERT INTO queue_session (id, is_active)
VALUES (1, 1)
ON CONFLICT (id) DO NOTHING;
