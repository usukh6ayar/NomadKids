import { z } from "zod";
import { uuidSchema } from "./ids";
import { paginated, paginationQuerySchema } from "./pagination";

/**
 * Санал хүсэлт — a family's suggestion or complaint to the kindergarten's
 * administration, and the administration's formal reply.
 *
 * ★ Categories and states are system enums for now. If a kindergarten ever
 * needs to edit its own categories they become a table (CLAUDE.md §2.3).
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

/** Forward only: NEW → ACKNOWLEDGED → ANSWERED. */
export const FEEDBACK_STATUS = ["NEW", "ACKNOWLEDGED", "ANSWERED"] as const;

/** Who is writing, as the family states it. Sent as a code, returned as text. */
export const FEEDBACK_RELATIONS = ["MOTHER", "FATHER", "GUARDIAN"] as const;

export const feedbackCategorySchema = z.enum(FEEDBACK_CATEGORIES);
export const feedbackStatusSchema = z.enum(FEEDBACK_STATUS);
export const feedbackRelationSchema = z.enum(FEEDBACK_RELATIONS);

export const FEEDBACK_BODY_MAX = 3000;

/**
 * One feedback item as either side reads it.
 *
 * ★ For an **anonymous** item the administration's copy carries `author`,
 * `childName`, `relation`, `groupId`, `groupName` and `teacherName` as null.
 * A group and a child's name point at a family as surely as a name does. The
 * family's own copy is never redacted: they wrote it.
 *
 * `relation` and `teacherName` are display text («ээж», «Д.Сувдаа»), not codes.
 * `reply.signature` null means the frontend signs it «Цэцэрлэгийн захиргаа».
 */
export const feedbackSchema = z.object({
  id: uuidSchema,
  category: feedbackCategorySchema,
  body: z.string(),
  anonymous: z.boolean(),
  author: z
    .object({
      firstName: z.string(),
      lastName: z.string(),
      phone: z.string().nullable(),
    })
    .nullable(),
  childName: z.string().nullable(),
  relation: z.string().nullable(),
  groupId: uuidSchema.nullable(),
  groupName: z.string().nullable(),
  teacherName: z.string().nullable(),
  status: feedbackStatusSchema,
  createdAt: z.string(),
  acknowledgedAt: z.string().nullable(),
  reply: z
    .object({
      body: z.string(),
      repliedAt: z.string(),
      signature: z.string().nullable(),
    })
    .nullable(),
});

export const feedbackListSchema = paginated(feedbackSchema);

/**
 * What a family sends. The kindergarten and the group are never part of it —
 * the server reads both from the child's enrollment (CLAUDE.md §1.2).
 */
export const newFeedbackSchema = z.object({
  childId: uuidSchema,
  category: feedbackCategorySchema,
  body: z.string().trim().min(1).max(FEEDBACK_BODY_MAX),
  anonymous: z.boolean().default(false),
  // Ignored, and stored as null, when `anonymous` is true.
  relation: feedbackRelationSchema.nullish(),
});

/** The administration's formal reply. */
export const feedbackReplySchema = z.object({
  body: z.string().trim().min(1).max(FEEDBACK_BODY_MAX),
});

/** The administration's inbox. Every filter is optional. */
export const feedbackInboxQuerySchema = paginationQuerySchema.extend({
  status: feedbackStatusSchema.optional(),
  category: feedbackCategorySchema.optional(),
  groupId: uuidSchema.optional(),
});

export type FeedbackCategory = z.infer<typeof feedbackCategorySchema>;
export type FeedbackStatus = z.infer<typeof feedbackStatusSchema>;
export type FeedbackRelation = z.infer<typeof feedbackRelationSchema>;
export type Feedback = z.infer<typeof feedbackSchema>;
export type FeedbackList = z.infer<typeof feedbackListSchema>;
export type NewFeedback = z.infer<typeof newFeedbackSchema>;
export type FeedbackReply = z.infer<typeof feedbackReplySchema>;
export type FeedbackInboxQuery = z.infer<typeof feedbackInboxQuerySchema>;
