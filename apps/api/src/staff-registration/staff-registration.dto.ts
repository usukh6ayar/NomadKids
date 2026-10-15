import { z } from "zod";
import { ROSTER_INVITABLE_ROLES, paginationQuerySchema } from "@kinder/contracts";

/**
 * Shape only. This deliberately does not reject a malformed register number
 * with its own error — `StaffRegistrationService.register` treats "does not
 * parse" exactly like "not on the roster", both ending in the same
 * `REFUSAL`. A 400 here for a malformed value and a 401 there for an unknown
 * one would let a caller tell the two apart, which is precisely the
 * uniform-refusal property this route exists to keep.
 */
export const staffSelfRegistrationSchema = z
  .object({
    /**
     * The kindergarten's ESIS institution number — `Kindergarten.esisInstitutionId`.
     *
     * ★ Still only a shape check, and deliberately not `z.coerce.number()`:
     * the column is a `String?`, and parsing here would make "0042778" and
     * "42778" two different submissions for one kindergarten while telling a
     * caller, through a 400, that their value was at least numerically
     * plausible. `register()` trims it and looks it up; anything that does not
     * match ends in the same `REFUSAL` as everything else.
     */
    institutionId: z.string().min(1).max(64).optional(),
    /**
     * ★ Or the kindergarten chosen from `GET /public/kindergartens` (#211) —
     * teachers do not know the ESIS number by heart. Also only a shape: a
     * malformed, unknown or solo id ends in the same `REFUSAL`.
     */
    kindergartenId: z.string().min(1).max(64).optional(),
    registerNumber: z.string().min(1).max(32),
  })
  // Exactly one way to name the kindergarten. Which one was sent is the
  // caller's own choice, so saying so reveals nothing.
  .refine((dto) => (dto.institutionId === undefined) !== (dto.kindergartenId === undefined), {
    message: "Байгууллагын дугаар эсвэл цэцэрлэгийн аль нэгийг сонгоно уу",
    path: ["kindergartenId"],
  });

export type StaffSelfRegistrationDto = z.infer<typeof staffSelfRegistrationSchema>;

/**
 * The director's review list — Task 6. No filters beyond pagination: the
 * client asked to see who registered, not to search them.
 */
export const listSelfRegisteredQuerySchema = paginationQuerySchema;

export type ListSelfRegisteredQuery = z.infer<typeof listSelfRegisteredQuerySchema>;

/** `POST /kindergartens/:id/staff-invitations` — no body invites every unclaimed row. */
export const rosterInvitationSchema = z
  .object({
    esisPersonId: z.string().trim().min(1).max(64).optional(),
    /** Only with `esisPersonId`: overrides the role the job code would give. */
    role: z.enum(ROSTER_INVITABLE_ROLES).optional(),
  })
  .refine((body) => body.role === undefined || body.esisPersonId !== undefined, {
    message: "Эрхийг зөвхөн нэг хүнийг урихад сонгоно",
    path: ["role"],
  })
  .default({});
export type RosterInvitationDto = z.infer<typeof rosterInvitationSchema>;
