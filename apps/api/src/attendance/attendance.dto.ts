import { z } from "zod";

const attendanceStatusValues = ["PRESENT", "HALF_DAY", "EXCUSED", "SICK", "ABSENT"] as const;
const attendanceCompanionValues = ["MOTHER", "FATHER", "OTHER"] as const;
/** Who, when the companion is OTHER — a category alone cannot carry a name. */
const companionNameSchema = z.string().trim().min(1).max(100).nullable().optional();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Огноо YYYY-MM-DD хэлбэртэй байна");
/**
 * `YYYY-MM`, where MM is a month that exists.
 *
 * ★ `\d{2}` was not enough. It accepted `2026-13`, and `monthRange` turns that
 * into `Date.UTC(2026, 12, 1)` — January 2027 — so the endpoint answered 200
 * with a different month's register and nothing said so. A typed URL or an
 * off-by-one in a caller's month arithmetic both land here.
 */
const isoMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Сар YYYY-MM хэлбэртэй байна");

/** The `:date` route param on `PUT /children/:id/attendance/:date`. */
export const dateParamSchema = z.object({ date: isoDate });
export type DateParam = z.infer<typeof dateParamSchema>;

export const recordAttendanceSchema = z
  .object({
    status: z.enum(attendanceStatusValues),
    note: z.string().max(2000).nullable().optional(),
    /**
     * Drop-off — set together with `status` at check-in time, both optional
     * so the plain status-only calls the group day-sheet and the non-PRESENT
     * buttons in `TodayRecorder` already send keep working unchanged.
     * `arrivedAt` defaults to "now" in the service when `arrivedWith` is
     * sent without it, rather than here — "now" means server time at the
     * moment of the request, not whatever a client happened to pass.
     */
    arrivedWith: z.enum(attendanceCompanionValues).nullable().optional(),
    arrivedWithName: companionNameSchema,
    arrivedAt: z.coerce.date().nullable().optional(),
  })
  .strict();
export type RecordAttendanceDto = z.infer<typeof recordAttendanceSchema>;

/** `PATCH /children/:id/attendance/:date/pickup` — independent of `record()`,
 * so recording who picked the child up never requires re-sending `status`. */
export const recordPickupSchema = z
  .object({
    pickedUpWith: z.enum(attendanceCompanionValues),
    pickedUpWithName: companionNameSchema,
    pickedUpAt: z.coerce.date().nullable().optional(),
  })
  .strict();
export type RecordPickupDto = z.infer<typeof recordPickupSchema>;

export const listAttendanceQuerySchema = z.object({ month: isoMonth });
export type ListAttendanceQuery = z.infer<typeof listAttendanceQuerySchema>;

export const groupDaySheetQuerySchema = z.object({ date: isoDate });
export type GroupDaySheetQuery = z.infer<typeof groupDaySheetQuerySchema>;

export const createAttendanceRequestSchema = z
  .object({
    dateFrom: isoDate,
    dateTo: isoDate,
    requestedStatus: z.enum(attendanceStatusValues),
    reason: z.string().max(2000).nullable().optional(),
    /**
     * A guardian's own arrival claim — "Ирц мэдэгдэх", set only alongside
     * `requestedStatus: "PRESENT"` and only meaningful for a single-day
     * request (`dateFrom === dateTo`); nothing rejects a multi-day PRESENT
     * request, but a companion/time pair naming one specific morning is not
     * a fact about a date range. `reviewRequest` copies both onto the
     * `Attendance` row it writes on approval — see the `Enrollment`-adjacent
     * migration `attendance_companion_and_arrival_requests`.
     */
    arrivedWith: z.enum(attendanceCompanionValues).nullable().optional(),
    arrivedWithName: companionNameSchema,
    arrivedAt: z.coerce.date().nullable().optional(),
    /**
     * The same guardian's second request the same day — "Гарсныг мэдэгдэх"
     * at pickup. Its own request row (migration `attendance_request_pickup`),
     * not fields on the arrival request: a guardian does not know who is
     * collecting the child when they drop them off, so the two claims are
     * always submitted hours apart.
     */
    pickedUpWith: z.enum(attendanceCompanionValues).nullable().optional(),
    pickedUpWithName: companionNameSchema,
    pickedUpAt: z.coerce.date().nullable().optional(),
  })
  .strict();
export type CreateAttendanceRequestDto = z.infer<typeof createAttendanceRequestSchema>;

export const reviewAttendanceRequestSchema = z
  .object({
    decision: z.enum(["APPROVED", "REJECTED"]),
  })
  .strict();
export type ReviewAttendanceRequestDto = z.infer<typeof reviewAttendanceRequestSchema>;
