import { z } from "zod";
import { paginationQuerySchema } from "@kinder/contracts";

/**
 * Shape only. This deliberately does not reject a malformed register number
 * with its own error — `StaffRegistrationService.register` treats "does not
 * parse" exactly like "not on the roster", both ending in the same
 * `REFUSAL`. A 400 here for a malformed value and a 401 there for an unknown
 * one would let a caller tell the two apart, which is precisely the
 * uniform-refusal property this route exists to keep.
 */
export const staffSelfRegistrationSchema = z.object({
  code: z.string().min(1).max(64),
  registerNumber: z.string().min(1).max(32),
});

export type StaffSelfRegistrationDto = z.infer<typeof staffSelfRegistrationSchema>;

/**
 * The director's review list — Task 6. No filters beyond pagination: the
 * client asked to see who registered, not to search them.
 */
export const listSelfRegisteredQuerySchema = paginationQuerySchema;

export type ListSelfRegisteredQuery = z.infer<typeof listSelfRegisteredQuerySchema>;
