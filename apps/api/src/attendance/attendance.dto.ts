import { z } from "zod";

/**
 * ★ Six. `OTHER` was absent here until 2026-09-02 — see
 * `attendanceStatusSchema` in `@kinder/contracts` for what that cost.
 */
const attendanceStatusValues = [
  "PRESENT",
  "HALF_DAY",
  "EXCUSED",
  "SICK",
  "ABSENT",
  "OTHER",
] as const;
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

/**
 * The kindergarten-wide attendance register — a child per row, a day per
 * column, over any range of dates.
 *
 * ★ Not a month. Every attendance read in this module until now took
 * `YYYY-MM`, which answers "how did March go" and refuses "the first half of
 * March", "the week before the holiday", "the fortnight the claim covers".
 * A director reconciling a funding claim works in the period the claim covers,
 * and that period is not obliged to be a calendar month.
 *
 * ★★ `OTHER` is filterable even though `recordAttendanceSchema` above cannot
 * produce it. The column is an `AttendanceStatus` and the enum has six values;
 * a filter that silently could not name one of them would quietly hide rows.
 * That the recording schema is short of it is a separate defect, noted where
 * `ATTENDANCE_STATUS_LABEL` is declared.
 */
const registerStatusValues = [
  "PRESENT",
  "HALF_DAY",
  "EXCUSED",
  "SICK",
  "ABSENT",
  "OTHER",
] as const;

/**
 * Comma-separated in the URL, a typed array by the time a service sees it.
 *
 * ★ The return type is spelled out rather than inferred. Left to inference the
 * pipe widens to `string[]`, and the service then hands `string[]` to a
 * repository expecting `AgeBand[]` — which typechecks nowhere useful and would
 * have to be cast at the call site, once per filter, for ever.
 */
function commaSeparated<const T extends readonly [string, ...string[]]>(
  values: T,
  max: number,
): z.ZodType<T[number][] | undefined, string | undefined> {
  return z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean)
        : undefined,
    )
    .pipe(z.array(z.enum(values)).max(max).optional()) as z.ZodType<
    T[number][] | undefined,
    string | undefined
  >;
}

/**
 * ★ A hard ceiling on the range, and it is not arbitrary.
 *
 * The response is children × days: 300 children over a school year is 66,000
 * cells, which is a slow query, a large JSON payload and a table no browser
 * renders usefully. A quarter is the longest period anybody reconciles at
 * once, and asking for two quarters is two requests rather than one that times
 * out.
 */
const MAX_REGISTER_DAYS = 92;

function dayCount(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`);
  return Math.floor(ms / 86_400_000) + 1;
}

export const attendanceRegisterQuerySchema = z
  .object({
    from: isoDate,
    to: isoDate,

    /** Several at once — "the two senior groups" is one question, not two. */
    groupId: z
      .string()
      .optional()
      .transform((value) => (value ? value.split(",").map((p) => p.trim()).filter(Boolean) : undefined))
      .pipe(z.array(z.uuid()).max(50).optional()),

    ageBand: commaSeparated(["NURSERY", "JUNIOR", "MIDDLE", "SENIOR"], 4),
    programKind: z.enum(["MAIN", "ALTERNATIVE"]).optional(),
    attendanceForm: z.enum(["STANDARD", "EXTENDED", "SHORTENED"]).optional(),
    status: commaSeparated(registerStatusValues, 6),

    /** A name fragment, matched against "<эцгийн нэр> <нэр>" case-insensitively. */
    q: z.string().trim().max(100).optional(),
    childStatus: commaSeparated(["ACTIVE", "TEMPORARY", "ON_LEAVE", "INACTIVE"], 4),

    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict()
  .refine((q) => q.from <= q.to, {
    message: "Эхлэх огноо нь дуусах огнооноос хойш байж болохгүй",
    path: ["from"],
  })
  .refine((q) => dayCount(q.from, q.to) <= MAX_REGISTER_DAYS, {
    message: `Хугацаа хамгийн ихдээ ${MAX_REGISTER_DAYS} хоног байна`,
    path: ["to"],
  });

export type AttendanceRegisterQuery = z.infer<typeof attendanceRegisterQuerySchema>;

