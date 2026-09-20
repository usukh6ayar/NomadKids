"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check, Copy, RefreshCw } from "lucide-react";
import { z } from "zod";
import {
  ROLE_LABEL,
  selfRegisteredStaffListSchema,
  staffRosterRefreshSchema,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { formatRelative } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataList, DataRow } from "@/components/ui/data-list";
import { Pagination, ResultCount } from "@/components/ui/pagination";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";

/**
 * Only what this screen shows. `GET /kindergartens/:id` returns
 * `esisInstitutionId` to an ADMIN of that kindergarten and to nobody else
 * (`TenantsRepository.ADMIN_FIELDS`), so it is `nullish()` here for the
 * kindergarten that has never been mapped to ESIS rather than because the
 * field is sometimes withheld from a reader who should see it.
 */
const kindergartenInstitutionSchema = z.object({
  esisInstitutionId: z.string().nullish(),
});

const COLUMNS = [
  { key: "role", label: "Эрх", className: "md:w-[140px]" },
  { key: "registeredAt", label: "Бүртгүүлсэн", className: "md:w-[160px]" },
];

/**
 * The director's side of staff self-registration.
 *
 * ★ Three separate jobs, three cards: showing the kindergarten's ESIS
 * institution number, which is what a member of staff types into the public
 * form; refreshing the stored ESIS roster that form is matched against
 * (`POST /kindergartens/:id/esis/staff-roster/refresh`); and reviewing who has
 * registered so far (`GET /kindergartens/:id/staff-registrations`). The
 * client asked for review, not approval — "захирал заавал батлах хэрэг
 * байхгүй зүгээр хянахад л болно" — so there is no accept/reject step here,
 * only a name, a role, a date and a way to revoke.
 *
 * ★★ **The first card used to issue a code, and issues nothing now.**
 * 2026-09-20, the client: "institutionID нь байя. Цэцэрлэгийн код нь." The
 * number it shows is read from `GET /kindergartens/:id`, which returns it to
 * an ADMIN of that kindergarten only, so the card can be reloaded — where the
 * issued code could be shown exactly once and this screen had to admit, in a
 * comment twice this length, that a reload lost it.
 *
 * ★★★ It is **displayed, never edited.** `esisInstitutionId` is set when the
 * platform operator maps the kindergarten to ESIS, and a director retyping it
 * here would silently point their whole staff roster at another institution.
 */
export default function AdminStaffCodePage() {
  return (
    <RequireRole roles={["ADMIN"]}>
      <AdminStaffCode />
    </RequireRole>
  );
}

function AdminStaffCode() {
  const { primaryKindergartenId } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [copied, setCopied] = useState(false);

  const registrationsKey = qk.adminStaffRegistrations(primaryKindergartenId ?? "", page);

  const kindergarten = useQuery({
    queryKey: qk.adminKindergarten(primaryKindergartenId ?? ""),
    queryFn: () => get(`/kindergartens/${primaryKindergartenId}`, kindergartenInstitutionSchema),
    enabled: Boolean(primaryKindergartenId),
  });
  const institutionId = kindergarten.data?.esisInstitutionId ?? null;

  const refresh = useMutation({
    mutationFn: () =>
      mutate(
        `/kindergartens/${primaryKindergartenId}/esis/staff-roster/refresh`,
        staffRosterRefreshSchema,
        { method: "POST" },
      ),
    onSuccess: (result) => {
      toast.success(
        `Жагсаалт шинэчлэгдлээ: ${result.count} бүртгэгдэв, ${result.skipped} алгассан.`,
      );
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const registrations = useQuery({
    queryKey: registrationsKey,
    queryFn: () =>
      get(
        `/kindergartens/${primaryKindergartenId}/staff-registrations?page=${page}&pageSize=25`,
        selfRegisteredStaffListSchema,
      ),
    enabled: Boolean(primaryKindergartenId),
  });

  const revoke = useMutation({
    mutationFn: (membershipId: string) =>
      mutate(`/memberships/${membershipId}`, z.unknown(), { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Эрхийг хураалаа.");
      void queryClient.invalidateQueries({ queryKey: registrationsKey });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="flex w-full flex-col gap-6 lg:gap-8">
      <PageHeader title="Ажилтны бүртгэл" />

      <Card pad="roomy" className="max-w-[680px]">
        <SectionHeader
          title="Цэцэрлэгийн ESIS дугаар"
          lede="Ажилтан энэ дугаарыг өөрийн регистрийн дугаартай хамт бүртгүүлэхдээ оруулна."
        />

        {kindergarten.isLoading ? (
          <LoadingState rows={1} />
        ) : kindergarten.isError ? (
          <FormError message={errorMessage(kindergarten.error)} />
        ) : institutionId ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-control bg-canvas px-3 py-2.5 text-lead font-semibold tracking-wide text-ink">
                {institutionId}
              </code>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(institutionId).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  });
                }}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? "Хуулагдлаа" : "Хуулах"}
              </Button>
            </div>
            <p className="text-caption leading-relaxed text-muted">
              Ажилтнууддаа{" "}
              <span className="font-semibold text-ink">nomadkids.mn/staff-register</span> хаяг болон
              энэ дугаарыг дамжуулна уу. Доорх жагсаалт шинэчлэгдсэн байх шаардлагатай.
            </p>
          </div>
        ) : (
          /*
           * ★ Reachable, and the only state on this screen that stops staff
           * registration outright: the kindergarten was never mapped to ESIS,
           * so there is no number to hand out and no roster to match against.
           * Only the platform operator can fix it, which is what this says.
           */
          <EmptyState
            title="ESIS-тэй холбогдоогүй байна"
            description="Энэ цэцэрлэг ESIS-ийн байгууллагатай холбогдоогүй тул ажилтан өөрөө бүртгүүлэх боломжгүй. Системийн операторт хандана уу."
          />
        )}
      </Card>

      <Card pad="roomy" className="max-w-[680px]">
        <SectionHeader
          title="ESIS жагсаалт"
          lede="Бүртгүүлж болох ажилтнуудын жагсаалтыг ESIS-ээс дахин татна."
        />
        <FormError message={refresh.isError ? errorMessage(refresh.error) : null} />
        <Button
          type="button"
          variant="secondary"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending || !primaryKindergartenId}
        >
          <RefreshCw size={18} aria-hidden />
          {refresh.isPending ? "Шинэчилж байна…" : "Жагсаалтыг шинэчлэх"}
        </Button>
      </Card>

      <div className="flex flex-col gap-3">
        <SectionHeader title="Бүртгүүлсэн ажилтнууд" />

        {registrations.isLoading ? (
          <LoadingState rows={3} />
        ) : registrations.isError ? (
          <ErrorState description={errorMessage(registrations.error)} />
        ) : (registrations.data?.items.length ?? 0) === 0 ? (
          <EmptyState
            title="Хэн ч өөрөө бүртгүүлээгүй байна"
            description="Кодоо гаргаад ажилтандаа өгснөөр тэд өөрөө бүртгүүлэх боломжтой болно."
          />
        ) : (
          <>
            <ResultCount total={registrations.data?.total ?? 0} noun="бүртгэл" />
            <DataList columns={COLUMNS} leadWidth={null} actionsWidth="w-[140px]">
              {registrations.data!.items.map((row) => (
                <DataRow
                  key={row.membershipId}
                  title={`${row.lastName} ${row.firstName}`}
                  cells={{
                    role: <span className="text-body text-muted">{ROLE_LABEL[row.role]}</span>,
                    registeredAt: (
                      <span className="text-body text-muted">
                        {formatRelative(row.registeredAt)}
                      </span>
                    ),
                  }}
                  actions={
                    <ConfirmDialog
                      title="Эрхийг хураах"
                      description={`${row.lastName} ${row.firstName} гишүүнийг энэ цэцэрлэгээс хасах уу?`}
                      confirmLabel="Эрхийг хураах"
                      pendingLabel="Хурааж байна…"
                      tone="danger"
                      pending={revoke.isPending}
                      onConfirm={() => revoke.mutate(row.membershipId)}
                      trigger={
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-danger hover:bg-danger-soft"
                        >
                          Эрхийг хураах
                        </Button>
                      }
                    />
                  }
                />
              ))}
            </DataList>
            <Pagination
              page={page}
              totalPages={registrations.data?.totalPages ?? 1}
              onPage={setPage}
            />
          </>
        )}
      </div>
    </div>
  );
}
