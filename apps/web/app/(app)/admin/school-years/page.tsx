"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus } from "lucide-react";
import { z } from "zod";
import { schoolYearSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RowList } from "@/components/ui/card";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";

const listSchema = z.array(schoolYearSchema);

/**
 * School years.
 *
 * ★ The first thing that has to exist.
 *
 * A group belongs to a school year and an enrolment belongs to both, so nothing
 * else in the product can be created until one is here — which is why this
 * screen is at the top of the admin list even though it is used twice a year.
 *
 * "Одоогийн" is what the dashboard, the assessment screens and the term reports
 * read to decide which year they are talking about. Exactly one is current; the
 * API moves the flag rather than letting two be set.
 */
export default function AdminSchoolYearsPage() {
  return (
    <RequireRole roles={["ADMIN"]}>
      <AdminSchoolYears />
    </RequireRole>
  );
}

function AdminSchoolYears() {
  const { primaryKindergartenId } = useSession();
  const [creating, setCreating] = useState(false);

  const years = useQuery({
    queryKey: qk.adminSchoolYears(primaryKindergartenId ?? ""),
    queryFn: () => get(`/kindergartens/${primaryKindergartenId}/school-years`, listSchema),
    enabled: Boolean(primaryKindergartenId),
  });

  const items = years.data ?? [];

  return (
    <div className="flex flex-col gap-5 lg:gap-7">
      <PageHeader
        title="Хичээлийн жил"
        lede="Бүлэг, элсэлт бүр хичээлийн жилд харьяалагдана."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus size={18} />
            Жил нэмэх
          </Button>
        }
      />

      {years.isLoading ? <LoadingState rows={2} /> : null}
      {years.isError ? <ErrorState description={errorMessage(years.error)} /> : null}

      {years.data && items.length === 0 ? (
        <EmptyState
          title="Хичээлийн жил байхгүй"
          description="Эндээс эхэлнэ — үүнгүйгээр бүлэг үүсгэх боломжгүй."
        />
      ) : null}

      {items.length > 0 ? (
        <RowList>
          {items.map((year) => (
            <div
              key={year.id}
              className="flex min-h-[56px] flex-wrap items-center gap-3 rounded-[14px] border border-border bg-surface px-4 py-3"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[.94rem] font-semibold text-ink">{year.name}</span>
                <span className="mt-px block text-[.78rem] text-muted">
                  {[year.startsOn?.slice(0, 10), year.endsOn?.slice(0, 10)]
                    .filter(Boolean)
                    .join(" — ") || "—"}
                </span>
              </span>
              {year.isCurrent ? <Badge tone="mint">Одоогийн</Badge> : null}
            </div>
          ))}
        </RowList>
      ) : null}

      {creating && primaryKindergartenId ? (
        <CreateYearDialog
          kindergartenId={primaryKindergartenId}
          onClose={() => setCreating(false)}
          hasAny={items.length > 0}
        />
      ) : null}
    </div>
  );
}

function CreateYearDialog({
  kindergartenId,
  onClose,
  hasAny,
}: {
  kindergartenId: string;
  onClose: () => void;
  hasAny: boolean;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  // The first year a kindergarten creates is almost certainly the one it is in.
  const [isCurrent, setIsCurrent] = useState(!hasAny);

  const create = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/school-years`, z.unknown(), {
        method: "POST",
        body: { name, startsOn, endsOn, isCurrent },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "school-years"] });
      onClose();
    },
  });

  const errors = fieldErrors(create.error);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Хичээлийн жил нэмэх"
      className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4"
    >
      <div className="w-full max-w-[420px] rounded-[18px] border border-border bg-surface p-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!create.isPending) create.mutate();
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <h2 className="text-[1.05rem] font-semibold text-ink">Хичээлийн жил нэмэх</h2>

          <FormError message={create.isError ? errorMessage(create.error) : null} />

          <Field label="Нэр" error={errors.name} hint="Жишээ: 2026-2027" required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="2026-2027"
                autoFocus
              />
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Эхлэх" error={errors.startsOn} required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  type="date"
                  value={startsOn}
                  onChange={(e) => setStartsOn(e.target.value)}
                />
              )}
            </Field>
            <Field label="Дуусах" error={errors.endsOn} required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  type="date"
                  value={endsOn}
                  onChange={(e) => setEndsOn(e.target.value)}
                />
              )}
            </Field>
          </div>

          <Checkbox
            label="Одоогийн жил болгох"
            description="Самбар, үнэлгээ, тайлан энэ жилийг уншина."
            checked={isCurrent}
            onChange={(e) => setIsCurrent(e.target.checked)}
          />

          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Үүсгэж байна…" : "Үүсгэх"}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Болих
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
