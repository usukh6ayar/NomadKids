import { z } from "zod";

const attendanceStatusValues = ["PRESENT", "HALF_DAY", "EXCUSED", "SICK", "ABSENT"] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Огноо YYYY-MM-DD хэлбэртэй байна");
const isoMonth = z.string().regex(/^\d{4}-\d{2}$/, "Сар YYYY-MM хэлбэртэй байна");

/** The `:date` route param on `PUT /children/:id/attendance/:date`. */
export const dateParamSchema = z.object({ date: isoDate });
export type DateParam = z.infer<typeof dateParamSchema>;

export const recordAttendanceSchema = z
  .object({
    status: z.enum(attendanceStatusValues),
    note: z.string().max(2000).nullable().optional(),
  })
  .strict();
export type RecordAttendanceDto = z.infer<typeof recordAttendanceSchema>;

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
  })
  .strict();
export type CreateAttendanceRequestDto = z.infer<typeof createAttendanceRequestSchema>;

export const reviewAttendanceRequestSchema = z
  .object({
    decision: z.enum(["APPROVED", "REJECTED"]),
  })
  .strict();
export type ReviewAttendanceRequestDto = z.infer<typeof reviewAttendanceRequestSchema>;
