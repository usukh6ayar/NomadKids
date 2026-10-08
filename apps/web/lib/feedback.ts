import { z } from "zod";
import { paginated } from "@kinder/contracts";

/**
 * Санал хүсэлт — a guardian's note to the kindergarten's administration, and
 * the administration's answer. The contract the backend is asked for (client,
 * 2026-10-08: "эцэг эх нэрээ нуугаад илгээж болно … нэрээ мэдэгдсэн асуудал
 * байвал албан хариу өгдөг"). Kept in the web app until it lands in
 * `@kinder/contracts`, as `lib/qualifications.ts` is.
 *
 *   GET  /me/feedback?page=&pageSize=                                   (PARENT)
 *   POST /me/feedback  ← newFeedbackSchema                              (PARENT)
 *   GET  /kindergartens/:id/feedback?status=&category=&groupId=&page=&pageSize=  (ADMIN)
 *   POST /kindergartens/:id/feedback/:feedbackId/acknowledge            (ADMIN)
 *   POST /kindergartens/:id/feedback/:feedbackId/reply ← feedbackReplySchema (ADMIN)
 *   DELETE /me/feedback/:feedbackId                                     (PARENT)
 *   DELETE /kindergartens/:id/feedback/:feedbackId                      (ADMIN)
 *
 * ★★★ A DELETE takes a note out of *that side's* list only — 2026-10-08, the
 * client: "хэрэггүй болсноо устгаж болох", like mail. The administration
 * clearing its inbox must not take an answer away from the guardian who got
 * it, and a guardian tidying their list must not unsay what they told the
 * kindergarten. So the server keeps two soft-delete marks, one per side, and
 * the row itself is never removed (CLAUDE.md §3.2).
 *
 * ★ Anonymous means anonymous to the administration, not to the system. The
 * server keeps who sent it — so the guardian can follow it and nobody can flood
 * the box — but `author` is `null` in every ADMIN response for an anonymous
 * note, and `reply` is refused for one: there is nobody to address it to.
 *
 * ★★ `childId` on the POST is how the server finds the kindergarten — through
 * the guardian's own enrollment check, never a kindergarten id the client
 * names. It is not shown to the administration on an anonymous note.
 */

export const FEEDBACK_CATEGORIES = [
  "FOOD",
  "TEACHING",
  "HYGIENE",
  "SAFETY",
  "FACILITY",
  "PAYMENT",
  "OTHER",
] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_CATEGORY_LABEL: Record<FeedbackCategory, string> = {
  FOOD: "Хоол, гал тогоо",
  TEACHING: "Багш, сургалт",
  HYGIENE: "Ариун цэвэр",
  SAFETY: "Аюулгүй байдал",
  FACILITY: "Барилга, орчин",
  PAYMENT: "Төлбөр",
  OTHER: "Бусад",
};

/**
 * Who the sender is to the child — 2026-10-08, the client: "эцэг эх аав ээж
 * гэдгээ сонгодог болго". Chosen on the form rather than read from the
 * guardian link, which does not always say.
 */
export const FEEDBACK_RELATIONS = ["MOTHER", "FATHER", "GUARDIAN"] as const;
export type FeedbackRelation = (typeof FEEDBACK_RELATIONS)[number];

export const FEEDBACK_RELATION_LABEL: Record<FeedbackRelation, string> = {
  MOTHER: "ээж",
  FATHER: "аав",
  GUARDIAN: "асран хамгаалагч",
};

export const FEEDBACK_STATUS = ["NEW", "ACKNOWLEDGED", "ANSWERED"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUS)[number];

/** One wording for both sides — the client, 2026-10-08: Шинэ · Хүлээн авсан · Хариулсан. */
export const FEEDBACK_STATUS_LABEL: Record<FeedbackStatus, string> = {
  NEW: "Шинэ",
  ACKNOWLEDGED: "Хүлээн авсан",
  ANSWERED: "Хариулсан",
};

export const feedbackSchema = z.object({
  id: z.string(),
  category: z.enum(FEEDBACK_CATEGORIES),
  body: z.string(),
  anonymous: z.boolean(),
  /** `null` whenever `anonymous` — the server never sends it to an admin. */
  author: z
    .object({
      firstName: z.string().nullish(),
      lastName: z.string().nullish(),
      phone: z.string().nullish(),
    })
    .nullish(),
  /**
   * Who the guardian is to whom — the client, 2026-10-08: "ямар бүлгийн хэн
   * багшийн хэний эцэг эх". All four are `null` on an anonymous note, for the
   * same reason `author` is: a group and a child's name narrow a sender to a
   * family as surely as their own name does.
   */
  childName: z.string().nullish(),
  /** «ээж», «аав», «асран хамгаалагч». */
  relation: z.string().nullish(),
  groupName: z.string().nullish(),
  /** What the administration's group filter sends back as `groupId`. */
  groupId: z.string().nullish(),
  teacherName: z.string().nullish(),
  status: z.enum(FEEDBACK_STATUS),
  createdAt: z.string(),
  acknowledgedAt: z.string().nullish(),
  reply: z
    .object({
      body: z.string(),
      repliedAt: z.string(),
      /** «Цэцэрлэгийн захиргаа» unless the server names an office. */
      signature: z.string().nullish(),
    })
    .nullish(),
});
export type Feedback = z.infer<typeof feedbackSchema>;

export const feedbackListSchema = paginated(feedbackSchema);

/** What a guardian sends. */
export const newFeedbackSchema = z.object({
  childId: z.string(),
  category: z.enum(FEEDBACK_CATEGORIES),
  body: z.string().min(1).max(3000),
  anonymous: z.boolean(),
  /** Required on a named note; `null` on an anonymous one, which names nobody. */
  relation: z.enum(FEEDBACK_RELATIONS).nullable(),
});
export type NewFeedback = z.infer<typeof newFeedbackSchema>;

/** What the administration answers a named note with. */
export const feedbackReplySchema = z.object({
  body: z.string().min(1).max(3000),
});

export const FEEDBACK_SIGNATURE = "Цэцэрлэгийн захиргаа";

export const FEEDBACK_NOT_READY = "Санал хүсэлтийн сервер холболт хараахан бэлэн болоогүй байна.";

/** The status and category filters, applied where the server does not. */
export function filterFeedback<T extends Pick<Feedback, "status" | "category">>(
  rows: T[],
  status: FeedbackStatus | "",
  category: FeedbackCategory | "",
): T[] {
  return rows.filter(
    (row) => (!status || row.status === status) && (!category || row.category === category),
  );
}
