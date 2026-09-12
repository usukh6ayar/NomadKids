import { z } from "zod";
import { surveySchema } from "@kinder/contracts";

/**
 * Staff survey rows already carry the Prisma `createdById` scalar. The shared
 * public contract intentionally omits it, so staff screens opt into it here
 * without widening the parent-facing survey shape.
 */
export const staffSurveySchema = surveySchema.extend({
  createdById: z.string().uuid().nullish(),
});

export const staffSurveysSchema = z.array(staffSurveySchema);

export type StaffSurvey = z.infer<typeof staffSurveySchema>;

/**
 * Administrators oversee the whole kindergarten. A teacher's management
 * screens contain only surveys that teacher created. An absent creator id is
 * denied rather than guessed, so a partial response cannot expose another
 * person's survey.
 */
export function isSurveyOwner(
  survey: Pick<StaffSurvey, "createdById">,
  userId: string | null | undefined,
) {
  return Boolean(userId) && survey.createdById === userId;
}

export function canManageSurvey(
  survey: Pick<StaffSurvey, "createdById">,
  userId: string | null | undefined,
  isAdmin: boolean,
) {
  return isAdmin || isSurveyOwner(survey, userId);
}
