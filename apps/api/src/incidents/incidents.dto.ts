import { z } from "zod";
import { searchTermSchema } from "../common/repository/search";

export const INCIDENT_KINDS = [
  "INJURY",
  "FALL",
  "BRUISE",
  "SCRATCH",
  "BITE",
  "ALLERGIC_REACTION",
  "FEVER",
  "ILLNESS",
  "OTHER",
] as const;

/**
 * The body fields, before the "not in the future" rule.
 *
 * Extracted so the update schema can be `.partial()` on the same shape — a
 * refinement wraps the object and cannot be partialled through, and restating
 * eight fields is how the two drift.
 */
const incidentBody = z.object({
  kind: z.enum(INCIDENT_KINDS),
  /**
   * ★ A full timestamp, not a date. RFP Module 2.1 asks for "Огноо, цаг"
   * together — "which of the two falls this afternoon" is a question a
   * parent asks, and a date alone cannot answer it.
   */
  occurredAt: z.coerce.date(),
  location: z.string().max(200).nullable().optional(),
  bodyPart: z.string().max(200).nullable().optional(),
  /** Required: an incident nobody described is not a record. */
  description: z.string().trim().min(1, "Юу болсныг бичнэ үү").max(4000),
  firstAid: z.string().max(4000).nullable().optional(),
  followUp: z.string().max(4000).nullable().optional(),
  isHighPriority: z.boolean().default(false),
});

const notInTheFuture = (body: { occurredAt?: Date }) =>
  body.occurredAt === undefined || body.occurredAt.getTime() <= Date.now();

const futureMessage = {
  message: "Тохиолдлын цаг ирээдүйд байж болохгүй",
  path: ["occurredAt"] as const,
};

export const createIncidentSchema = incidentBody.strict().refine(notInTheFuture, {
  message: futureMessage.message,
  path: [...futureMessage.path],
});
export type CreateIncidentDto = z.infer<typeof createIncidentSchema>;

export const updateIncidentSchema = incidentBody
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "Өөрчлөх талбар алга" })
  .refine(notInTheFuture, { message: futureMessage.message, path: [...futureMessage.path] });
export type UpdateIncidentDto = z.infer<typeof updateIncidentSchema>;

/**
 * Telling the family — RFP Module 2.1's "эцэг эхэд шуурхай мэдээлэх".
 *
 * The message is composed by the teacher rather than generated from the
 * incident's fields. A machine-written "Таны хүүхэд уналт болсон" is both
 * colder and less accurate than what the person who was there would say, and
 * this is the sentence a parent remembers.
 */
export const reportIncidentSchema = z
  .object({
    title: z.string().trim().min(1, "Гарчиг оруулна уу").max(200),
    body: z.string().trim().min(1, "Мэдэгдлийн текст оруулна уу").max(8000),
  })
  .strict();
export type ReportIncidentDto = z.infer<typeof reportIncidentSchema>;

export const listIncidentsQuerySchema = z.object({
  /** The unreported queue — Module 2.1's reason for `reportedAt` being null. */
  unreportedOnly: z.coerce.boolean().optional(),
  highPriorityOnly: z.coerce.boolean().optional(),
  /** А/261 шалгуур 21 — added 2026-09-05 with the rest of the sweep. */
  q: searchTermSchema,
});
export type ListIncidentsQuery = z.infer<typeof listIncidentsQuerySchema>;
