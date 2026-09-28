"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { MoreHorizontal, Plus, X } from "lucide-react";
import { z } from "zod";
import {
  adminUserSchema,
  methodUnionDetailSchema,
  methodUnionSchema,
  paginated,
  schoolYearSchema,
  type MethodUnion,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { fullName } from "@/lib/format";
import { useDebounced } from "@/lib/use-debounced";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { RowMenu } from "@/components/ui/menu";
import { Pagination } from "@/components/ui/pagination";
import { SearchField } from "@/components/ui/search-field";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";

const listSchema = paginated(methodUnionSchema);
const yearsSchema = z.array(schoolYearSchema);
const usersSchema = paginated(adminUserSchema);

const PAGE_SIZE = 20;

/** Every write on this screen refetches the list and any open union. */
const UNIONS_KEY = ["admin", "method-unions"] as const;

/** `2025-09-01` → `2025.09.01`. */
function shortDate(value: string | null): string {
  return value ? value.replaceAll("-", ".") : "—";
}

/**
 * «Заах аргын нэгдэл» — teaching-method unions, a section of Байгууллага
 * (the client's 2026-09-25 drawing), administrator only.
 *
 * ★ The lead and the members are chosen from this kindergarten's **active
 * teachers** — the API refuses anybody else with 400, so the pickers offer
 * nothing else rather than letting a director pick and be told off.
 */
type Dialog =
  | { kind: "create" }
  | { kind: "edit"; union: MethodUnion }
  | { kind: "members"; union: MethodUnion }
  | { kind: "delete"; union: MethodUnion }
  | null;

export function MethodUnions({ kindergartenId: kg }: { kindergartenId: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [typed, setTyped] = useState("");
  const search = useDebounced(typed.trim());
  const [yearId, setYearId] = useState("");
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
  if (search) params.set("q", search);
  if (yearId) params.set("schoolYearId", yearId);

  const unions = useQuery({
    queryKey: [...UNIONS_KEY, kg, search, yearId, page],
    queryFn: () => get(`/kindergartens/${kg}/method-unions?${params}`, listSchema),
  });
  const years = useSchoolYears(kg);

  const remove = useMutation({
    mutationFn: (id: string) => mutate(`/method-unions/${id}`, z.unknown(), { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Нэгдэл устгагдлаа.");
      setDialog(null);
      void queryClient.invalidateQueries({ queryKey: UNIONS_KEY });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const data = unions.data;

  return (
    <div className="flex flex-col gap-4 rounded-card border border-border-soft bg-surface p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-display font-bold leading-heading text-ink">Заах аргын нэгдэл</h1>
          <p className="mt-1 text-body text-muted">
            Нэгдэл, түүний ахлагч болон гишүүн багш нарыг удирдана.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setDialog({ kind: "create" })}>
            <Plus size={16} aria-hidden /> Нэгдэл нэмэх
          </Button>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-[220px_minmax(0,1fr)]">
        <Select
          aria-label="Хичээлийн жил"
          value={yearId}
          onChange={(event) => {
            setYearId(event.target.value);
            setPage(1);
          }}
        >
          <option value="">Бүх хичээлийн жил</option>
          {(years.data ?? []).map((year) => (
            <option key={year.id} value={year.id}>
              {year.name}
            </option>
          ))}
        </Select>
        <SearchField
          label="Нэгдлийн нэрээр хайх"
          placeholder="Нэгдлийн нэрээр хайх..."
          value={typed}
          onChange={(value) => {
            setTyped(value);
            setPage(1);
          }}
        />
      </div>

      {data ? (
        <p className="text-caption text-muted" aria-live="polite">
          Нийт: {data.total}
        </p>
      ) : null}

      {unions.isLoading ? <LoadingState rows={4} /> : null}
      {unions.isError ? <ErrorState description={errorMessage(unions.error)} /> : null}

      {data && data.items.length === 0 ? (
        <EmptyState
          title={search || yearId ? "Нэгдэл олдсонгүй" : "Нэгдэл бүртгэгдээгүй байна"}
          description={
            search || yearId
              ? "Шүүлтүүр эсвэл хайлтаа өөрчилж үзнэ үү."
              : "«Нэгдэл нэмэх»-ээр нэгдэл үүсгээд, багш нараа гишүүнээр нэмнэ үү."
          }
        />
      ) : null}

      {data && data.items.length > 0 ? (
        <div className="overflow-x-auto rounded-card border border-border bg-surface">
          <table className="w-full border-collapse text-body">
            <caption className="sr-only">Заах аргын нэгдлийн жагсаалт</caption>
            <thead>
              <tr>
                <Th className="w-12 py-2">№</Th>
                <Th className="py-2">Заах аргын нэгдлийн нэр</Th>
                <Th className="py-2">Ахлагч багш</Th>
                <Th className="py-2">Багшийн тоо</Th>
                <Th className="py-2">Хичээлийн жил</Th>
                <Th className="w-12 py-2">
                  <span className="sr-only">Үйлдэл</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((union, index) => (
                <tr key={union.id} className="hover:bg-sunken/60">
                  <Td className="py-1.5 tabular-nums text-muted">
                    {(page - 1) * PAGE_SIZE + index + 1}
                  </Td>
                  <Td className="py-1.5">
                    <button
                      type="button"
                      onClick={() => setDialog({ kind: "members", union })}
                      className="text-left font-medium text-ink hover:text-primary hover:underline"
                    >
                      {union.name}
                    </button>
                  </Td>
                  <Td className="py-1.5 text-muted">{union.lead ? fullName(union.lead) : "—"}</Td>
                  <Td className="py-1.5 tabular-nums text-muted">{union.memberCount}</Td>
                  <Td className="py-1.5 text-muted">
                    {union.schoolYear.name}
                    <span className="block text-caption tabular-nums text-faint">
                      {shortDate(union.startsOn)} – {union.endsOn ? shortDate(union.endsOn) : "…"}
                    </span>
                  </Td>
                  <Td className="py-1 text-right">
                    <RowMenu
                      ariaLabel={`${union.name} — үйлдэл`}
                      triggerIcon={<MoreHorizontal size={18} aria-hidden="true" />}
                      items={[
                        { label: "Гишүүд", onSelect: () => setDialog({ kind: "members", union }) },
                        { label: "Засах", onSelect: () => setDialog({ kind: "edit", union }) },
                        {
                          label: "Устгах",
                          tone: "danger",
                          separated: true,
                          onSelect: () => setDialog({ kind: "delete", union }),
                        },
                      ]}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {data ? <Pagination page={page} totalPages={data.totalPages} onPage={setPage} /> : null}

      {dialog?.kind === "create" || dialog?.kind === "edit" ? (
        <UnionFormDialog
          kindergartenId={kg}
          union={dialog.kind === "edit" ? dialog.union : null}
          onClose={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === "members" ? (
        <MembersDialog kindergartenId={kg} union={dialog.union} onClose={() => setDialog(null)} />
      ) : null}

      <ConfirmDialog
        open={dialog?.kind === "delete"}
        onOpenChange={(next) => (next ? undefined : setDialog(null))}
        title="Энэ нэгдлийг устгах уу?"
        description={dialog?.kind === "delete" ? dialog.union.name : ""}
        confirmLabel="Устгах"
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => (dialog?.kind === "delete" ? remove.mutate(dialog.union.id) : undefined)}
      />
    </div>
  );
}

function useSchoolYears(kindergartenId: string | null | undefined) {
  return useQuery({
    queryKey: ["admin", "school-years", kindergartenId],
    queryFn: () => get(`/kindergartens/${kindergartenId}/school-years`, yearsSchema),
    enabled: Boolean(kindergartenId),
    staleTime: 60_000,
  });
}

/**
 * This kindergarten's active teachers, as memberships — what a union's lead
 * and members are. A kindergarten has far fewer than a hundred.
 */
function useTeachers(kindergartenId: string) {
  return useQuery({
    queryKey: ["admin", "users", { kindergartenId, role: "TEACHER" }],
    queryFn: () =>
      get(
        `/users?kindergartenId=${kindergartenId}&role=TEACHER&isActive=true&pageSize=100`,
        usersSchema,
      ),
    select: (page) =>
      page.items.flatMap((user) =>
        user.memberships
          .filter(
            (m) =>
              m.kindergartenId === kindergartenId && m.role === "TEACHER" && m.isActive !== false,
          )
          .map((m) => ({ membershipId: m.id, name: fullName(user) })),
      ),
    staleTime: 60_000,
  });
}

function UnionFormDialog({
  kindergartenId,
  union,
  onClose,
}: {
  kindergartenId: string;
  union: MethodUnion | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const years = useSchoolYears(kindergartenId);
  const teachers = useTeachers(kindergartenId);
  const currentYear = (years.data ?? []).find((year) => year.isCurrent);

  const [name, setName] = useState(union?.name ?? "");
  const [schoolYearId, setSchoolYearId] = useState(union?.schoolYear.id ?? "");
  const [leadMembershipId, setLead] = useState(union?.lead?.membershipId ?? "");
  const [startsOn, setStartsOn] = useState(union?.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(union?.endsOn ?? "");
  // A new union defaults to the current year once the years have loaded.
  const yearValue = schoolYearId || (union ? "" : (currentYear?.id ?? ""));

  const save = useMutation({
    mutationFn: () =>
      mutate(
        union ? `/method-unions/${union.id}` : `/kindergartens/${kindergartenId}/method-unions`,
        z.unknown(),
        {
          method: union ? "PATCH" : "POST",
          body: {
            name,
            schoolYearId: yearValue,
            leadMembershipId: leadMembershipId || null,
            startsOn,
            endsOn: endsOn || null,
          },
        },
      ),
    onSuccess: () => {
      toast.success(union ? "Нэгдэл хадгалагдлаа." : "Нэгдэл үүслээ.");
      void queryClient.invalidateQueries({ queryKey: UNIONS_KEY });
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const errors = fieldErrors(save.error);

  return (
    <FormDialog
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={union ? "Нэгдэл засах" : "Нэгдэл нэмэх"}
      busy={save.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Болих
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormError message={save.isError ? errorMessage(save.error) : null} />
        <Field label="Нэр" error={errors.name} required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Жишээ: Хэл ярианы нэгдэл"
              autoFocus
            />
          )}
        </Field>
        <Field label="Хичээлийн жил" error={errors.schoolYearId} required>
          {({ id, describedBy, invalid }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={yearValue}
              onChange={(event) => setSchoolYearId(event.target.value)}
            >
              <option value="">Сонгох</option>
              {(years.data ?? []).map((year) => (
                <option key={year.id} value={year.id}>
                  {year.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Ахлагч" error={errors.leadMembershipId}>
          {({ id, describedBy, invalid }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={leadMembershipId}
              onChange={(event) => setLead(event.target.value)}
            >
              <option value="">Ахлагчгүй</option>
              {(teachers.data ?? []).map((teacher) => (
                <option key={teacher.membershipId} value={teacher.membershipId}>
                  {teacher.name}
                </option>
              ))}
            </Select>
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
                onChange={(event) => setStartsOn(event.target.value)}
              />
            )}
          </Field>
          <Field label="Дуусах" error={errors.endsOn}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                type="date"
                value={endsOn}
                onChange={(event) => setEndsOn(event.target.value)}
              />
            )}
          </Field>
        </div>
      </div>
    </FormDialog>
  );
}

function MembersDialog({
  kindergartenId,
  union,
  onClose,
}: {
  kindergartenId: string;
  union: MethodUnion;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const teachers = useTeachers(kindergartenId);
  const [picked, setPicked] = useState("");
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);

  const detail = useQuery({
    queryKey: [...UNIONS_KEY, "detail", union.id],
    queryFn: () => get(`/method-unions/${union.id}`, methodUnionDetailSchema),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: UNIONS_KEY });

  const add = useMutation({
    mutationFn: (membershipId: string) =>
      mutate(`/method-unions/${union.id}/members`, z.unknown(), {
        method: "POST",
        body: { membershipId },
      }),
    onSuccess: () => {
      toast.success("Гишүүн нэмэгдлээ.");
      setPicked("");
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (seatId: string) =>
      mutate(`/method-union-members/${seatId}`, z.unknown(), { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Гишүүн хасагдлаа.");
      setRemoving(null);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const members = detail.data?.members ?? [];
  const seated = new Set(members.map((member) => member.membershipId));
  const candidates = (teachers.data ?? []).filter((t) => !seated.has(t.membershipId));

  return (
    <FormDialog
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title={union.name}
      description={union.lead ? `Ахлагч: ${fullName(union.lead)}` : "Ахлагч сонгоогүй"}
      footer={
        <Button variant="ghost" onClick={onClose}>
          Хаах
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-end gap-2">
          <Field label="Багш нэмэх" className="min-w-0 flex-1">
            {({ id }) => (
              <Select id={id} value={picked} onChange={(event) => setPicked(event.target.value)}>
                <option value="">Багш сонгох</option>
                {candidates.map((teacher) => (
                  <option key={teacher.membershipId} value={teacher.membershipId}>
                    {teacher.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button onClick={() => add.mutate(picked)} disabled={!picked || add.isPending}>
            <Plus size={16} aria-hidden /> Нэмэх
          </Button>
        </div>

        {detail.isLoading ? <LoadingState rows={2} /> : null}
        {detail.isError ? <ErrorState description={errorMessage(detail.error)} /> : null}
        {detail.data && members.length === 0 ? (
          <p className="text-body text-muted">
            Гишүүн алга. Дээрээс багш сонгоод «Нэмэх» дарна уу.
          </p>
        ) : null}
        {members.length > 0 ? (
          <ul aria-label="Нэгдлийн гишүүд" className="flex flex-col divide-y divide-border-soft">
            {members.map((member) => (
              <li key={member.id} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate text-body text-ink">
                  {fullName(member)}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`${fullName(member)}-г хасах`}
                  onClick={() => setRemoving({ id: member.id, name: fullName(member) })}
                >
                  <X size={16} aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => (next ? undefined : setRemoving(null))}
        title="Гишүүнийг хасах уу?"
        description={removing?.name ?? ""}
        confirmLabel="Хасах"
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => (removing ? remove.mutate(removing.id) : undefined)}
      />
    </FormDialog>
  );
}
