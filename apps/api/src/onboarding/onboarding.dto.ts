import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Огноо YYYY-MM-DD хэлбэртэй байна");

/**
 * A money amount as a decimal string.
 *
 * ★ Never a `z.number()`. A JSON number is a double and cannot round-trip
 * `12.50` exactly — `funding.dto.ts` sets out the argument at length, and a
 * contract's figures are the last place in the product where a rounding error
 * would be discovered late and by a lawyer.
 */
const money = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "Дүн 1234 эсвэл 1234.50 хэлбэртэй байна");

/**
 * The public registration form — step 2 of `docs/CONTRACT_ONBOARDING.md`.
 *
 * ★★★ **This is the product's only unauthenticated write, so every field is
 * bounded.** An unbounded `z.string()` on a public endpoint is a way to post a
 * megabyte into the database; `.max()` on all of them is the cheapest possible
 * defence and the one most often left out.
 *
 * ★★ It asks **nothing about a child**. `childCount` is a number used to price
 * the contract, never a roster. A form filled in by a stranger over a public
 * connection should carry as little as it can.
 *
 * ★ `registrationNumber` is seven digits — Mongolia's organisational
 * registration number — and `phone` eight. Loose strings here would let the
 * uniqueness index be defeated by whitespace or a stray dash, and that index is
 * what stops one kindergarten applying five times.
 */
export const submitApplicationSchema = z
  .object({
    kindergartenName: z.string().trim().min(2).max(200),
    registrationNumber: z
      .string()
      .trim()
      .regex(/^\d{7}$/, "Регистрийн дугаар 7 оронтой байна"),
    address: z.string().trim().min(4).max(500),
    directorName: z.string().trim().min(2).max(200),
    phone: z
      .string()
      .trim()
      .regex(/^\d{8}$/, "Утасны дугаар 8 оронтой байна"),
    email: z.string().trim().email("И-мэйл хаяг буруу байна").max(200),
    childCount: z.number().int().min(1).max(5000),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();
export type SubmitApplicationDto = z.infer<typeof submitApplicationSchema>;

/**
 * The terms the operator sets when approving — step 3.
 *
 * ★★★ Passed in and **frozen onto the `Contract` row**, never resolved from a
 * settings table at read time. A contract is a document two parties sign: if
 * its figures were live, changing a price would silently rewrite the content of
 * every contract already printed, signed and sealed, and the database would
 * disagree with the paper in the kindergarten's file. The paper is the one that
 * binds. `FundingRule`'s "a rate is never edited in place" is the same rule.
 */
export const approveApplicationSchema = z
  .object({
    /**
     * The first administrator's login name.
     *
     * ★★★ Asked for, not derived. Approving used to create a `Kindergarten`
     * and nothing else, which left a tenant **nobody could sign in to** — the
     * flow dead-ended at step 3. `POST /platform/kindergartens`, the older
     * direct path, has always created the admin and an invitation alongside
     * the tenant; approval now does the same thing, so there is one definition
     * of "a kindergarten exists" rather than two that disagree.
     *
     * It is a field rather than a slug of the kindergarten's name because a
     * login name is something a person has to be able to type and remember,
     * and Mongolian names do not transliterate to one obvious latin form.
     */
    adminUsername: z
      .string()
      .trim()
      .min(3, "Нэвтрэх нэр дор хаяж 3 тэмдэгт байх ёстой")
      .max(64)
      .regex(/^[a-zA-Z0-9._-]+$/, "Нэвтрэх нэр латин үсэг, тоо, . _ - агуулна"),
    annualFee: money,
    perChildMonthlyFee: money,
    startsOn: isoDate,
    endsOn: isoDate,
    reviewNote: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine((dto) => dto.endsOn > dto.startsOn, {
    message: "Дуусах огноо эхлэх огнооноос хойш байна",
    path: ["endsOn"],
  });
export type ApproveApplicationDto = z.infer<typeof approveApplicationSchema>;

/** Turning one down. A reason is required — the applicant is told it. */
export const rejectApplicationSchema = z
  .object({ reviewNote: z.string().trim().min(4).max(1000) })
  .strict();
export type RejectApplicationDto = z.infer<typeof rejectApplicationSchema>;

export const listApplicationsQuerySchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListApplicationsQuery = z.infer<typeof listApplicationsQuerySchema>;
