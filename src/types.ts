export type TicketStatus = "WAITING" | "CALLED" | "IN_SERVICE" | "MISSED" | "DONE" | "CANCELLED";

export type Ticket = {
  id: number;
  queue_number: number;
  formatted_number?: string;
  status: TicketStatus;
  student_first_name?: string | null;
  student_last_name?: string | null;
  school?: string | null;
  specialty?: string | null;
  specialty_code?: string | null;
  language_section?: string | null;
  course?: string | null;
  study_duration_years?: number | null;
  advisor_id?: number | null;
  /** Для WAITING: единственный менеджер, которому показывают этот талон (детерминированный выбор при пересечении зон). */
  route_advisor_id?: number | null;
  /** Для WAITING: менеджеры, которым талон виден по серверному scope. */
  visible_manager_ids?: number[] | null;
  advisor_name?: string | null;
  advisor_desk?: string | null;
  advisor_faculty?: string | null;
  advisor_department?: string | null;
  comment?: string | null;
  student_comment?: string | null;
  manager_attachment_name?: string | null;
  manager_attachment_data_url?: string | null;
  send_email_requested?: number | null;
  case_type?: string | null;
  case_subtype?: string | null;
  contact_type?: "QUESTION" | "CONSULTATION" | "PROBLEM" | null;
  estimated_time?: number | null;
  preferred_slot_at?: string | null;
  has_review?: number;
  /** Причина пропуска (студент); null — форма ещё не заполнена */
  missed_student_note?: string | null;
};

export type QueueSession = {
  id: number;
  is_active: boolean;
  created_at: string;
};

export type LiveQueue = {
  session: QueueSession;
  tickets: Ticket[];
};

export type Advisor = {
  id: number;
  name: string;
  faculty?: string | null;
  department?: string | null;
  desk_number?: string | null;
  assigned_schools_json?: string | null;
  assigned_language?: string | null;
  assigned_languages_json?: string | null;
  assigned_courses_json?: string | null;
  assigned_specialties_json?: string | null;
  assigned_study_years_json?: string | null;
  assigned_school_scopes_json?: string | null;
  /** Суммарное отработанное время на сервере (мс), см. advisor_work_totals */
  total_work_ms?: number;
  /** Запись в свою зону приёма (1 = открыта) */
  reception_open?: number | boolean;
};

