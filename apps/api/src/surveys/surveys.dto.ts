import { z } from "zod";
import { uuidSchema } from "@kinder/contracts";

export const createSurveySchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(2000).nullable().optional(),
    scope: z.enum(["CHILD", "KINDERGARTEN"]),
  })
  .strict();
export type CreateSurveyDto = z.infer<typeof createSurveySchema>;

const questionInputSchema = z
  .object({
    order: z.number().int().min(0),
    type: z.enum(["RATING", "YES_NO", "TEXT", "CHECKBOX"]),
    prompt: z.string().min(1).max(500),
    options: z.array(z.string().min(1).max(120)).max(20).nullable().optional(),
  })
  .refine((q) => q.type !== "CHECKBOX" || (q.options?.length ?? 0) > 0, {
    message: "Олон сонголттой асуулт хамгийн багадаа нэг сонголттой байна",
    path: ["options"],
  });

export const saveQuestionsSchema = z
  .object({
    questions: z.array(questionInputSchema).min(1).max(30),
  })
  .strict();
export type SaveQuestionsDto = z.infer<typeof saveQuestionsSchema>;

const answerValueSchema = z.union([z.number(), z.boolean(), z.string(), z.array(z.string())]);

export const submitResponseSchema = z
  .object({
    childId: uuidSchema.nullable().optional(),
    answers: z
      .array(z.object({ questionId: uuidSchema, value: answerValueSchema }))
      .min(1)
      .max(30),
  })
  .strict();
export type SubmitResponseDto = z.infer<typeof submitResponseSchema>;
