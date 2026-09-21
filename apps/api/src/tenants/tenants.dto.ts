import { z } from "zod";
import { paginationQuerySchema, uuidSchema } from "@kinder/contracts";

/** Age bands of the Mongolian preschool system. Fixed, so an enum is correct. */
export const ageBandSchema = z.enum(["NURSERY", "JUNIOR", "MIDDLE", "SENIOR"]);
export const groupStatusSchema = z.enum(["ACTIVE", "ARCHIVED"]);

/**
 * Order А/261, Annex 2 §1 — items 5, 6, 13, 14 (programme) and 16 (hours).
 *
 * Both are `ProgramKind`/`AttendanceForm` in the database and both default at
 * the column, so a create that omits them produces the ordinary group a
 * kindergarten mostly makes. Declared here rather than imported from contracts
 * for the same reason every other enum in this file is: the API validates its
 * own input, and the two lists are held together by `contracts-parity.test.ts`.
 */
export const programKindSchema = z.enum(["MAIN", "ALTERNATIVE"]);
export const attendanceFormSchema = z.enum(["STANDARD", "EXTENDED", "SHORTENED"]);
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
 * How long a school year's name may be.
 *
 * ★ **100, not 20 — 2026-09-20, at the client's instruction.** Twenty fits
 * "2025-2026" and nothing a director might actually want to write: a name
 * carrying a branch, a shift or a cohort ("2025-2026 оны хичээлийн жил —
 * ахлах бүлэг") runs past it, and the refusal arrived in English because the
 * constraint had no message. Both halves of that are fixed here.
 *
 * ★★ `SchoolYear.name` is an unbounded `String` in the schema — Postgres
 * `text` — so this is the only ceiling there has ever been and raising it
 * needs no migration. 100 matches the group name beside it rather than being
 * a second arbitrary number.
 */
const schoolYearName = z
  .string()
  .min(1, "Хичээлийн жилийн нэрийг оруулна уу")
  .max(100, "Хичээлийн жилийн нэр хэтэрхий урт байна");

/**
 * A school year, validated as a whole so `endsOn` can be compared to
 * `startsOn`. A field-level rule cannot see its sibling.
 */
export const createSchoolYearSchema = z
  .object({
    name: schoolYearName,
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
    name: schoolYearName.optional(),
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
  programKind: programKindSchema.default("MAIN"),
  attendanceForm: attendanceFormSchema.default("STANDARD"),
});
export type CreateGroupDto = z.infer<typeof createGroupSchema>;

export const updateGroupSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  ageBand: ageBandSchema.optional(),
  status: groupStatusSchema.optional(),
  /**
   * ★ `optional()` with no default, unlike the create schema.
   *
   * The same trap `updateSchoolYearSchema` documents for `isCurrent`: a
   * `.default("MAIN")` here would quietly convert an alternative-programme
   * group back to the main programme every time somebody renamed it.
   */
  programKind: programKindSchema.optional(),
  attendanceForm: attendanceFormSchema.optional(),
});
export type UpdateGroupDto = z.infer<typeof updateGroupSchema>;

export const listGroupsQuerySchema = paginationQuerySchema.extend({
  kindergartenId: uuidSchema.optional(),
  schoolYearId: uuidSchema.optional(),
  status: groupStatusSchema.optional(),
  /** Item 6 asks for the alternative-programme roster as its own list. */
  programKind: programKindSchema.optional(),
});
export type ListGroupsQuery = z.infer<typeof listGroupsQuerySchema>;

/**
 * Moving a group's children into next year's group — Order А/261, Annex 2 §1
 * item 9, mandatory.
 *
 * ★ `childIds` is optional, and its absence means "everyone".
 *
 * A promotion is normally the whole group, and requiring the caller to
 * enumerate thirty ids to express the ordinary case invites a client that
 * builds the list from a stale roster and quietly leaves a child behind. Naming
 * children is for the exception: the two who are repeating the year while the
 * rest move up.
 *
 * ★★ Capped, because CLAUDE.md §3.4 forbids an unbounded set and this one
 * writes. 200 is far above any real preschool group and far below a number that
 * would hold a transaction open.
 */
export const promoteGroupSchema = z.object({
  toGroupId: uuidSchema,
  childIds: z.array(uuidSchema).min(1).max(200).optional(),
  /** Defaults to today. The new enrollment starts and the old one ends here. */
  startedOn: z.coerce.date().optional(),
});
export type PromoteGroupDto = z.infer<typeof promoteGroupSchema>;

export const assignTeacherSchema = z.object({
  membershipId: uuidSchema,
  role: teacherRoleSchema.default("LEAD"),
});
export type AssignTeacherDto = z.infer<typeof assignTeacherSchema>;
