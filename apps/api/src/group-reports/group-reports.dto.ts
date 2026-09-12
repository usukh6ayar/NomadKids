import { z } from "zod";

/**
 * The report's window.
 *
 * ★ Both ends required, and a year is the ceiling.
 *
 * The screen offers a month, a term and a school year; nothing legitimate asks
 * for more, and an open-ended range over aggregates is still a table scan of
 * every attendance row a kindergarten has (§3.4).
 */
export const groupReportQuerySchema = z
  .object({ from: z.coerce.date(), to: z.coerce.date() })
  .refine((value) => value.from <= value.to, { message: "Эхлэх огноо нь дуусахаас хойш байна" })
  .refine((value) => value.to.getTime() - value.from.getTime() <= 400 * 24 * 60 * 60 * 1000, {
    message: "Хугацаа хэт урт байна",
  });
export type GroupReportQuery = z.infer<typeof groupReportQuerySchema>;
