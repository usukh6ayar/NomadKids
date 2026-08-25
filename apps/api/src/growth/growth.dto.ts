import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Огноо YYYY-MM-DD хэлбэртэй байна");

/** The `:date` route param on `PUT /children/:id/growth/:date`. */
export const growthDateParamSchema = z.object({ date: isoDate });
export type GrowthDateParam = z.infer<typeof growthDateParamSchema>;

/**
 * Plausibility bounds, not medical ones — RFP §7.1.
 *
 * ★ Wide on purpose. These exist to catch a typed unit or a slipped decimal
 * point (17 cm, 850 kg), not to decide whether a measurement is healthy. That
 * judgement is a clinician's, and §7.2 is explicit that this system "эмнэлгийн
 * онош өгөхгүй". A range narrow enough to be an opinion would start rejecting
 * real children.
 */
const heightCm = z.coerce
  .number()
  .min(30, "Өндөр 30–200 см хооронд байна")
  .max(200, "Өндөр 30–200 см хооронд байна");

const weightKg = z.coerce
  .number()
  .min(2, "Жин 2–100 кг хооронд байна")
  .max(100, "Жин 2–100 кг хооронд байна");

const headCircumferenceCm = z.coerce
  .number()
  .min(25, "Толгойн тойрог 25–65 см хооронд байна")
  .max(65, "Толгойн тойрог 25–65 см хооронд байна");

/**
 * "This quantity was measured" — present and not explicitly cleared.
 *
 * ★ Named rather than written as `!= null`, which the project's `eqeqeq` rule
 * refuses. The loose comparison is the idiomatic way to catch null and
 * undefined together; spelling it out at every call site is noise, and turning
 * the rule off for one file trades a real guarantee for a keystroke.
 */
function isMeasured(value: number | null | undefined): boolean {
  return value !== null && value !== undefined;
}

/**
 * ★ At least one measurement, or the row means nothing.
 *
 * All three fields are individually optional — a nurse weighing a class does
 * not measure every head — but a record carrying only a note is not a
 * measurement, and it would draw a gap in the chart while occupying the day's
 * unique slot.
 */
export const recordGrowthSchema = z
  .object({
    heightCm: heightCm.nullable().optional(),
    weightKg: weightKg.nullable().optional(),
    headCircumferenceCm: headCircumferenceCm.nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
  })
  .strict()
  .refine((body) => [body.heightCm, body.weightKg, body.headCircumferenceCm].some(isMeasured), {
    message: "Өндөр, жин эсвэл толгойн тойргийн аль нэгийг оруулна уу",
    path: ["heightCm"],
  });
export type RecordGrowthDto = z.infer<typeof recordGrowthSchema>;

/**
 * The chart's range. Both ends optional: the default is a child's whole
 * history, which is what RFP §7.2's "хугацааны график" means for a record that
 * spans at most four years.
 */
export const listGrowthQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: "Эхлэх огноо дуусах огнооноос хойш байна",
    path: ["from"],
  });
export type ListGrowthQuery = z.infer<typeof listGrowthQuerySchema>;
