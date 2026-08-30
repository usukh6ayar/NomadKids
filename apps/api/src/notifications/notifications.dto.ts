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

export const createNotificationSchema = z
  .object({
    title: z.string().min(1, "Гарчиг оруулна уу").max(200),
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
    title: z.string().min(1).max(200).optional(),
    body: z.string().min(1).max(8000).optional(),
    isImportant: z.boolean().optional(),
    startsOn: z.coerce.date().nullable().optional(),
    endsOn: z.coerce.date().nullable().optional(),
    targets: z.array(targetSchema).max(50).optional(),
  })
  .strict();
export type UpdateNotificationDto = z.infer<typeof updateNotificationSchema>;

export const listNotificationsQuerySchema = paginationQuerySchema.extend({
  unread: z.coerce.boolean().optional(),
  q: z.string().max(100).optional(),
  /**
   * The board for one group — §8.1's targeting, read back.
   *
   * ★ It narrows what the actor may already see; it never widens it.
   *
   * `audienceFilter` decides the set, and this is folded in as one more `AND`
   * beside it (`NotificationsRepository.list`). A guardian passing another
   * group's id therefore gets an empty board rather than that group's — the
   * filter is a view of their own audience, not a way to address a different
   * one.
   *
   * ★★ A notice for the whole kindergarten belongs to every group's board.
   *
   * "No target rows" is this module's convention for "everyone" (see
   * `targetSchema` above), so filtering by group has to match a notice aimed at
   * that group *or* aimed at nobody in particular. The alternative — showing
   * only group-specific notices — would hide the closure announcement from
   * every board in the kindergarten.
   */
  groupId: uuidSchema.optional(),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
