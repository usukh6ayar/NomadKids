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
import { DataList, DataRow } from "@/components/ui/data-list";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { EsisDataPanel } from "@/components/esis/esis-data-panel";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { useBackdropDismiss } from "@/components/ui/modal-overlay";

const listSchema = z.array(schoolYearSchema);

/**
 * ★ The years this kindergarten has created, as a table — 2026-09-20, the
 * client: "он үүсгэж болж байна он нь дэлгэц дээр хүснэгтээр харагддаг болгоод
 * өгөөч".
 *
 * They were already being fetched. `years` has been queried on this screen
 * since the ESIS panel replaced the local list, and the result was used for
 * exactly one thing — `hasAny`, to decide whether a new year should default to
 * being the current one. So a director created a year, the request succeeded,
 * and the screen showed them the ministry's list with their own year nowhere
 * in it. Nothing was lost; nothing said so either.
 */
const YEAR_COLUMNS = [
  { key: "range", label: "Хугацаа", className: "md:w-[240px]" },
  { key: "state", label: "Төлөв", className: "md:w-[120px]" },
];

/** `2025-09-01` → `2025.09.01`; null → an em dash rather than an empty cell. */
function shortDate(value: string | null | undefined): string {
  if (!value) return "—";
  return value.slice(0, 10).replaceAll("-", ".");
}

/** Every mutation on this screen refetches the same list. */
const YEARS_KEY = ["admin", "school-years"] as const;

/**
 * School years.
 *
 * ★ The first thing that has to exist.
 *
 * A group belongs to a school year and an enrolment belongs to both, so nothing
 * else in the product can be created until one is here — which is why this
 * screen is at the top of the admin list even though it is used twice a year.
 *
 * ★★ What "Одоогийн" actually is, since the UI must not invent a second one.
 *
 * `SchoolYear.isCurrent` is a flag on the row, held to one `true` per
 * kindergarten by a partial unique index
 * (`school_years_one_current_per_kindergarten`). What reads it is narrower than
 * this file used to claim: `/admin/terms` picks it as the year whose terms it
 * shows, and `/admin/groups` defaults a new group to it. The dashboard does
 * *not* — it resolves "this term" from `Term.startsOn`/`endsOn` against today's
 * date, so it is unaffected by which year carries the flag.
 *
 * So the flag is the administrator's default selection, and moving it is
 * reversible by moving it back. It is promoted from the row rather than edited
 * in the form for two reasons: the API demotes the previous holder in the same
 * transaction, which is a change to a *different* row than the one being
 * edited; and `PATCH { isCurrent: false }` is accepted by the DTO and would
 * leave the kindergarten with no current year at all, which no screen here has
 * a use for. The UI only ever sends `true`.
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
    <div className="flex flex-col gap-6 lg:gap-8">
      <PageHeader
        title="Хичээлийн жил"
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
          title="Хичээлийн жил үүсгээгүй байна"
          description="Бүлэг, хүүхэд бүртгэхийн өмнө эхлээд хичээлийн жил үүсгэнэ үү."
        />
      ) : null}

      {items.length > 0 ? (
        <DataList columns={YEAR_COLUMNS} leadWidth={null}>
          {items.map((year) => (
            <DataRow
              key={year.id}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 truncate">{year.name}</span>
                </span>
              }
              cells={{
                range: (
                  <span className="text-body tabular-nums text-muted">
                    {shortDate(year.startsOn)} – {shortDate(year.endsOn)}
                  </span>
                ),
                /*
                 * ★ A badge only on the current year. Marking every other row
                 * "Идэвхгүй" would put a constant chip down the whole column
                 * and teach the eye to skip the one row that differs — the
                 * same reasoning the group list gives for its programme badge.
                 */
                state: year.isCurrent ? <Badge tone="mint">Одоогийн</Badge> : null,
              }}
            />
          ))}
        </DataList>
      ) : null}

      {/*
        ★ The academic years, from ESIS — 2026-09-08, at the client's
        instruction, given twice with the consequence written out first.

        The local list this screen used to draw is gone, and with it the row
        controls that had no other home: `MakeCurrentButton` and
        `EditYearButton`. `PATCH /school-years/:id` still exists and still
        works — nothing in this product calls it any more. "Жил нэмэх" still
        writes a local year, and the rest of the product still reads it.
      */}
      <EsisDataPanel
        resource="academicYearStatuses"
        title="Хичээлийн жил"
        description="Нээсэн ба хаасан огноо, идэвхтэй жил"
      />

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
  const toast = useToast();
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
      toast.success("Хичээлийн жил үүслээ.");
      void queryClient.invalidateQueries({ queryKey: YEARS_KEY });
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const errors = fieldErrors(create.error);

  const backdrop = useBackdropDismiss(onClose);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Хичээлийн жил нэмэх"
      {...backdrop}
      className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4"
    >
      <div className="w-full max-w-[420px] rounded-card border border-border bg-surface p-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!create.isPending) create.mutate();
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <h2 className="text-title font-semibold text-ink">Хичээлийн жил нэмэх</h2>

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
