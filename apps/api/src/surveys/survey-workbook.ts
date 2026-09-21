import ExcelJS from "exceljs";
import {
  compareWaves,
  compareWavesByChild,
  type Wave,
  type WaveQuestion,
} from "./survey-comparison";
import { indicatorsOf, matrixOptions, scoreOf } from "./survey-scoring";

/**
 * The five-sheet survey workbook — RFP Module 1.3.
 *
 * §1.3 names the five sheets and their order exactly, so this file follows it
 * literally: Summary, Raw Data, Child Comparison, Group Comparison, Year
 * Comparison. A workbook that renamed or merged them would fail the acceptance
 * reading even if the numbers were right.
 *
 * ★ Scoring and pairing come from `survey-scoring.ts` and
 * `survey-comparison.ts`, never recomputed here.
 *
 * Sheets 3 and 4 are the API's comparison rendered into cells. If this file did
 * its own arithmetic, a client opening the workbook beside the screen would
 * eventually find two different progress figures for the same child, with
 * nothing to say which was right.
 *
 * ★★ Every header is Mongolian, because the person opening this file is the
 * kindergarten's administrator, not a developer. Identifiers stay English
 * everywhere else in the codebase; a spreadsheet is user-facing text.
 */

export interface WorkbookChild {
  id: string;
  lastName: string;
  firstName: string;
  dateOfBirth: string | null;
  sex: string | null;
  groupName: string | null;
}

export interface WorkbookResponse {
  id: string;
  childId: string | null;
  submittedAt: string;
  respondentName: string;
  /** Whether a teacher or a guardian filled it in — §1.3 asks for this. */
  respondentRole: string;
}

export interface SurveyWave {
  id: string;
  title: string;
  schoolYear: string | null;
  period: string | null;
  /** ISO, or null for a wave that was never published. Names a comparison column. */
  publishedAt?: string | null;
  /**
   * Whether this wave promised its respondents anonymity — 2026-09-10.
   *
   * ★ The raw sheet is where that promise is kept or broken.
   *
   * Sheet 2 is one row per answer carrying the child's name, the group, the
   * age, the sex and who submitted it — which is a re-identification table for
   * a survey that told families their answers were unnamed. The aggregates on
   * every other sheet are safe; this one is not, so the identifying columns
   * are blanked here rather than the sheet being dropped: an administrator
   * still needs the answers, they just do not get the names.
   *
   * Optional so a caller that predates the field keeps its current behaviour,
   * which is the correct one for every survey written before it.
   */
  isAnonymous?: boolean;
  questions: WaveQuestion[];
  answers: (Wave["answers"][number] & { responseId: string })[];
  responses: WorkbookResponse[];
}

export interface WorkbookInput {
  /** The survey being exported. */
  survey: SurveyWave;
  /** Its baseline pair, when one exists — Sheets 3 and 4 need two waves. */
  baseline: SurveyWave | null;
  /** Earlier school years' endline waves, for Sheet 5. */
  priorYears: SurveyWave[];
  children: WorkbookChild[];
  kindergartenName: string;
}

const PERIOD_LABEL: Record<string, string> = {
  BASELINE: "Эхний үнэлгээ",
  MIDLINE: "Завсрын үнэлгээ",
  ENDLINE: "Жилийн эцсийн үнэлгээ",
};

const ROLE_LABEL: Record<string, string> = {
  TEACHER: "Багш",
  ADMIN: "Администратор",
  GUARDIAN: "Эцэг эх",
};

/** Builds the workbook and returns it as a buffer, ready to stream. */
export async function buildSurveyWorkbook(input: WorkbookInput): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = "NomadKids";
  book.created = new Date();

  const childById = new Map(input.children.map((child) => [child.id, child]));

  writeSummary(book, input);
  writeRawData(book, input, childById);
  writeChildComparison(book, input, childById);
  writeGroupComparison(book, input);
  writeYearComparison(book, input);

  // `as Buffer` because exceljs types this as its own ArrayBuffer alias while
  // returning a Node Buffer — a known gap in its type definitions.
  return (await book.xlsx.writeBuffer()) as unknown as Buffer;
}

/** Sheet 1 — Summary: the survey's headline figures. */
function writeSummary(book: ExcelJS.Workbook, input: WorkbookInput) {
  const sheet = book.addWorksheet("Нэгтгэл");
  sheet.columns = [{ width: 32 }, { width: 46 }];

  const { survey } = input;
  const answered = new Set(survey.responses.map((r) => r.childId).filter(Boolean)).size;

  const rows: [string, string | number][] = [
    ["Цэцэрлэг", input.kindergartenName],
    ["Судалгааны нэр", survey.title],
    ["Хичээлийн жил", survey.schoolYear ?? "—"],
    ["Үнэлгээний үе", survey.period ? (PERIOD_LABEL[survey.period] ?? survey.period) : "—"],
    ["Асуултын тоо", survey.questions.length],
    ["Хариулсан тоо", survey.responses.length],
    ["Хамрагдсан хүүхэд", answered],
    ["Нийт хариулт", survey.answers.length],
    ["Татсан огноо", new Date().toLocaleDateString("mn-MN")],
  ];

  sheet.addRow(["Судалгааны нэгтгэл"]).font = { bold: true, size: 14 };
  sheet.addRow([]);

  for (const [label, value] of rows) {
    const row = sheet.addRow([label, value]);
    row.getCell(1).font = { bold: true };
  }

  if (input.baseline) {
    sheet.addRow([]);
    sheet.addRow(["Харьцуулсан судалгаа", input.baseline.title]).getCell(1).font = { bold: true };

    const comparison = compareWaves(waveOf(input.baseline), waveOf(survey));
    const scored = comparison.filter((row) => row.deltaPercent !== null);

    sheet.addRow(["Харьцуулагдсан үзүүлэлт", comparison.length]).getCell(1).font = { bold: true };

    if (scored.length > 0) {
      // Already sorted best-first by `compareWaves`, so the ends of the array
      // are the two facts Module 1.2 asks to surface.
      const best = scored[0]!;
      const worst = scored[scored.length - 1]!;

      sheet
        .addRow(["Хамгийн их ахисан", `${best.label} (${signed(best.deltaPercent)}%)`])
        .getCell(1).font = { bold: true };
      sheet
        .addRow(["Нэмэлт дэмжлэг шаардлагатай", `${worst.label} (${signed(worst.deltaPercent)}%)`])
        .getCell(1).font = { bold: true };
    }
  }
}

/**
 * Sheet 2 — Raw Data: §1.3's "Бүх хариултын өгөгдөл".
 *
 * ★ A MATRIX answer becomes one row per matrix row, not one row holding JSON.
 *
 * §1.3 lists "асуулт, хариулт, оноо" as separate columns, which a JSON blob in
 * a cell cannot provide — and the whole point of the type is that each row is
 * its own indicator. Fanning out is what makes the sheet filterable, which is
 * the only reason to export raw data to a spreadsheet at all.
 */
function writeRawData(
  book: ExcelJS.Workbook,
  input: WorkbookInput,
  childById: Map<string, WorkbookChild>,
) {
  const sheet = book.addWorksheet("Түүхий өгөгдөл");

  sheet.columns = [
    { header: "Судалгаа", key: "survey", width: 26 },
    { header: "Хичээлийн жил", key: "year", width: 14 },
    { header: "Үе", key: "period", width: 18 },
    { header: "Бүлэг", key: "group", width: 16 },
    { header: "Хүүхдийн нэр", key: "child", width: 24 },
    { header: "Нас", key: "age", width: 7 },
    { header: "Хүйс", key: "sex", width: 8 },
    { header: "Асуулт", key: "question", width: 40 },
    { header: "Үзүүлэлт", key: "indicator", width: 22 },
    { header: "Хариулт", key: "answer", width: 26 },
    { header: "Оноо", key: "score", width: 8 },
    { header: "Бөглөсөн", key: "respondent", width: 22 },
    { header: "Хэн", key: "role", width: 14 },
    { header: "Огноо", key: "submitted", width: 14 },
  ];
  headerStyle(sheet);

  const { survey } = input;
  const hidden = survey.isAnonymous === true;
  const questionById = new Map(survey.questions.map((q) => [q.id, q]));
  const responseById = new Map(survey.responses.map((r) => [r.id, r]));

  for (const answer of survey.answers) {
    const question = questionById.get(answer.questionId);
    if (!question) continue;

    const response = responseById.get(answer.responseId);
    const child = answer.childId ? childById.get(answer.childId) : undefined;
    const matrix = matrixOptions(question);

    for (const { rowKey } of indicatorsOf(question)) {
      const score = scoreOf(question, answer.value, rowKey);

      // A matrix row nobody filled in produces no row at all, rather than a
      // row of blanks that would inflate the sheet's apparent response count.
      if (rowKey !== null && score === null) continue;

      sheet.addRow({
        survey: survey.title,
        year: survey.schoolYear ?? "—",
        period: survey.period ? (PERIOD_LABEL[survey.period] ?? survey.period) : "—",
        /*
          ★ The group survives anonymity; the child does not.

          A group of eighteen is not identifying and it is the unit every
          analysis of this sheet is grouped by — losing it would make the
          export useless for the question it is run for. A name, a birth date
          and a sex together identify one family in any kindergarten, and the
          age is dropped with the name for that reason rather than because
          anybody asked.
        */
        group: child?.groupName ?? "—",
        child: hidden ? "—" : child ? `${child.lastName} ${child.firstName}` : "—",
        age: hidden ? "—" : child?.dateOfBirth ? ageOn(child.dateOfBirth) : "—",
        sex: hidden ? "—" : child?.sex === "MALE" ? "Хүү" : child?.sex === "FEMALE" ? "Охин" : "—",
        question: question.prompt,
        indicator:
          rowKey !== null
            ? (matrix?.rows.find((r) => r.key === rowKey)?.label ?? rowKey)
            : (question.indicatorKey ?? "—"),
        answer: readableAnswer(question, answer.value, rowKey),
        score: score ?? "—",
        respondent: hidden ? "—" : (response?.respondentName ?? "—"),
        // The role stays: "a guardian answered" names nobody, and Module 1.3
        // asks for the teacher/guardian split.
        role: response ? (ROLE_LABEL[response.respondentRole] ?? response.respondentRole) : "—",
        submitted: response ? response.submittedAt.slice(0, 10) : "—",
      });
    }
  }
}

/** Sheet 3 — Child Comparison: each child's begin-to-end movement. */
function writeChildComparison(
  book: ExcelJS.Workbook,
  input: WorkbookInput,
  childById: Map<string, WorkbookChild>,
) {
  const sheet = book.addWorksheet("Хүүхдийн харьцуулалт");

  sheet.columns = [
    { header: "Бүлэг", key: "group", width: 16 },
    { header: "Хүүхдийн нэр", key: "child", width: 24 },
    { header: "Үзүүлэлт", key: "indicator", width: 28 },
    { header: "Эхний", key: "baseline", width: 10 },
    { header: "Эцсийн", key: "endline", width: 10 },
    { header: "Зөрүү", key: "delta", width: 10 },
    { header: "Ахиц %", key: "percent", width: 10 },
  ];
  headerStyle(sheet);

  if (!input.baseline) {
    noPairNote(sheet, 7);
    return;
  }

  const rows = compareWavesByChild(waveOf(input.baseline), waveOf(input.survey));

  for (const { childId, indicators } of rows) {
    const child = childById.get(childId);

    for (const row of indicators) {
      sheet.addRow({
        group: child?.groupName ?? "—",
        child: child ? `${child.lastName} ${child.firstName}` : "—",
        indicator: row.label,
        baseline: row.baselineMean ?? "—",
        endline: row.endlineMean ?? "—",
        delta: row.delta ?? "—",
        percent: row.deltaPercent ?? "—",
      });
    }
  }

  if (sheet.rowCount === 1) noPairNote(sheet, 7, "Харьцуулах хариулт олдсонгүй.");
}

/** Sheet 4 — Group Comparison: the whole cohort, indicator by indicator. */
function writeGroupComparison(book: ExcelJS.Workbook, input: WorkbookInput) {
  const sheet = book.addWorksheet("Бүлгийн харьцуулалт");

  sheet.columns = [
    { header: "Үзүүлэлт", key: "indicator", width: 32 },
    { header: "Эхний дундаж", key: "baseline", width: 14 },
    { header: "Эцсийн дундаж", key: "endline", width: 14 },
    { header: "Зөрүү", key: "delta", width: 10 },
    { header: "Ахиц %", key: "percent", width: 10 },
    { header: "Дээд оноо", key: "max", width: 10 },
    { header: "Эхний хариулт", key: "nBase", width: 14 },
    { header: "Эцсийн хариулт", key: "nEnd", width: 14 },
  ];
  headerStyle(sheet);

  if (!input.baseline) {
    noPairNote(sheet, 8);
    return;
  }

  for (const row of compareWaves(waveOf(input.baseline), waveOf(input.survey))) {
    sheet.addRow({
      indicator: row.label,
      baseline: row.baselineMean ?? "—",
      endline: row.endlineMean ?? "—",
      delta: row.delta ?? "—",
      percent: row.deltaPercent ?? "—",
      max: row.maxScore ?? "—",
      nBase: row.baselineCount,
      nEnd: row.endlineCount,
    });
  }
}

/**
 * Sheet 5 — Year Comparison: §1.2's "урт хугацааны хөгжлийн зураглал".
 *
 * One column per school year, one row per indicator, so a reader scans left to
 * right across 2024–2025, 2025–2026 and sees the trajectory. Years with no
 * wave are simply absent rather than zero-filled.
 */
function writeYearComparison(book: ExcelJS.Workbook, input: WorkbookInput) {
  const sheet = book.addWorksheet("Жилийн харьцуулалт");

  const waves = [...input.priorYears, input.survey]
    .filter((wave) => wave.schoolYear !== null)
    .sort((a, b) => (a.schoolYear ?? "").localeCompare(b.schoolYear ?? ""));

  if (waves.length < 2) {
    sheet.columns = [{ width: 60 }];
    sheet.addRow(["Хичээлийн жил"]).font = { bold: true };
    sheet.addRow([
      "Харьцуулах хоёр дахь жилийн судалгаа алга. Дараагийн жилийн үнэлгээ бүртгэгдсэний дараа энэ хуудас дүүрнэ.",
    ]);
    return;
  }

  sheet.columns = [
    { header: "Үзүүлэлт", key: "indicator", width: 32 },
    ...waves.map((wave) => ({ header: wave.schoolYear!, key: wave.id, width: 14 })),
  ];
  headerStyle(sheet);

  // Every indicator any year measured, in the most recent year's order so the
  // sheet reads as "this year's indicators, with their history".
  const labels = new Map<string, string>();
  const perWave = waves.map((wave) => {
    const scores = new Map<string, number>();

    // Comparing a wave with itself yields its own means, which is exactly the
    // per-indicator average this sheet needs — and reuses the one scoring path.
    for (const row of compareWaves(waveOf(wave), waveOf(wave))) {
      const key = `${row.indicatorKey}|${row.rowKey ?? ""}`;
      labels.set(key, row.label);
      if (row.endlineMean !== null) scores.set(key, row.endlineMean);
    }

    return scores;
  });

  for (const [key, label] of labels) {
    const row: Record<string, string | number> = { indicator: label };

    waves.forEach((wave, index) => {
      row[wave.id] = perWave[index]!.get(key) ?? "—";
    });

    sheet.addRow(row);
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function waveOf(wave: SurveyWave): Wave {
  return { questions: wave.questions, answers: wave.answers };
}

function headerStyle(sheet: ExcelJS.Worksheet) {
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF4FF" } };
  // Freezing the header is what makes a sheet of six thousand rows usable —
  // scrolling past row 40 otherwise loses every column name.
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

function noPairNote(sheet: ExcelJS.Worksheet, span: number, message?: string) {
  const row = sheet.addRow([
    message ??
      "Энэ судалгаанд харьцуулах эхний үнэлгээ алга. Хичээлийн жил болон үнэлгээний үеийг тохируулж, эхний судалгаанаас хувилж үүсгэнэ үү.",
  ]);
  sheet.mergeCells(row.number, 1, row.number, span);
  row.getCell(1).alignment = { wrapText: true, vertical: "middle" };
}

function signed(value: number | null): string {
  if (value === null) return "—";
  return value > 0 ? `+${value}` : String(value);
}

/** The answer as a person would read it, not as JSON. */
function readableAnswer(question: WaveQuestion, value: unknown, rowKey: string | null): string {
  if (value === null || value === undefined) return "—";

  if (question.type === "YES_NO") return value === true ? "Тийм" : value === false ? "Үгүй" : "—";
  if (question.type === "CHECKBOX") return Array.isArray(value) ? value.join(", ") : "—";

  if (question.type === "MATRIX") {
    if (rowKey === null || typeof value !== "object") return "—";

    const cell = (value as Record<string, unknown>)[rowKey];
    const column = matrixOptions(question)?.columns.find((c) => c.value === cell);

    return column?.label ?? (cell === undefined ? "—" : String(cell));
  }

  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** Whole years between a birth date and today. */
function ageOn(dateOfBirth: string): number | string {
  const born = new Date(`${dateOfBirth.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(born.getTime())) return "—";

  const now = new Date();
  let age = now.getUTCFullYear() - born.getUTCFullYear();

  const monthDiff = now.getUTCMonth() - born.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < born.getUTCDate())) age -= 1;

  return age;
}
