import { z } from "zod";

/**
 * RFC 7807 problem+json — the single error shape for every endpoint.
 *
 * `detail` is shown to users, so it is written in Mongolian and must never
 * carry a child's name, a national id, a stack trace or an internal
 * identifier. `requestId` is what a user reports; the detail stays in the
 * server logs — docs/SECURITY.md §11.
 */
export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  requestId: z.string(),
  /** Field-level messages, present only on a 400. */
  errors: z.record(z.string(), z.array(z.string())).optional(),
});

export type Problem = z.infer<typeof problemSchema>;

/**
 * 404 is returned both when a resource is absent and when the actor may not
 * see it — CLAUDE.md §1.7. The two cases must be indistinguishable, so they
 * share one constant rather than two call sites that could drift.
 */
export const NOT_FOUND_TITLE = "Олдсонгүй";
