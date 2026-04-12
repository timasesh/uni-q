export type SpecialtyOption = { code: string; name: string };

export const SCHOOL_DATA: Record<string, { specialties: SpecialtyOption[] }> = {
  "Школа Цифровых Технологий": {
    specialties: [
      { code: "CS", name: "Computer Science" },
      { code: "SE", name: "Software Engineering" },
      { code: "IS", name: "Information Systems" },
      { code: "DS", name: "Data Science" },
    ],
  },
  "Школа Менеджмента": {
    specialties: [
      { code: "MNG", name: "Management" },
      { code: "MKT", name: "Marketing" },
      { code: "HR", name: "Human Resources" },
    ],
  },
  "Школа Экономики и Финансов": {
    specialties: [
      { code: "ECO", name: "Economics" },
      { code: "FIN", name: "Finance" },
      { code: "ACC", name: "Accounting" },
    ],
  },
  "Школа Гуманитарных и Социальных Наук": {
    specialties: [
      { code: "PSY", name: "Psychology" },
      { code: "SOC", name: "Sociology" },
      { code: "IR", name: "International Relations" },
    ],
  },
  "Школа Права": {
    specialties: [
      { code: "LAW", name: "Law" },
      { code: "JUR", name: "Jurisprudence" },
    ],
  },
};

export const SCHOOL_NAMES = Object.keys(SCHOOL_DATA);

/** Стабильные id для формы; apiName — значение для API (совпадает с ключами SCHOOL_DATA). */
export const SCHOOL_ENTRIES = SCHOOL_NAMES.map((apiName, i) => ({
  id: `s${i}`,
  apiName,
})) as { id: string; apiName: string }[];

export function schoolApiNameById(id: string): string | undefined {
  return SCHOOL_ENTRIES.find((e) => e.id === id)?.apiName;
}

export function specialtiesForSchool(schoolApiName: string): SpecialtyOption[] {
  return SCHOOL_DATA[schoolApiName]?.specialties ?? [];
}

export const LANGUAGE_OPTIONS = [
  { value: "ru", label: "Рус" },
  { value: "kz", label: "Каз" },
  { value: "en", label: "Анг" },
] as const;

