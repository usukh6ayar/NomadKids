"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check, Copy, KeyRound, RefreshCw } from "lucide-react";
import { z } from "zod";
import {
  ROLE_LABEL,
  selfRegisteredStaffListSchema,
  staffRegistrationCodeIssuedSchema,
  staffRosterRefreshSchema,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { formatDate, formatRelative } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataList, DataRow } from "@/components/ui/data-list";
import { Pagination, ResultCount } from "@/components/ui/pagination";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";

const COLUMNS = [
  { key: "role", label: "Эрх", className: "md:w-[140px]" },
  { key: "registeredAt", label: "Бүртгүүлсэн", className: "md:w-[160px]" },
];

/**
 * The director's side of staff self-registration.
 *
 * ★ Three separate jobs, three cards: issuing the code
 * (`POST /kindergartens/:id/staff-registration-code`), refreshing the stored
 * ESIS roster the public route matches against
 * (`POST /kindergartens/:id/esis/staff-roster/refresh`), and reviewing who has
 * used the code so far (`GET /kindergartens/:id/staff-registrations`). The
 * client asked for review, not approval — "захирал заавал батлах хэрэг
 * байхгүй зүгээр хянахад л болно" — so there is no accept/reject step here,
 * only a name, a role, a date and a way to revoke.
 *
 * ★★ **When the code was last set is not readable from any GET the API
 * exposes.** `Kindergarten.staffRegistrationCodeSetAt` is written by
 * `StaffRegistrationService.issueCode` but no read endpoint returns it —
 * `GET /kindergartens/:id` (`TenantsController.getKindergarten`) is not
 * modelled to carry it, and adding that is a backend change outside this
 * screen's scope. So "Гаргасан:" below reflects only what this browser tab has
 * seen since it was opened — the response to the last `POST` it sent — rather
 * than the kindergarten's true history. A director who reloads the page after
 * issuing a code will see the empty state again, correctly: this screen would
 * otherwise have to guess.
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
  const [revealed, setRevealed] = useState<{ code: string; setAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const registrationsKey = qk.adminStaffRegistrations(primaryKindergartenId ?? "", page);

  const issue = useMutation({
    mutationFn: () =>
      mutate(
        `/kindergartens/${primaryKindergartenId}/staff-registration-code`,
        staffRegistrationCodeIssuedSchema,
        { method: "POST" },
      ),
    onSuccess: (result) => {
      setRevealed(result);
      setCopied(false);
    },
  });

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
      <PageHeader title="Ажилтны бүртгэлийн код" />

      <Card pad="roomy" className="max-w-[680px]">
        <SectionHeader
          title="Бүртгэлийн код"
          lede="Ажилтан энэ кодыг өөрийн регистрийн дугаараа ашиглан бүртгүүлэхдээ шаардана."
        />

        {revealed ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-control bg-canvas px-3 py-2.5 text-lead font-semibold tracking-wide text-ink">
                {revealed.code}
              </code>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(revealed.code).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  });
                }}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? "Хуулагдлаа" : "Хуулах"}
              </Button>
            </div>
            <p className="rounded-control bg-sun px-3 py-2 text-caption leading-relaxed text-sun-ink">
              Энэ кодыг дахин харуулах боломжгүй. Хаасны дараа шаардлагатай бол шинийг гаргана уу.
            </p>
            <p className="text-caption text-muted">Гаргасан: {formatDate(revealed.setAt)}</p>
          </div>
        ) : (
          <p className="text-body text-muted">
            Энэ удаагийн session-д код гаргаагүй байна. Доорх товчоор шинээр гаргана уу.
          </p>
        )}

        <FormError message={issue.isError ? errorMessage(issue.error) : null} />

        <Button
          type="button"
          onClick={() => issue.mutate()}
          disabled={issue.isPending || !primaryKindergartenId}
          className="mt-4"
        >
          <KeyRound size={18} aria-hidden />
          {issue.isPending ? "Гаргаж байна…" : revealed ? "Шинэ код гаргах" : "Код гаргах"}
        </Button>
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
