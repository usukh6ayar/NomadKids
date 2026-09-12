import { z } from "zod";
import { surveyCategorySchema, surveyKindSchema, uuidSchema } from "@kinder/contracts";

/** "2025-2026" — a school year spans two calendar years, so it is a string. */
const schoolYearSchema = z
  .string()
  .regex(/^\d{4}-\d{4}$/, "Хичээлийн жил 2025-2026 хэлбэртэй байна")
  .refine((value) => {
    const [from, to] = value.split("-").map(Number) as [number, number];
    return to === from + 1;
  }, "Хичээлийн жил дараалсан хоёр он байна");

export const surveyPeriodSchema = z.enum(["BASELINE", "MIDLINE", "ENDLINE"]);

export const createSurveySchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(2000).nullable().optional(),
    // Older API clients keep creating the general parent-engagement category;
    // the current UI always sends the teacher's explicit selection.
    category: surveyCategorySchema.default("PARENT_ENGAGEMENT"),
    scope: z.enum(["CHILD", "KINDERGARTEN"]),
    /*
      Defaulted rather than required so every existing caller — the clone
      endpoint, the seeds, `surveys.test.ts` — keeps compiling and keeps meaning
      what it meant. A survey created without saying is a form, which is what
      all of them were before the column existed.
    */
    kind: surveyKindSchema.optional(),
    /*
      The optional deadline. `coerce` because it arrives as an ISO string from
      the composer's `<input type="date">`, and nullable because "no closing
      date" is a choice the client asked to keep — not an omission.
    */
    closesAt: z.coerce.date().nullable().optional(),
    // RFP Module 1.1's archival classification, and what Module 1.2 pairs on.
    // Optional: a one-off poll belongs to no wave, and forcing a period on it
    // would put it in a comparison it has no business in.
    schoolYear: schoolYearSchema.nullable().optional(),
    period: surveyPeriodSchema.nullable().optional(),
    /*
      ★ Which group the survey is for — 2026-09-06, the client's "бүх бүлэг /
      бүлэг сонгох".

      Null (and omitted) is every group, which is the same convention the
      notification module uses for an empty target list and is stated on
      `Survey.groupId` in the schema: an audience named as "everyone" keeps
      reaching families who enrol later, where naming a group freezes it.

      Optional so every existing caller — the clone endpoint, the seeds,
      `surveys.test.ts` — keeps compiling and keeps meaning what it meant.
    */
    groupId: uuidSchema.nullable().optional(),
    /*
      ★ The wizard's remaining fields — 2026-09-10, all optional.

      Every one of them is a *setting*, and every setting's omitted value is
      the behaviour every survey written before them had: no opening date, no
      stated purpose, no term, named answers, one response each, questions in
      the order they were written, and the product's own thank-you. So the
      clone endpoint, the seeds and every existing test keep compiling and keep
      meaning what they meant — the same argument `kind` and `groupId` make
      above, and the reason none of these is required.
    */
    opensAt: z.coerce.date().nullable().optional(),
    purpose: z.string().max(2000).nullable().optional(),
    termId: uuidSchema.nullable().optional(),
    isAnonymous: z.boolean().optional(),
    allowMultipleResponses: z.boolean().optional(),
    shuffleQuestions: z.boolean().optional(),
    closingNote: z.string().max(500).nullable().optional(),
  })
  .strict()
  /*
    ★ A window that closes before it opens is refused here, not discovered by a
    family who cannot answer.

    Checked in the schema rather than the service because it is a property of
    the two values alone — no row, no actor, nothing to look up. `notifications
    .dto.ts` states the same rule for `startsOn`/`endsOn`.
  */
  .refine((dto) => !dto.opensAt || !dto.closesAt || dto.opensAt <= dto.closesAt, {
    message: "Эхлэх огноо дуусах огнооноос хойш байж болохгүй",
    path: ["closesAt"],
  });
export type CreateSurveyDto = z.infer<typeof createSurveySchema>;

/**
 * A matrix's shape — RFP Module 1.1's "олон үзүүлэлтийн хүснэгт".
 *
 * ★ Rows carry a stable `key` alongside their label.
 *
 * The key is what an answer is stored against and what the year-on-year
 * comparison pairs on. If rows were identified by their label, correcting a
 * typo in "Хэл ярианы хөгжил" would orphan every answer already given and break
 * the pairing against last year — so the label is free to change and the key
 * never does.
 */
const matrixOptionsSchema = z.object({
  rows: z
    .array(
      z.object({
        key: z
          .string()
          .min(1)
          .max(60)
          .regex(/^[a-zA-Z0-9_-]+$/, "Мөрийн түлхүүр латин үсэг, тоо, зураасаас бүрдэнэ"),
        label: z.string().min(1).max(200),
      }),
    )
    .min(1)
    .max(20),
  columns: z
    .array(z.object({ value: z.number().int().min(0).max(100), label: z.string().min(1).max(60) }))
    .min(2)
    .max(10),
});

const questionInputSchema = z
  .object({
    order: z.number().int().min(0),
    type: z.enum(["RATING", "YES_NO", "TEXT", "SINGLE_CHOICE", "CHECKBOX", "MATRIX"]),
    prompt: z.string().min(1).max(500),
    /** A string array for SINGLE_CHOICE and CHECKBOX; `{ rows, columns }` for MATRIX. */
    options: z
      .union([z.array(z.string().min(1).max(120)).max(20), matrixOptionsSchema])
      .nullable()
      .optional(),
    /**
     * What this question measures, stable across waves — RFP Module 1.2.
     *
     * Sent by the client and preserved through edits, because editing a DRAFT's
     * questions deletes and recreates every row. Null means "not comparable",
     * which is the honest answer for a one-off poll question.
     */
    indicatorKey: z
      .string()
      .min(1)
      .max(60)
      .regex(/^[a-zA-Z0-9_-]+$/, "Үзүүлэлтийн түлхүүр латин үсэг, тоо, зураасаас бүрдэнэ")
      .nullable()
      .optional(),
  })
  /*
    Both option-bearing types need at least one choice. `SINGLE_CHOICE` joined
    the check rather than getting its own: a question offering nothing to pick
    is unanswerable whether it takes one answer or several, and two refinements
    with the same body is how one of them stops being updated.
  */
  .refine(
    (q) =>
      !(q.type === "CHECKBOX" || q.type === "SINGLE_CHOICE") ||
      (Array.isArray(q.options) && q.options.length > 0),
    {
      message: "Сонголттой асуулт хамгийн багадаа нэг сонголттой байна",
      path: ["options"],
    },
  )
  .refine((q) => q.type !== "MATRIX" || (q.options !== null && !Array.isArray(q.options)), {
    message: "Матриц асуулт мөр болон баганатай байна",
    path: ["options"],
  })
  .refine(
    (q) => {
      if (q.type !== "MATRIX" || Array.isArray(q.options) || !q.options) return true;
      // Duplicate row keys would silently merge two indicators into one bucket
      // in the comparison, which reads as a plausible average of the wrong two
      // things rather than as an error.
      const keys = q.options.rows.map((row) => row.key);
      return new Set(keys).size === keys.length;
    },
    { message: "Матрицын мөрийн түлхүүр давхардсан байна", path: ["options"] },
  );

export const saveQuestionsSchema = z
  .object({
    questions: z.array(questionInputSchema).min(1).max(30),
  })
  .strict()
  .refine(
    (body) => {
      const keys = body.questions
        .map((q) => q.indicatorKey)
        .filter((key): key is string => typeof key === "string");
      return new Set(keys).size === keys.length;
    },
    { message: "Үзүүлэлтийн түлхүүр давхардсан байна", path: ["questions"] },
  );
export type SaveQuestionsDto = z.infer<typeof saveQuestionsSchema>;

/**
 * MATRIX answers are `{ [rowKey]: number }`; the rest are unchanged.
 *
 * `z.record` rather than a fixed shape because the row keys are whatever the
 * question defines. The service checks each key against the question's own rows
 * before storing, so an answer naming a row that does not exist is refused
 * rather than saved as data nothing can score.
 */
const answerValueSchema = z.union([
  z.number(),
  z.boolean(),
  z.string(),
  z.array(z.string()),
  z.record(z.string(), z.number()),
]);

export const submitResponseSchema = z
  .object({
    childId: uuidSchema.nullable().optional(),
    answers: z
      .array(z.object({ questionId: uuidSchema, value: answerValueSchema }))
      .min(1)
      .max(30),
  })
  .strict();
export type SubmitResponseDto = z.infer<typeof submitResponseSchema>;

/**
 * Cloning a survey into the next wave — RFP Module 1.2.
 *
 * ★ The clone is how "ижил асуулга" comes to exist at all. Retyping thirty
 * questions in May would produce a survey that merely looks like September's,
 * with no shared indicator keys and therefore nothing to compare.
 */
export const cloneSurveySchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    schoolYear: schoolYearSchema.nullable().optional(),
    period: surveyPeriodSchema.nullable().optional(),
  })
  .strict();
export type CloneSurveyDto = z.infer<typeof cloneSurveySchema>;

/** Which wave to compare this one against — Module 1.2. */
export const compareSurveyQuerySchema = z.object({
  /** Defaults to the survey's own baseline, found by school year and period. */
  baselineId: uuidSchema.optional(),
});
export type CompareSurveyQuery = z.infer<typeof compareSurveyQuerySchema>;

/**
 * The results screen's own filter — one group's answers.
 *
 * ★ It narrows the headline and never the breakdown.
 *
 * See `SurveysService.results`: the per-group comparison is the point of the
 * screen, and a comparison filtered to one group is a chart with one bar.
 */
export const surveyResultsQuerySchema = z.object({ groupId: uuidSchema.optional() }).strict();
export type SurveyResultsQuery = z.infer<typeof surveyResultsQuerySchema>;

/**
 * One choice a family adds to a poll question.
 *
 * ★ Bounded at the same 80 characters the composer's own option inputs use.
 *
 * This is the one field on a teacher's object that a parent writes, so the
 * limit is the whole validation story: no markup is stripped and none needs to
 * be, because the value is rendered as text and never as HTML — but a 10 kB
 * "option" would break the bars for everyone reading the poll.
 */
export const addPollOptionSchema = z.object({ label: z.string().min(1).max(80) }).strict();
export type AddPollOptionDto = z.infer<typeof addPollOptionSchema>;

/**
 * `/:id/questions/:questionId/answers` — both halves of the path.
 *
 * A schema of its own rather than `idParamSchema` twice: a controller that
 * validated only `id` would hand an unchecked string to a `where` clause, and
 * the service's own 404 for a question that belongs to another survey is a
 * different check from "is this a uuid at all".
 */
export const questionAnswersParamsSchema = z.object({
  id: uuidSchema,
  questionId: uuidSchema,
});
