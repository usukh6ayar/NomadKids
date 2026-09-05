import { z } from "zod";
import { paginationQuerySchema } from "@kinder/contracts";
import { createUserSchema } from "../users/users.dto";
import { searchTermSchema } from "../common/repository/search";

/**
 * The first director, created with the kindergarten.
 *
 * ★ `role` is omitted rather than accepted. Registering a kindergarten always
 * creates an ADMIN; a body-supplied role would let the operator produce a
 * kindergarten whose only member is a parent — a tenant nobody can administer.
 */
const firstAdminSchema = createUserSchema.omit({ role: true });

export const createKindergartenSchema = z.object({
  name: z.string().min(1, "Цэцэрлэгийн нэрийг оруулна уу").max(200),
  address: z.string().max(500).nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  email: z.string().email().max(254).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  admin: firstAdminSchema,
});
export type CreateKindergartenDto = z.infer<typeof createKindergartenSchema>;

export const listPlatformKindergartensQuerySchema = paginationQuerySchema.extend({
  q: searchTermSchema,
  /**
   * ★ `z.stringbool()`, NOT `z.coerce.boolean()`.
   *
   * `Boolean("false")` is `true`, so a coerced boolean turns `?isActive=false`
   * into a filter for *active* rows — the opposite of what was asked, silently.
   * `listUsersQuerySchema` has that bug today; do not copy it here.
   */
  isActive: z.stringbool().optional(),
});
export type ListPlatformKindergartensQuery = z.infer<typeof listPlatformKindergartensQuerySchema>;
