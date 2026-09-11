import { z } from "zod";
import { paginationQuerySchema, uuidSchema } from "@kinder/contracts";
import { searchTermSchema } from "../common/repository/search";

const text = (max: number) => z.string().max(max).nullable().optional();

/** The narrative fields. Long, because teachers write paragraphs here. */
const textFields = {
  activityName: text(200),
  situation: text(4000),
  childDid: text(4000),
  childSaid: text(4000),
  teacherComment: text(4000),
  nextSteps: text(4000),
};

export const createObservationSchema = z
  .object({
    typeId: uuidSchema,
    observedOn: z.coerce.date().refine((d) => d <= new Date(), {
      message: "Ажиглалтын огноо ирээдүйд байж болохгүй",
    }),
    ...textFields,
    domainIds: z.array(uuidSchema).max(10).optional(),
    /*
      ★ The curriculum indicator and the level judged against it — СҮД, added
      2026-09-11.

      Optional, because a note is not always an assessment: what happened at
      the water table is worth keeping whether or not it maps onto an
      indicator, and requiring one would make the quick note the slowest thing
      on the screen.

      The level is 1–4 and is checked against the *indicator's own* levels in
      the service, not here — several indicators begin at II or III because the
      behaviour does not exist earlier, so "1 to 4" is the wrong rule and only
      the row knows the right one.
    */
    indicatorId: uuidSchema.optional(),
    indicatorLevel: z.number().int().min(1).max(4).optional(),
    /**
     * Optional: the default depends on who is filing. A teacher's note is
     * private unless they say otherwise; a parent's own note is visible to them.
     * Resolved in the service, which knows the source.
     */
    visibleToParents: z.boolean().optional(),
    includeInReport: z.boolean().optional(),
  })
  .strict();
export type CreateObservationDto = z.infer<typeof createObservationSchema>;

/**
 * A parent's submission.
 *
 * Deliberately smaller than the teacher form — a family shares what happened at
 * home, not a professional assessment. `visibleToParents`, `includeInReport`
 * and `domainIds` are absent because RFP §5.4 makes those the teacher's
 * decisions; a schema that accepted them would need the service to strip them.
 */
export const createParentObservationSchema = z
  .object({
    /** The parent screen's three real, persisted buckets. */
    categoryCode: z.enum(["daily", "conversation", "artwork"]).optional(),
    observedOn: z.coerce.date().refine((d) => d <= new Date(), {
      message: "Ажиглалтын огноо ирээдүйд байж болохгүй",
    }),
    situation: text(4000),
    childDid: text(4000),
    childSaid: text(4000),
  })
  .strict();
export type CreateParentObservationDto = z.infer<typeof createParentObservationSchema>;

export const updateObservationSchema = z
  .object({
    typeId: uuidSchema.optional(),
    observedOn: z.coerce.date().optional(),
    ...textFields,
    domainIds: z.array(uuidSchema).max(10).optional(),
    /*
      ★ The curriculum indicator and the level judged against it — СҮД, added
      2026-09-11.

      Optional, because a note is not always an assessment: what happened at
      the water table is worth keeping whether or not it maps onto an
      indicator, and requiring one would make the quick note the slowest thing
      on the screen.

      The level is 1–4 and is checked against the *indicator's own* levels in
      the service, not here — several indicators begin at II or III because the
      behaviour does not exist earlier, so "1 to 4" is the wrong rule and only
      the row knows the right one.
    */
    indicatorId: uuidSchema.optional(),
    indicatorLevel: z.number().int().min(1).max(4).optional(),
    visibleToParents: z.boolean().optional(),
    includeInReport: z.boolean().optional(),
  })
  .strict();
export type UpdateObservationDto = z.infer<typeof updateObservationSchema>;

export const listObservationsQuerySchema = paginationQuerySchema.extend({
  typeId: uuidSchema.optional(),
  domainId: uuidSchema.optional(),
  source: z.enum(["TEACHER", "PARENT"]).optional(),
  reviewStatus: z.enum(["PENDING", "APPROVED", "RETURNED"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /*
   * ★ Added 2026-09-05 — А/261 шалгуур 21. This list had five filters and no
   * free-text search, so a teacher looking for "the one about the puzzle" had
   * to page through a term's worth of entries.
   */
  q: searchTermSchema,
});
export type ListObservationsQuery = z.infer<typeof listObservationsQuerySchema>;

/**
 * A teacher's review decision.
 *
 * Approving may also publish the note to the family in one step, which is what
 * the review screen actually does — otherwise every approval needs a second
 * request the teacher will forget.
 */
export const reviewObservationSchema = z
  .object({
    decision: z.enum(["APPROVED", "RETURNED"]),
    reviewNote: z.string().max(2000).nullable().optional(),
    visibleToParents: z.boolean().optional(),
    domainIds: z.array(uuidSchema).max(10).optional(),
    /*
      ★ The curriculum indicator and the level judged against it — СҮД, added
      2026-09-11.

      Optional, because a note is not always an assessment: what happened at
      the water table is worth keeping whether or not it maps onto an
      indicator, and requiring one would make the quick note the slowest thing
      on the screen.

      The level is 1–4 and is checked against the *indicator's own* levels in
      the service, not here — several indicators begin at II or III because the
      behaviour does not exist earlier, so "1 to 4" is the wrong rule and only
      the row knows the right one.
    */
    indicatorId: uuidSchema.optional(),
    indicatorLevel: z.number().int().min(1).max(4).optional(),
  })
  .strict();
export type ReviewObservationDto = z.infer<typeof reviewObservationSchema>;

/**
 * The window a group's coverage dashboard reports on.
 *
 * ★ Two dates rather than a month, and the screen sends both.
 *
 * The client's drawing asks two questions at once: "how many children did I
 * write about *this month*" and "how has that gone *across the year*". One
 * `?month=` parameter answers the first and forces a second endpoint for the
 * second. A range answers both — the caller asks for the school year, and the
 * monthly buckets inside it are what the chart draws.
 *
 * Bounded at 400 days: the widest legitimate ask is one school year, and the
 * ceiling stops a caller turning `date_trunc` loose over the whole table.
 */
export const groupStatsQuerySchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
  })
  .strict()
  .refine((q) => q.to >= q.from, {
    message: "Дуусах огноо эхлэх огнооноос хойш байна",
    path: ["to"],
  })
  .refine((q) => q.to.getTime() - q.from.getTime() <= 400 * 24 * 60 * 60 * 1000, {
    message: "Хугацааны хязгаар 400 хоног",
    path: ["to"],
  });
export type GroupStatsQuery = z.infer<typeof groupStatsQuerySchema>;
