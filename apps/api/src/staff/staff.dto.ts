import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Огноо YYYY-MM-DD хэлбэртэй байна");

export const staffRecordKindSchema = z.enum(["EXPERIENCE", "CERTIFICATE", "QUALIFICATION"]);

/**
 * A member of staff's experience, certificate or grade — Order А/261,
 * criterion 51.
 *
 * ★ One schema for all three kinds, matching the one table.
 *
 * The alternative — a discriminated union with a different shape per kind —
 * would refuse an issuer on an EXPERIENCE row, and "Багшийн хөгжлийн төв"
 * is exactly what a teacher writes there when the post was a secondment. The
 * fields a kind does not use are simply left blank, which is what the paper
 * form does too.
 */
export const createStaffRecordSchema = z
  .object({
    kind: staffRecordKindSchema,
    title: z.string().trim().min(1, "Нэрийг бичнэ үү").max(200),
    issuer: z.string().trim().max(200).nullable().optional(),
    documentNo: z.string().trim().max(120).nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
    startedOn: isoDate,
    /**
     * ★ Optional and nullable, so "2019 оноос одоог хүртэл" is expressible.
     *
     * A certificate uses it as an expiry date; an experience row uses it as
     * the day the post ended. Null means "still current" in both readings,
     * which is why the expiry query can be one column rather than a rule per
     * kind.
     */
    endedOn: isoDate.nullable().optional(),
  })
  .strict()
  .refine((body) => !body.endedOn || body.startedOn <= body.endedOn, {
    message: "Дуусах огноо эхлэх огнооноос өмнө байна",
    path: ["endedOn"],
  });
export type CreateStaffRecordDto = z.infer<typeof createStaffRecordSchema>;

export const updateStaffRecordSchema = z
  .object({
    kind: staffRecordKindSchema.optional(),
    title: z.string().trim().min(1).max(200).optional(),
    issuer: z.string().trim().max(200).nullable().optional(),
    documentNo: z.string().trim().max(120).nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
    startedOn: isoDate.optional(),
    endedOn: isoDate.nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "Өөрчлөх талбар алга" });
export type UpdateStaffRecordDto = z.infer<typeof updateStaffRecordSchema>;

export const listStaffRecordsQuerySchema = z
  .object({ kind: staffRecordKindSchema.optional() })
  .strict();
export type ListStaffRecordsQuery = z.infer<typeof listStaffRecordsQuerySchema>;
