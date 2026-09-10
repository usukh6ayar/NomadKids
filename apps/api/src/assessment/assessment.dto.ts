import { z } from "zod";
import { uuidSchema } from "@kinder/contracts";

export const createTermSchema = z
  .object({
    schoolYearId: uuidSchema,
    number: z.coerce.number().int().min(1).max(3),
    name: z.string().min(1).max(50),
    startsOn: z.coerce.date(),
    endsOn: z.coerce.date(),
  })
  .strict()
  .refine((v) => v.endsOn > v.startsOn, {
    message: "Дуусах огноо эхлэх огнооноос хойш байх ёстой",
    path: ["endsOn"],
  });
export type CreateTermDto = z.infer<typeof createTermSchema>;

export const updateTermSchema = z
  .object({
    name: z.string().min(1).max(50).optional(),
    startsOn: z.coerce.date().optional(),
    endsOn: z.coerce.date().optional(),
  })
  .strict();
export type UpdateTermDto = z.infer<typeof updateTermSchema>;

/** One child, one domain, one term. */
export const saveAssessmentSchema = z
  .object({
    termId: uuidSchema,
    domainId: uuidSchema,
    levelId: uuidSchema,
    comment: z.string().max(2000).nullable().optional(),
  })
  .strict();
export type SaveAssessmentDto = z.infer<typeof saveAssessmentSchema>;

/**
 * ★ The group screen requires **both** a term and a single domain.
 *
 * Not optional, and not a list of domains. The MVP assesses one development
 * domain at a time — a teacher holds one rubric in mind and applies it down the
 * roster. Making `domainId` required is what stops the endpoint quietly
 * becoming the matrix the scope rules out.
 */
export const groupColumnQuerySchema = z
  .object({
    termId: uuidSchema,
    domainId: uuidSchema,
  })
  .strict();
export type GroupColumnQuery = z.infer<typeof groupColumnQuerySchema>;

export const saveGroupColumnSchema = z
  .object({
    termId: uuidSchema,
    domainId: uuidSchema,
    entries: z
      .array(
        z
          .object({
            childId: uuidSchema,
            levelId: uuidSchema,
            comment: z.string().max(2000).nullable().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(60),
  })
  .strict();
export type SaveGroupColumnDto = z.infer<typeof saveGroupColumnSchema>;

/** Publishing is per term, not per assessment — see the repository. */
export const publishTermSchema = z.object({ termId: uuidSchema, visible: z.boolean() }).strict();
export type PublishTermDto = z.infer<typeof publishTermSchema>;

export const saveTermReportSchema = z
  .object({
    termId: uuidSchema,
    strengths: z.string().max(4000).nullable().optional(),
    needsSupport: z.string().max(4000).nullable().optional(),
    nextGoals: z.string().max(4000).nullable().optional(),
    adviceForParents: z.string().max(4000).nullable().optional(),
  })
  .strict();
export type SaveTermReportDto = z.infer<typeof saveTermReportSchema>;

export const termIdQuerySchema = z.object({ termId: uuidSchema.optional() });
export const requiredTermSchema = z.object({ termId: uuidSchema });

/**
 * Сарын зорилт — how many notes each child should have per month.
 *
 * ★ Bounded at twenty, and nullable rather than zero-able.
 *
 * Null is "no goal", which draws no card. Zero would be a goal every group
 * meets without writing anything — a bar permanently at 100% saying nothing,
 * which is worse than no bar at all.
 */
export const monthlyNoteGoalSchema = z
  .object({ monthlyNoteGoal: z.number().int().min(1).max(20).nullable() })
  .strict();
export type MonthlyNoteGoalDto = z.infer<typeof monthlyNoteGoalSchema>;
