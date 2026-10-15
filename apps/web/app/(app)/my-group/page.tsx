"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { groupListItemSchema, paginated, schoolYearSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { useSoloWorkspaceId } from "@/lib/auth/solo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "@/components/shell/app-shell";

const yearsSchema = z.array(schoolYearSchema);
const groupsSchema = paginated(groupListItemSchema);
type SchoolYear = z.infer<typeof schoolYearSchema>;
type Group = z.infer<typeof groupListItemSchema>;

/** The same four bands, in the same words, as «Анги бүлэг» (`/admin/groups`). */
const AGE_BANDS = [
  { value: "NURSERY", label: "Бага бүлэг" },
  { value: "JUNIOR", label: "Дунд бүлэг" },
  { value: "MIDDLE", label: "Ахлах бүлэг" },
  { value: "SENIOR", label: "Бэлтгэл бүлэг" },
] as const;

const KEY = ["solo-workspace"] as const;

/** `2025-09-01` → `2025.09.01`. */
function shortDate(value: string | null | undefined): string {
  return value ? value.slice(0, 10).replaceAll("-", ".") : "—";
}

/**
 * The year to suggest: September to May, from June the coming one — and the
 * one after, when that name is already taken.
 */
function suggestedYear(years: SchoolYear[]) {
  const today = new Date();
  let start = today.getMonth() >= 5 ? today.getFullYear() : today.getFullYear() - 1;
  const names = new Set(years.map((y) => y.name));
  while (names.has(`${start}-${start + 1}`)) start += 1;
  return {
    name: `${start}-${start + 1}`,
    startsOn: `${start}-09-01`,
    endsOn: `${start + 1}-05-31`,
  };
}

/**
 * «Бүлэг, хичээлийн жил» — a solo teacher's own set-up (the user, 2026-10-14:
 * "багш дангаар бүртгүүлэхэд өөрөө бүлгээ, хичээлийн жил нтрээ өөрөө үүсгээд
 * ашиглана").
 *
 * ★ Not `/admin/school-years` and `/admin/groups` with the role check loosened.
 * Those are a director's screens — ESIS, terms, assigning teachers — and a
 * solo teacher has none of it. This is the part they need: a year, and one
 * group in it, which the API assigns them to as it creates it. Next year,
 * a new year and its group, and the children move up from last year's.
 *
 * Who may is the API's decision; anyone else who opens this URL is sent home.
 */
export default function MyGroupPage() {
  const { isLoading } = useSession();
  const kindergartenId = useSoloWorkspaceId();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !kindergartenId) router.replace("/");
  }, [isLoading, kindergartenId, router]);

  if (isLoading || !kindergartenId) return <LoadingState label="Ачаалж байна…" />;
  return <SoloWorkspace kindergartenId={kindergartenId} />;
}

function SoloWorkspace({ kindergartenId }: { kindergartenId: string }) {
  const years = useQuery({
    queryKey: [...KEY, "years", kindergartenId],
    queryFn: () => get(`/kindergartens/${kindergartenId}/school-years`, yearsSchema),
  });
  const groups = useQuery({
    queryKey: [...KEY, "groups", kindergartenId],
    queryFn: () => get(`/groups?kindergartenId=${kindergartenId}&page=1&pageSize=50`, groupsSchema),
  });

  if (years.isLoading || groups.isLoading) return <LoadingState rows={3} />;
  if (years.isError) return <ErrorState description={errorMessage(years.error)} />;
  if (groups.isError) return <ErrorState description={errorMessage(groups.error)} />;

  const allYears = years.data ?? [];
  const allGroups = groups.data?.items ?? [];
  const current = allYears.find((y) => y.isCurrent) ?? null;
  const currentGroup = current ? allGroups.find((g) => g.schoolYearId === current.id) : undefined;
  const earlier = allGroups.filter(
    (g) => g.schoolYearId !== current?.id && (g._count?.enrollments ?? 0) > 0,
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Бүлэг, хичээлийн жил" />
      <p className="text-body text-muted">
        Эхлээд хичээлийн жилээ, дараа нь тухайн жилийн бүлгээ үүсгэнэ. Нэг жилд нэг бүлэг.
      </p>

      <section className="flex flex-col gap-3" aria-labelledby="years-heading">
        <h2 id="years-heading" className="text-lead font-bold">
          Хичээлийн жил
        </h2>
        {allYears.length === 0 ? (
          <p className="text-body text-muted">
            Хичээлийн жил алга байна. Доороос эхний жилээ үүсгэнэ үү.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {allYears.map((year) => (
              <YearRow key={year.id} year={year} />
            ))}
          </ul>
        )}
        <NewYearForm kindergartenId={kindergartenId} years={allYears} />
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="group-heading">
        <h2 id="group-heading" className="text-lead font-bold">
          {current ? `${current.name} оны бүлэг` : "Бүлэг"}
        </h2>
        {!current ? (
          <p className="text-body text-muted">
            Бүлэг үүсгэхийн өмнө хичээлийн жилээ үүсгэж, «Одоогийн жил» болгоно уу.
          </p>
        ) : currentGroup ? (
          <>
            <GroupForm
              kindergartenId={kindergartenId}
              schoolYearId={current.id}
              group={currentGroup}
            />
            {earlier.map((from) => (
              <MoveUp key={from.id} from={from} to={currentGroup} />
            ))}
          </>
        ) : (
          <GroupForm kindergartenId={kindergartenId} schoolYearId={current.id} />
        )}
      </section>
    </div>
  );
}

function useRefresh() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: KEY });
    // The shell's and the dashboard's group (`useMyGroup`), and every roster.
    void queryClient.invalidateQueries({ queryKey: ["groups"] });
    void queryClient.invalidateQueries({ queryKey: ["children"] });
  };
}

function YearRow({ year }: { year: SchoolYear }) {
  const toast = useToast();
  const refresh = useRefresh();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(year.name);
  const [startsOn, setStartsOn] = useState(year.startsOn?.slice(0, 10) ?? "");
  const [endsOn, setEndsOn] = useState(year.endsOn?.slice(0, 10) ?? "");

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      mutate(`/school-years/${year.id}`, z.unknown(), { method: "PATCH", body }),
    onSuccess: () => {
      toast.success("Хичээлийн жил шинэчлэгдлээ.");
      setEditing(false);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const errors = fieldErrors(save.error);

  if (!editing) {
    return (
      <li className="flex flex-wrap items-center gap-2 rounded-card border border-border bg-surface p-3">
        <span className="font-semibold">{year.name}</span>
        <span className="text-caption text-muted">
          {shortDate(year.startsOn)} – {shortDate(year.endsOn)}
        </span>
        {year.isCurrent ? <Badge tone="mint">Одоогийн жил</Badge> : null}
        <span className="ml-auto flex gap-2">
          {!year.isCurrent ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={save.isPending}
              // Only ever `true`: the API moves the flag off the other year.
              onClick={() => save.mutate({ isCurrent: true })}
            >
              Одоогийн жил болгох
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            Засах
          </Button>
        </span>
      </li>
    );
  }

  return (
    <li className="rounded-card border border-border bg-surface p-3">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          if (!save.isPending) save.mutate({ name, startsOn, endsOn });
        }}
      >
        <YearFields
          name={name}
          startsOn={startsOn}
          endsOn={endsOn}
          errors={errors}
          onName={setName}
          onStartsOn={setStartsOn}
          onEndsOn={setEndsOn}
        />
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={save.isPending}>
            {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(false)}>
            Болих
          </Button>
        </div>
      </form>
    </li>
  );
}

function YearFields(props: {
  name: string;
  startsOn: string;
  endsOn: string;
  errors: Record<string, string | undefined>;
  onName: (v: string) => void;
  onStartsOn: (v: string) => void;
  onEndsOn: (v: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Нэр" error={props.errors.name} required>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            value={props.name}
            onChange={(e) => props.onName(e.target.value)}
          />
        )}
      </Field>
      <Field label="Эхлэх огноо" error={props.errors.startsOn} required>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            type="date"
            aria-describedby={describedBy}
            invalid={invalid}
            value={props.startsOn}
            onChange={(e) => props.onStartsOn(e.target.value)}
          />
        )}
      </Field>
      <Field label="Дуусах огноо" error={props.errors.endsOn} required>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            type="date"
            aria-describedby={describedBy}
            invalid={invalid}
            value={props.endsOn}
            onChange={(e) => props.onEndsOn(e.target.value)}
          />
        )}
      </Field>
    </div>
  );
}

function NewYearForm({ kindergartenId, years }: { kindergartenId: string; years: SchoolYear[] }) {
  const toast = useToast();
  const refresh = useRefresh();
  const suggestion = suggestedYear(years);
  const [open, setOpen] = useState(years.length === 0);
  const [name, setName] = useState(suggestion.name);
  const [startsOn, setStartsOn] = useState(suggestion.startsOn);
  const [endsOn, setEndsOn] = useState(suggestion.endsOn);
  const [isCurrent, setIsCurrent] = useState(true);

  const create = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/school-years`, z.unknown(), {
        method: "POST",
        body: { name, startsOn, endsOn, isCurrent },
      }),
    onSuccess: () => {
      toast.success("Хичээлийн жил үүслээ.");
      setOpen(false);
      refresh();
    },
  });
  const errors = fieldErrors(create.error);

  if (!open) {
    return (
      <div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            const next = suggestedYear(years);
            setName(next.name);
            setStartsOn(next.startsOn);
            setEndsOn(next.endsOn);
            setOpen(true);
          }}
        >
          Шинэ хичээлийн жил
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-3"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (!create.isPending) create.mutate();
      }}
    >
      <FormError message={create.isError ? errorMessage(create.error) : null} />
      <YearFields
        name={name}
        startsOn={startsOn}
        endsOn={endsOn}
        errors={errors}
        onName={setName}
        onStartsOn={setStartsOn}
        onEndsOn={setEndsOn}
      />
      <Checkbox
        label="Одоогийн жил"
        description="Ирц, хүүхдийн бүртгэл энэ жилийн бүлэгт хийгдэнэ."
        checked={isCurrent}
        onChange={(e) => setIsCurrent(e.target.checked)}
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={create.isPending}>
          {create.isPending ? "Үүсгэж байна…" : "Үүсгэх"}
        </Button>
        {years.length > 0 ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
            Болих
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function GroupForm({
  kindergartenId,
  schoolYearId,
  group,
}: {
  kindergartenId: string;
  schoolYearId: string;
  group?: Group;
}) {
  const toast = useToast();
  const refresh = useRefresh();
  const [name, setName] = useState(group?.name ?? "");
  const [ageBand, setAgeBand] = useState<string>(group?.ageBand ?? "MIDDLE");

  const save = useMutation({
    mutationFn: () =>
      group
        ? mutate(`/groups/${group.id}`, z.unknown(), {
            method: "PATCH",
            body: { name: name.trim(), ageBand },
          })
        : mutate(`/kindergartens/${kindergartenId}/groups`, z.unknown(), {
            method: "POST",
            body: { schoolYearId, name: name.trim(), ageBand },
          }),
    onSuccess: () => {
      toast.success(group ? "Бүлэг шинэчлэгдлээ." : "Бүлэг үүслээ.");
      refresh();
    },
  });
  const errors = fieldErrors(save.error);

  return (
    <form
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-3"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (!save.isPending) save.mutate();
      }}
    >
      <FormError message={save.isError ? errorMessage(save.error) : null} />
      {group ? (
        <p className="text-caption text-muted">
          {group._count?.enrollments ?? 0} хүүхэд бүртгэлтэй
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Бүлгийн нэр" error={errors.name} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              placeholder="Жишээ нь: Нарлаг бүлэг"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field label="Насны бүлэг" error={errors.ageBand} required>
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={ageBand}
              onChange={(e) => setAgeBand(e.target.value)}
            >
              {AGE_BANDS.map((band) => (
                <option key={band.value} value={band.value}>
                  {band.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div>
        <Button type="submit" size="sm" disabled={save.isPending || !name.trim()}>
          {save.isPending ? "Хадгалж байна…" : group ? "Хадгалах" : "Бүлэг үүсгэх"}
        </Button>
      </div>
    </form>
  );
}

/**
 * Last year's children into this year's group — `POST /groups/:id/promotions`,
 * which records whether each moved up or stayed a year from the age bands.
 */
function MoveUp({ from, to }: { from: Group; to: Group }) {
  const toast = useToast();
  const refresh = useRefresh();
  const count = from._count?.enrollments ?? 0;

  const move = useMutation({
    mutationFn: () =>
      mutate(`/groups/${from.id}/promotions`, z.unknown(), {
        method: "POST",
        body: { toGroupId: to.id },
      }),
    onSuccess: () => {
      toast.success(`${count} хүүхэд «${to.name}» бүлэгт шилжлээ.`);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-card border border-border bg-surface p-3">
      <p className="text-body">
        {from.schoolYear?.name ? `${from.schoolYear.name} оны ` : ""}«{from.name}» бүлэгт {count}{" "}
        хүүхэд байна.
      </p>
      <Button size="sm" disabled={move.isPending} onClick={() => move.mutate()}>
        {move.isPending ? "Шилжүүлж байна…" : `«${to.name}» бүлэгт шилжүүлэх`}
      </Button>
    </div>
  );
}
