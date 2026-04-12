import type { Lang } from "../i18n";

/** 10 разделов × 10 вопросов = 100 записей на язык */
const SECTION_TITLES: Record<Lang, string[]> = {
  rus: [
    "Запись и очередь",
    "Документы и справки",
    "Оплата и договоры",
    "Учебный процесс",
    "Перевод и академический отпуск",
    "Иностранным студентам",
    "Кампус и инфраструктура",
    "Электронные сервисы",
    "Контакты эдвайзинг-центра",
    "Прочее",
  ],
  eng: [
    "Registration and queue",
    "Documents",
    "Payment and contracts",
    "Academic process",
    "Transfer and leave",
    "International students",
    "Campus",
    "Online services",
    "Advising center contacts",
    "Other",
  ],
  kaz: [
    "Жазылу және кезек",
    "Құжаттар мен анықтамалар",
    "Төлем және шарттар",
    "Оқу үдерісі",
    "Көшіру және демалыс",
    "Шетелдік студенттерге",
    "Кампус",
    "Электрондық қызметтер",
    "Эдвайзинг орталығы",
    "Басқа",
  ],
};

function buildItems(lang: Lang, sectionIndex: number) {
  const n = sectionIndex + 1;
  return Array.from({ length: 10 }, (_, qi) => {
    const m = qi + 1;
    const templates: Record<Lang, { q: string; a: string }> = {
      rus: {
        q: `Раздел ${n}, вопрос ${m}: что мне сделать в первую очередь?`,
        a: `Ответ ${n}.${m}: уточните детали у эдвайзера или на стойке информации. Актуальные правила публикуются на сайте университета.`,
      },
      eng: {
        q: `Section ${n}, Q${m}: what should I do first?`,
        a: `Answer ${n}.${m}: check with your advisor or the info desk. Official rules are published on the university website.`,
      },
      kaz: {
        q: `${n}-бөлім, ${m}-сұрақ: алдымен не істеу керек?`,
        a: `Жауап ${n}.${m}: эдвайзер немесе ақпарат орталығымен уағыттасыңыз. Ережелер университет сайтында жарияланады.`,
      },
    };
    return templates[lang];
  });
}

export function getFaqSections(lang: Lang): { title: string; items: { q: string; a: string }[] }[] {
  const titles = SECTION_TITLES[lang];
  return titles.map((title, si) => ({
    title,
    items: buildItems(lang, si),
  }));
}
