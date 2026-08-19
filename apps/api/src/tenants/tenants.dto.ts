import { z } from "zod";
import { paginationQuerySchema, uuidSchema } from "@kinder/contracts";

/** Age bands of the Mongolian preschool system. Fixed, so an enum is correct. */
export const ageBandSchema = z.enum(["NURSERY", "JUNIOR", "MIDDLE", "SENIOR"]);
export const groupStatusSchema = z.enum(["ACTIVE", "ARCHIVED"]);
export const teacherRoleSchema = z.enum(["LEAD", "ASSISTANT"]);

export const updateKindergartenSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  address: z.string().max(500).nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  email: z.string().email().max(254).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateKindergartenDto = z.infer<typeof updateKindergartenSchema>;

/**
 * A school year, validated as a whole so `endsOn` can be compared to
 * `startsOn`. A field-level rule cannot see its sibling.
 */
export const createSchoolYearSchema = z
  .object({
    name: z.string().min(1).max(20),
    startsOn: z.coerce.date(),
    endsOn: z.coerce.date(),
    isCurrent: z.boolean().default(false),
  })
  .refine((v) => v.endsOn > v.startsOn, {
    message: "Дуусах огноо эхлэх огнооноос хойш байх ёстой",
    path: ["endsOn"],
  });
export type CreateSchoolYearDto = z.infer<typeof createSchoolYearSchema>;

export const updateSchoolYearSchema = z
  .object({
    name: z.string().min(1).max(20).optional(),
    startsOn: z.coerce.date().optional(),
    endsOn: z.coerce.date().optional(),
    isCurrent: z.boolean().optional(),
  })
  .refine((v) => !v.startsOn || !v.endsOn || v.endsOn > v.startsOn, {
    message: "Дуусах огноо эхлэх огнооноос хойш байх ёстой",
    path: ["endsOn"],
  });
export type UpdateSchoolYearDto = z.infer<typeof updateSchoolYearSchema>;

export const createGroupSchema = z.object({
  schoolYearId: uuidSchema,
  name: z.string().min(1, "Бүлгийн нэрийг оруулна уу").max(100),
  ageBand: ageBandSchema,
});
export type CreateGroupDto = z.infer<typeof createGroupSchema>;

export const updateGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  ageBand: ageBandSchema.optional(),
  status: groupStatusSchema.optional(),
});
export type UpdateGroupDto = z.infer<typeof updateGroupSchema>;

export const listGroupsQuerySchema = paginationQuerySchema.extend({
  kindergartenId: uuidSchema.optional(),
  schoolYearId: uuidSchema.optional(),
  status: groupStatusSchema.optional(),
});
export type ListGroupsQuery = z.infer<typeof listGroupsQuerySchema>;

export const assignTeacherSchema = z.object({
  membershipId: uuidSchema,
  role: teacherRoleSchema.default("LEAD"),
});
export type AssignTeacherDto = z.infer<typeof assignTeacherSchema>;
