import { z } from "zod";
import { paginated } from "@kinder/contracts";

/**
 * Мэргэшлийн зэргийн хүсэлт — the contract the backend is asked for
 * (client, 2026-10-07: "эхлээд фронт хий тэгээд бакдаа хэлнэ"). Kept in the
 * web app until it lands in `@kinder/contracts`; the admin's list and the
 * teacher's own page both read it.
 *
 *   GET  /kindergartens/:id/qualification-requests?schoolYearId=&page=&pageSize=   (ADMIN)
 *   GET  /me/qualification-requests?page=&pageSize=                                (TEACHER)
 *   POST /me/qualification-requests  ← newQualificationRequestSchema                (TEACHER)
 */

export const QUALIFICATION_STATUS = ["NEW", "IN_REVIEW", "APPROVED", "REJECTED"] as const;
export type QualificationStatus = (typeof QUALIFICATION_STATUS)[number];

export const QUALIFICATION_STATUS_LABEL: Record<QualificationStatus, string> = {
  NEW: "Шинэ",
  IN_REVIEW: "Хянаж буй",
  APPROVED: "Шийдвэрлэсэн",
  REJECTED: "Татгалзсан",
};

/** The three ranks a teacher applies for, lowest first. */
export const QUALIFICATION_DEGREES = ["Заах аргач", "Тэргүүлэх", "Зөвлөх"] as const;

export const qualificationRequestSchema = z.object({
  id: z.string(),
  /** ESIS's own request number (API 119), once ESIS has issued one. */
  requestId: z.string().nullish(),
  person: z.object({ firstName: z.string().nullish(), lastName: z.string().nullish() }),
  /** «Бүлгийн багш». */
  position: z.string().nullish(),
  /** «Заах аргач». */
  degree: z.string().nullish(),
  status: z.enum(QUALIFICATION_STATUS),
  submittedAt: z.string(),
  decidedAt: z.string().nullish(),
  /** The signed-in user's own request — «Миний хүсэлт». */
  isMine: z.boolean().default(false),
});
export type QualificationRequest = z.infer<typeof qualificationRequestSchema>;

export const qualificationRequestsSchema = paginated(qualificationRequestSchema);

/** What a teacher sends with «Шинэ хүсэлт». */
export const newQualificationRequestSchema = z.object({
  degree: z.enum(QUALIFICATION_DEGREES),
  position: z.string().min(1).max(120),
  /** Years in the profession, whole years. */
  yearsOfService: z.number().int().min(0).max(60),
  note: z.string().max(2000).nullable(),
});
export type NewQualificationRequest = z.infer<typeof newQualificationRequestSchema>;

export function isDecided(status: QualificationStatus): boolean {
  return status === "APPROVED" || status === "REJECTED";
}
