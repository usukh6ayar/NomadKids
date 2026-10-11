import { z } from "zod";
import { uuidSchema } from "./ids";

/**
 * Өдрийн дэглэм · Судлагдахуун · Дугуйлан — a group's daily routine, its plan
 * for the learning areas, and its clubs (client, 2026-10-09). The web app's
 * `lib/routine.ts` asked for this contract before the backend existed; this is
 * the backend's answer to it, field for field.
 *
 * Decisions the client made: one routine per group, the same every weekday;
 * clubs per group; a family asks to join, the group's teacher decides.
 *
 * ★ Learning areas travel by **name** — the `DevelopmentDomain` names every
 * kindergarten carries — and the server checks each against the table, not
 * against a list in code (CLAUDE.md §2.3).
 *
 * ★★ Every array is capped, so no request can grow the row without bound and
 * no response is unbounded (§3.4). The caps sit well above a real day.
 */

/** `HH:MM`, 00:00–23:59. */
export const clockTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const ROUTINE_ITEMS_MAX = 40;
export const ROUTINE_AREAS_MAX = 7;
export const CLUBS_PER_GROUP_MAX = 30;

const areasSchema = z.array(z.string().trim().min(1).max(60)).max(ROUTINE_AREAS_MAX);

const startBeforeEnd = (value: { start: string; end: string }) => value.start < value.end;
const START_BEFORE_END = { message: "Дуусах цаг эхлэх цагаас хойш байна.", path: ["end"] };

export const routineItemSchema = z
  .object({
    start: clockTimeSchema,
    end: clockTimeSchema,
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(160).nullish(),
    areas: areasSchema.default([]),
  })
  .refine(startBeforeEnd, START_BEFORE_END);
export type RoutineItem = z.infer<typeof routineItemSchema>;

export const areaPlanSchema = z.object({
  /** The standard name — the key routine rows and clubs refer to. */
  area: z.string().trim().min(1).max(60),
  /** The group's own name for it; `area` stays the key, so a rename breaks no link. */
  label: z.string().trim().max(60).nullish(),
  /** Хүүхдэд эзэмшүүлэх зорилго. */
  goal: z.string().max(600).default(""),
  /** Агуулга. */
  content: z.string().max(1200).default(""),
});
export type AreaPlan = z.infer<typeof areaPlanSchema>;

export const routineItemsInputSchema = z.object({
  items: z.array(routineItemSchema).max(ROUTINE_ITEMS_MAX),
});
export type RoutineItemsInput = z.infer<typeof routineItemsInputSchema>;

export const routinePlanInputSchema = z.object({
  plan: z.array(areaPlanSchema).max(ROUTINE_AREAS_MAX),
});
export type RoutinePlanInput = z.infer<typeof routinePlanInputSchema>;

/** Monday 1 … Friday 5. */
export const weekdaySchema = z.number().int().min(1).max(5);

export const clubInputSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    teacherName: z.string().trim().min(1).max(60),
    room: z.string().trim().max(50).nullish(),
    days: z.array(weekdaySchema).min(1).max(5),
    start: clockTimeSchema,
    end: clockTimeSchema,
    areas: areasSchema.min(1),
    goal: z.string().trim().max(450).nullish(),
  })
  .refine(startBeforeEnd, START_BEFORE_END);
export type ClubInput = z.infer<typeof clubInputSchema>;

export const clubSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  teacherName: z.string(),
  room: z.string().nullable(),
  days: z.array(z.number().int()),
  start: z.string(),
  end: z.string(),
  areas: z.array(z.string()),
  goal: z.string().nullable(),
});
export type Club = z.infer<typeof clubSchema>;

export const CLUB_REQUEST_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export const clubRequestStatusSchema = z.enum(CLUB_REQUEST_STATUSES);
export type ClubRequestStatus = z.infer<typeof clubRequestStatusSchema>;

export const clubRequestSchema = z.object({
  id: uuidSchema,
  clubId: uuidSchema,
  childId: uuidSchema,
  childName: z.string(),
  status: clubRequestStatusSchema,
  createdAt: z.string(),
});
export type ClubRequest = z.infer<typeof clubRequestSchema>;

export const newClubRequestSchema = z.object({ clubId: uuidSchema });
export type NewClubRequest = z.infer<typeof newClubRequestSchema>;

/**
 * One group's routine. A group that has never saved one answers with empty
 * arrays and `updatedAt: null` — the screen offers the curriculum template.
 *
 * `requests`: on the group route, the pending and approved requests of
 * children currently in the group; on a child's route, that child's own,
 * including rejected ones so the family sees the answer.
 */
export const routineSchema = z.object({
  group: z.object({ id: uuidSchema, name: z.string() }),
  items: z.array(routineItemSchema),
  plan: z.array(areaPlanSchema),
  clubs: z.array(clubSchema),
  requests: z.array(clubRequestSchema),
  updatedAt: z.string().nullable(),
});
export type Routine = z.infer<typeof routineSchema>;
