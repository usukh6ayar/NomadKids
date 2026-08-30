import { z } from "zod";
import { paginationQuerySchema, uuidSchema } from "@kinder/contracts";

/**
 * Targeting — §8.1.
 *
 * An **empty** array means the whole kindergarten. That is the same convention
 * the storage layer uses (no target rows), so the two cannot drift: there is no
 * separate "everyone" flag to leave stale when a target is added later.
 */
const targetSchema = z
  .object({
    groupId: uuidSchema.optional(),
    childId: uuidSchema.optional(),
  })
  .strict()
  .refine((t) => Boolean(t.groupId) !== Boolean(t.childId), {
    message: "Бүлэг эсвэл хүүхдийн аль нэгийг сонгоно уу",
  });

/** The client's nine, 2026-08-30. Mirrors the Prisma enum — see its note. */
export const notificationCategorySchema = z.enum([
  "ANNOUNCEMENT",
  "INFORMATION",
  "ADVICE",
  "ACTIVITY",
  "ROUTINE",
  "OUTING",
  "EVENT",
  "BIRTHDAY",
  "OTHER",
]);

/**
 * A heading, or nothing.
 *
 * ★ Optional since 2026-08-30, at the client's request.
 *
 * `.trim()` before the check, and empty becomes `null` rather than `""`: a form
 * that posts an untouched input sends the empty string, and storing that would
 * make "no title" and "a title of nothing" two states the UI has to tell apart.
 * One of them is enough.
 */
const optionalTitle = z
  .string()
  .trim()
  .max(200)
  .nullish()
  .transform((value) => (value ? value : null));

export const createNotificationSchema = z
  .object({
    title: optionalTitle,
    category: notificationCategorySchema.default("OTHER"),
    body: z.string().min(1, "Мэдэгдлийн текст оруулна уу").max(8000),
    isImportant: z.boolean().default(false),
    startsOn: z.coerce.date().nullable().optional(),
    endsOn: z.coerce.date().nullable().optional(),
    targets: z.array(targetSchema).max(50).default([]),
  })
  .strict()
  .refine((v) => !v.startsOn || !v.endsOn || v.endsOn >= v.startsOn, {
    message: "Дуусах огноо эхлэх огнооноос хойш байх ёстой",
    path: ["endsOn"],
  });
export type CreateNotificationDto = z.infer<typeof createNotificationSchema>;

export const updateNotificationSchema = z
  .object({
    title: optionalTitle,
    category: notificationCategorySchema.optional(),
    body: z.string().min(1).max(8000).optional(),
    isImportant: z.boolean().optional(),
    startsOn: z.coerce.date().nullable().optional(),
    endsOn: z.coerce.date().nullable().optional(),
    targets: z.array(targetSchema).max(50).optional(),
  })
  .strict();
export type UpdateNotificationDto = z.infer<typeof updateNotificationSchema>;

/**
 * Text, category and a date range — the client's 2026-08-30 filter.
 *
 * ★ `from`/`to` read `publishedAt`, not `createdAt`.
 *
 * A parent searching "2026.08.01–2026.08.30" means the month they could have
 * seen the notice, and a draft written in July and published in August belongs
 * to August. `createdAt` would answer a question nobody asked.
 */
export const listNotificationsQuerySchema = paginationQuerySchema.extend({
  unread: z.coerce.boolean().optional(),
  q: z.string().max(100).optional(),
  category: notificationCategorySchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
