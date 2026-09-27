import { z } from "zod";
import { paginationQuerySchema, uuidSchema } from "@kinder/contracts";
import { searchTermSchema } from "../common/repository/search";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Огноо YYYY-MM-DD хэлбэртэй байна");

const fields = {
  name: z.string().trim().min(1, "Нэрийг оруулна уу").max(200),
  schoolYearId: uuidSchema,
  /** Null (or omitted) is a union with no lead yet. */
  leadMembershipId: uuidSchema.nullable().optional(),
  startsOn: isoDate,
  endsOn: isoDate.nullable().optional(),
  esisAcademicOrgId: z.string().trim().max(64).nullable().optional(),
};

/*
  ★ The date order is checked here for a create, where both ends arrive
  together, and in the service for an edit, where one end can arrive alone
  and has to be compared with the stored other.
*/
export const createMethodUnionSchema = z
  .object(fields)
  .strict()
  .refine((body) => !body.endsOn || body.endsOn >= body.startsOn, {
    message: "Дуусах огноо эхлэх огнооноос өмнө байж болохгүй",
    path: ["endsOn"],
  });
export type CreateMethodUnionDto = z.infer<typeof createMethodUnionSchema>;

export const updateMethodUnionSchema = z
  .object(fields)
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "Өөрчлөх талбар алга" });
export type UpdateMethodUnionDto = z.infer<typeof updateMethodUnionSchema>;

export const listMethodUnionsQuerySchema = paginationQuerySchema.extend({
  q: searchTermSchema,
  schoolYearId: uuidSchema.optional(),
});
export type ListMethodUnionsQuery = z.infer<typeof listMethodUnionsQuerySchema>;

export const addMethodUnionMemberSchema = z.object({ membershipId: uuidSchema }).strict();
export type AddMethodUnionMemberDto = z.infer<typeof addMethodUnionMemberSchema>;
