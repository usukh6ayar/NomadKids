import { z } from "zod";
import { allergyKindSchema, allergySeveritySchema } from "@kinder/contracts";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Огноо YYYY-MM-DD хэлбэртэй байна");

/** `HH:MM`, 24-hour. What a reminder fires at. */
const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Цаг HH:MM хэлбэртэй байна (жишээ: 12:30)");

// ── Allergies ────────────────────────────────────────────────────────────────

export const createAllergySchema = z
  .object({
    kind: allergyKindSchema,
    severity: allergySeveritySchema,
    /**
     * ★ Trimmed and required, because this string is *matched* against a menu
     * dish's allergen tags. A leading space makes "самар" and " самар"
     * different allergens, and the child with the second one is not warned
     * about the first.
     */
    allergen: z.string().trim().min(1, "Харшил үүсгэгчийг бичнэ үү").max(120),
    reaction: z.string().max(2000).nullable().optional(),
    treatment: z.string().max(2000).nullable().optional(),
    notedOn: isoDate,
  })
  .strict();
export type CreateAllergyDto = z.infer<typeof createAllergySchema>;

export const updateAllergySchema = createAllergySchema
  .partial()
  .extend({
    /** Ending it, rather than deleting: the history survives. */
    endedOn: isoDate.nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "Өөрчлөх талбар алга" });
export type UpdateAllergyDto = z.infer<typeof updateAllergySchema>;

// ── Medication ───────────────────────────────────────────────────────────────

export const createMedicationSchema = z
  .object({
    medicineName: z.string().trim().min(1, "Эмийн нэрийг бичнэ үү").max(200),
    dosage: z.string().trim().min(1, "Тунг бичнэ үү").max(200),
    /**
     * At least one time, at most eight.
     *
     * ★ An empty array is refused rather than accepted as "no reminders". The
     * whole point of the record is that a teacher is reminded at the right
     * time; an authorisation with no times is a note nobody will act on, and
     * RFP Module 2 asks for the reminder in as many words.
     */
    timesOfDay: z.array(timeOfDay).min(1, "Хэдэн цагт өгөхийг сонгоно уу").max(8),
    instructions: z.string().max(2000).nullable().optional(),
    startsOn: isoDate,
    endsOn: isoDate,
  })
  .strict()
  .refine((body) => body.startsOn <= body.endsOn, {
    message: "Дуусах огноо эхлэх огнооноос өмнө байна",
    path: ["endsOn"],
  });
export type CreateMedicationDto = z.infer<typeof createMedicationSchema>;

// ── Vaccination ──────────────────────────────────────────────────────────────

export const createVaccinationSchema = z
  .object({
    vaccineName: z.string().trim().min(1, "Вакцины нэрийг бичнэ үү").max(200),
    administeredOn: isoDate,
    doseLabel: z.string().max(60).nullable().optional(),
    provider: z.string().max(200).nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
  })
  .strict();
export type CreateVaccinationDto = z.infer<typeof createVaccinationSchema>;
