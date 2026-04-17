export type SpecialtyOption = { code: string; name: string };

export const SCHOOL_DATA: Record<string, { specialties: SpecialtyOption[] }> = {
  "Школа менеджмента": {
    specialties: [
      { code: "6B03103", name: "Спортивная психология" },
      { code: "6B04101", name: "Менеджмент" },
      { code: "6B04104", name: "Маркетинг" },
      { code: "6B04124", name: "Цифровой Маркетинг" },
      { code: "6B04189", name: "Урбанистика и сити-менеджмент" },
      { code: "6B04192", name: "Глобальный менеджмент" },
      { code: "6B04194", name: "Спортивный менеджмент" },
      { code: "6B11101", name: "Ресторанное дело и гостиничный бизнес" },
      { code: "6B11188", name: "Туризм и ивент-менеджмент" },
      { code: "6B11301", name: "Логистика" },
      { code: "7M04101", name: "Менеджмент" },
      { code: "7M04102", name: "Управление проектами" },
      { code: "7M04105", name: "Маркетинг" },
      { code: "7M04112", name: "Управление проектами" },
      { code: "7M04114", name: "Маркетинг" },
      { code: "7M11304", name: "Supply Chain Management (2 г.о)" },
      { code: "8D04101", name: "Менеджмент" },
      { code: "8D04103", name: "Маркетинг" },
    ],
  },

  "School of Digital Technologies and Economics": {
    specialties: [
      { code: "6B04105", name: "Финансы" },
      { code: "6B04106", name: "Учет и аудит" },
      { code: "6B04190", name: "Бизнес аналитика и экономика" },
      { code: "6B06101", name: "Информационные системы" },
      { code: "6B06103", name: "Инженерия программного обеспечения (Software Engineering)" },
      { code: "6B06104", name: "Data Science" },
      { code: "6B06105", name: "Product Management" },
      { code: "6B06109", name: "Разработка программного обеспечения и защита информации" },
      { code: "7M04106", name: "Финансы" },
      { code: "8D04104", name: "Финансы" },
    ],
  },

  "School of Transformative Humanities and Education": {
    specialties: [
      { code: "6B03088", name: "Международные отношения и экономика" },
      { code: "6B03188", name: "Международные отношения и экономика" },
      { code: "6B04201", name: "Юриспруденция" },
      { code: "6B04203", name: "Юриспруденция" },
      { code: "7M04201", name: "Юриспруденция" },
      { code: "7M04203", name: "Юриспруденция" },
    ],
  },

  "Институт предпринимательства": {
    specialties: [
      { code: "6B04103", name: "Бизнес администрирование в области предпринимательства" },
      { code: "6B04127", name: "Международный бизнес" },
    ],
  },

  "Высшая Школа Бизнеса": {
    specialties: [
      { code: "7M04103", name: "Деловое администрирование" },
      { code: "7M04132", name: "Executive MBA «Стратегическое управление и лидерство»" },
      { code: "7M04133", name: "Деловое Администрирование (General MBA)" },
      { code: "7M04135", name: "Деловое Администрирование «Финансовый Инжиниринг»" },
      { code: "7M04136", name: "Деловое администрирование Executive MBA" },
      { code: "8D04102", name: "Деловое администрирование" },
    ],
  },

  "Школа медиа и кино": {
    specialties: [
      { code: "6B02103", name: "Цифровое кинопроизводство" },
      { code: "6B03201", name: "Связь с общественностью" },
      { code: "6B03203", name: "Новые медиа" },
    ],
  },

  "Центр междисциплинарных программ": {
    specialties: [
      { code: "6B03204", name: "Content, Marketing and Data Analysis (Media)" },
      { code: "6B04120", name: "Content, Marketing and Data Analysis (Marketing)" },
      { code: "6B04125", name: "Fintech and Artificial Intelligence" },
      { code: "6B06088", name: "Content, Marketing and Data Analysis (Digital)" },
    ],
  },

  "AlmaU Sharmanov School of Health Sciences": {
    specialties: [{ code: "6B03104", name: "Психология" }],
  },
};

export const SCHOOL_NAMES = Object.keys(SCHOOL_DATA);

/** Стабильные id для формы; apiName — значение для API (совпадает с ключами SCHOOL_DATA). */
export const SCHOOL_ENTRIES = SCHOOL_NAMES.map((apiName, i) => ({
  id: `s${i}`,
  apiName,
  label: apiName,
})) as { id: string; apiName: string; label: string }[];

export function schoolApiNameById(id: string): string | undefined {
  return SCHOOL_ENTRIES.find((e) => e.id === id)?.apiName;
}

export function specialtiesForSchool(schoolApiName: string): SpecialtyOption[] {
  // Возвращаем полный список программ для выбранной школы.
  // Если позже понадобится строгий фильтр по форме обучения (например только 6B), его лучше делать отдельным параметром/переключателем в UI.
  return SCHOOL_DATA[schoolApiName]?.specialties ?? [];
}

export const LANGUAGE_OPTIONS = [
  { value: "ru", label: "Рус" },
  { value: "kz", label: "Каз" },
  { value: "en", label: "Анг" },
] as const;

