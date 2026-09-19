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

export const createKindergartenSchema = z
  .object({
    name: z.string().min(1, "Цэцэрлэгийн нэрийг оруулна уу").max(200),
    address: z.string().max(500).nullable().optional(),
    phone: z.string().max(20).nullable().optional(),
    email: z.string().email().max(254).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    admin: firstAdminSchema,
    /**
     * ★ Optional, deliberately. A deployment with no ESIS presence must still be
     * able to create a kindergarten, and leaving this blank is exactly today's
     * behaviour.
     */
    esisInstitutionId: z.string().trim().min(1).max(64).optional(),
    /** Which staff row becomes the Захирал/Эрхлэгч. Requires the id above. */
    adminEsisPersonId: z.string().trim().min(1).max(64).optional(),
  })
  /*
   * ★ A person without the institution they belong to is not a request this
   * service can answer — the staff list only exists once an institution has
   * been named. Rejected here rather than in the service, so it is a 400 about
   * a malformed body and not a 409 about the state of the world, and so ESIS is
   * never asked on its behalf.
   */
  .refine((body) => !body.adminEsisPersonId || Boolean(body.esisInstitutionId), {
    message: "Ажилтныг сонгохын өмнө ESIS байгууллагын кодыг оруулна уу",
    path: ["adminEsisPersonId"],
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

/**
 * `DELETE /platform/kindergartens/:id`.
 *
 * ★ A body on a DELETE, which is unusual, and the reason is the point: the
 * operator types the kindergarten's name back. See `PlatformService.remove`
 * for why a confirmation dialog was not judged enough.
 */
export const deleteKindergartenSchema = z.object({
  confirmName: z.string().trim().min(1, "Цэцэрлэгийн нэрийг бичнэ үү").max(200),
});
export type DeleteKindergartenDto = z.infer<typeof deleteKindergartenSchema>;

/**
 * `POST /platform/kindergartens/:id/admins`.
 *
 * ★ The same fields as the first director on `createKindergartenSchema`, and
 * deliberately the same shape: one way to describe an administrator, whether
 * they arrive with the kindergarten or a month later. `role` is absent for
 * the reason `firstAdminSchema` states — this route only ever makes an ADMIN.
 */
export const createKindergartenAdminSchema = firstAdminSchema;
export type CreateKindergartenAdminDto = z.infer<typeof createKindergartenAdminSchema>;
