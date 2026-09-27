import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { paginated, surveySchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";

/**
 * "Удирдлагын судалгаа" — the administration's surveys, read by a teacher.
 * Client, 2026-09-17. `SurveysService.listFromAdministration` decides which.
 */
export const administrationSurveySchema = surveySchema.extend({
  isRead: z.boolean(),
  respondedCount: z.number().int(),
  expectedCount: z.number().int(),
});

export const administrationSurveysSchema = paginated(administrationSurveySchema);

export type AdministrationSurvey = z.infer<typeof administrationSurveySchema>;

/** Who is named as having asked — the office, never the person. */
export const ADMINISTRATION_AUTHOR = "Цэцэрлэгийн захиргаа";

/**
 * The short tag on every administration survey — client, 2026-09-17: "цэцэрлэг
 * гэсэн тэмдэглэгээ ... багшийн судалгаатай андуурагдаж магад". A teacher's
 * own surveys carry none, so the tag alone tells the two apart at a glance.
 */
export const ADMINISTRATION_TAG = "Цэцэрлэг";

/**
 * Whether this person is shown the administration's surveys at all.
 *
 * ★ A teacher who is not also an administrator. An administrator already sees
 * every survey on their own hub, and a badge for what their colleagues
 * published would be a count of things that are not news to them.
 */
export function useReadsAdministrationSurveys() {
  const { hasRole, primaryKindergartenId } = useSession();
  const enabled = hasRole("TEACHER") && !hasRole("ADMIN") && Boolean(primaryKindergartenId);
  return { enabled, kindergartenId: primaryKindergartenId ?? "" };
}

/**
 * How many of them this teacher has not opened — the hub card's badge and the
 * bell's. Polled at the notice board's cadence, which is what lets "мэдэгдэл
 * ирэх" happen without a reload.
 */
export function useAdministrationSurveyUnread(): number {
  return useAdministrationSurveyCounts().unread;
}

/** Both numbers from one request: unopened, and everything asked. */
export function useAdministrationSurveyCounts(): { unread: number; total: number } {
  const { enabled, kindergartenId } = useReadsAdministrationSurveys();
  const { data } = useQuery({
    queryKey: qk.administrationSurveyUnread(kindergartenId),
    queryFn: () =>
      get(
        `/kindergartens/${kindergartenId}/surveys/administration/unread-count`,
        z.object({ count: z.number().int(), total: z.number().int().default(0) }),
      ),
    enabled,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
  });
  return enabled ? { unread: data?.count ?? 0, total: data?.total ?? 0 } : { unread: 0, total: 0 };
}
