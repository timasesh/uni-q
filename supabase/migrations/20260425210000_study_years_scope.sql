ALTER TABLE advisors
  ADD COLUMN IF NOT EXISTS assigned_study_years_json TEXT;

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS study_duration_years INTEGER;

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS route_advisor_id INTEGER;
