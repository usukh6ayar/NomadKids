"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import {
  childDetailSchema,
  childStatusSchema,
  groupListItemSchema,
  paginated,
  CHILD_STATUS_LABEL,
  SEX_LABEL,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { PageHeader } from "@/components/shell/app-shell";
import { ArchiveButton } from "@/components/ui/archive-button";
import { RequireRole } from "@/components/shell/require-role";

/**
 * Correcting a child's record, and moving them between groups.
 *
 * Two operations on one screen because they are one errand — a child's details
 * are wrong, or they have changed group, and either way a member of staff is
 * looking at that child. They are separate forms rather than one, because they
 * are separate endpoints with different authority and one save button over both
 * would imply a transaction that does not exist.
 *
 * ★ Who may do which is not the same.
 *
 * `PATCH /children/:id` runs `assertCanRecord`, so a teacher may correct a
 * child they teach. `POST /children/:id/enrollments` resolves the target group
 * through `adminKindergartenIds`, so **only an admin can move a child** — a
 * teacher would get "Бүлэг олдсонгүй" from an endpoint that looks like it
 * should work. Rather than let them meet that, the transfer card is not
 * rendered for them.
 *
 * ★ Archiving is here, but last and behind a confirmation.
 *
 * `DELETE /children/:id` is ADMIN-only and soft — it sets `deletedAt`, so the
 * child stops appearing and the record survives. It sits at the foot of the
 * page rather than beside "Хадгалах", because a destructive action next to a
 * typo fix is a mis-click waiting to happen.
 */
const groupsSchema = paginated(groupListItemSchema);

/**
 * A child's standing — Order А/261, Annex 2 §1 item 7, mandatory.
 *
 * ★ The column existed and no screen ever set it.
 *
 * `updateChildSchema` has accepted `status` since the schema was written, so
 * every child in the database sat at the default because there was nowhere to
 * change it. The order asks for four states to be *registered*, which means a
 * control, not a column.
 *
 * ★★ Not admin-only, though the order lists it under the director's portal.
 *
 * `PATCH /children/:id` is `@Roles("ADMIN", "TEACHER")` and this is one field
 * on a form both roles already use. A teacher marking a child чөлөөтэй is the
 * same act as recording an EXCUSED day on the register, which they do daily.
 * Carving one field out of a shared form would be a new authorization concept
 * that no requirement asks for.
 */
const CHILD_STATUSES = childStatusSchema.options;

export default function EditChildPage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <EditChild />
    </RequireRole>
  );
}

function EditChild() {
  const params = useParams<{ childId: string }>();
  const childId = params.childId;

  const child = useQuery({
    queryKey: qk.child(childId),
    queryFn: () => get(`/children/${childId}`, childDetailSchema),
    enabled: Boolean(childId),
  });

  if (child.isLoading) return <LoadingState rows={4} />;
  if (child.isError) return <ErrorState description={errorMessage(child.error)} />;

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <PageHeader
        title="Хүүхдийн мэдээлэл засах"
        lede={`${child.data!.lastName} ${child.data!.firstName}`}
      />

      <DetailsForm childId={childId} child={child.data!} />
      <TransferCard childId={childId} />
      <GraduateCard childId={childId} child={child.data!} />
      <ArchiveCard
        childId={childId}
        childName={`${child.data!.lastName} ${child.data!.firstName}`}
      />
    </div>
  );
}

// ── Details ──────────────────────────────────────────────────────────────────

function DetailsForm({
  childId,
  child,
}: {
  childId: string;
  child: z.infer<typeof childDetailSchema>;
}) {
  const toast = useToast();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [lastName, setLastName] = useState(child.lastName);
  const [firstName, setFirstName] = useState(child.firstName);
  const [sex, setSex] = useState(child.sex ?? "");
  // `<input type="date">` needs YYYY-MM-DD; the API sends a full ISO string.
  const [dateOfBirth, setDateOfBirth] = useState((child.dateOfBirth ?? "").slice(0, 10));
  const [nationalId, setNationalId] = useState(child.nationalId ?? "");
  const [status, setStatus] = useState<string>(child.status ?? "ACTIVE");
  const [healthNotes, setHealthNotes] = useState(child.healthNotes ?? "");

  const save = useMutation({
    mutationFn: () =>
      mutate(`/children/${childId}`, childDetailSchema, {
        method: "PATCH",
        body: {
          lastName: lastName.trim(),
          firstName: firstName.trim(),
          sex,
          dateOfBirth,
          // null clears it; "" would fail the two-letters-eight-digits rule.
          nationalId: nationalId.trim() ? nationalId.trim().toUpperCase() : null,
          status,
          healthNotes: healthNotes.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success("Хүүхдийн мэдээлэл хадгалагдлаа.");
      void queryClient.invalidateQueries({ queryKey: qk.child(childId) });
      void queryClient.invalidateQueries({ queryKey: ["children"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const errors = fieldErrors(save.error);

  return (
    <section aria-labelledby="details-heading">
      <SectionHeader id="details-heading" title="Хувийн мэдээлэл" />

      <Card pad="roomy">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!save.isPending) save.mutate();
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <FormError
            message={
              save.isError && Object.keys(errors).length === 0 ? errorMessage(save.error) : null
            }
          />

          {save.isSuccess ? (
            <p
              role="status"
              className="rounded-control bg-mint px-3.5 py-2.5 text-body text-mint-ink"
            >
              Хадгалагдлаа.
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Овог" error={errors.lastName} required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              )}
            </Field>

            <Field label="Нэр" error={errors.firstName} required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              )}
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Хүйс" error={errors.sex} required>
              {({ id, describedBy, invalid }) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={sex}
                  onChange={(e) => setSex(e.target.value)}
                >
                  <option value="MALE">{SEX_LABEL.MALE}</option>
                  <option value="FEMALE">{SEX_LABEL.FEMALE}</option>
                </Select>
              )}
            </Field>

            <Field label="Төрсөн огноо" error={errors.dateOfBirth} required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  type="date"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                />
              )}
            </Field>
          </div>

          <Field
            label="Регистрийн дугаар"
            error={errors.nationalId}
            hint="Хоёр үсэг, найман орон. Хоосон орхивол устгана."
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={nationalId}
                onChange={(e) => setNationalId(e.target.value)}
                placeholder="УБ12345678"
              />
            )}
          </Field>

          <Field label="Суралцах төлөв" error={errors.status} required>
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {CHILD_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {CHILD_STATUS_LABEL[value]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Эрүүл мэндийн тэмдэглэл" error={errors.healthNotes}>
            {({ id, describedBy, invalid }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                rows={3}
                value={healthNotes}
                onChange={(e) => setHealthNotes(e.target.value)}
              />
            )}
          </Field>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => router.push(`/children/${childId}/general`)}
            >
              Буцах
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
            </Button>
          </div>
        </form>
      </Card>
    </section>
  );
}

// ── Group transfer ───────────────────────────────────────────────────────────

/**
 * Moving a child to another group.
 *
 * One call. `POST /children/:id/enrollments` ends the child's current ACTIVE
 * enrolment in the same school year as TRANSFERRED and opens the new one, in a
 * single transaction — so this screen must not try to close the old one first,
 * and there is nothing to undo halfway.
 */
function TransferCard({ childId }: { childId: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { hasRole } = useSession();
  const [groupId, setGroupId] = useState("");

  const groups = useQuery({
    queryKey: qk.adminGroups(),
    queryFn: () => get("/groups", groupsSchema),
    enabled: hasRole("ADMIN"),
  });

  const move = useMutation({
    mutationFn: () =>
      mutate(`/children/${childId}/enrollments`, z.unknown(), {
        method: "POST",
        body: { groupId },
      }),
    onSuccess: () => {
      toast.success("Бүлэг шилжүүллээ.");
      void queryClient.invalidateQueries({ queryKey: qk.child(childId) });
      void queryClient.invalidateQueries({ queryKey: ["children"] });
      setGroupId("");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  // Teachers are not shown this at all: the endpoint resolves the target group
  // through the actor's *admin* kindergartens, so for them it can only fail.
  if (!hasRole("ADMIN")) return null;

  const items = groups.data?.items ?? [];

  return (
    <section aria-labelledby="transfer-heading">
      <SectionHeader
        id="transfer-heading"
        title="Бүлэг шилжүүлэх"
        lede="Одоогийн бүртгэл автоматаар хаагдаж, шинэ бүлэгт нээгдэнэ."
      />

      <Card pad="roomy">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (groupId && !move.isPending) move.mutate();
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <FormError message={move.isError ? errorMessage(move.error) : null} />

          {move.isSuccess ? (
            <p
              role="status"
              className="rounded-control bg-mint px-3.5 py-2.5 text-body text-mint-ink"
            >
              Шилжүүллээ.
            </p>
          ) : null}

          <Field label="Шинэ бүлэг">
            {({ id, describedBy, invalid }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
                disabled={groups.isLoading}
              >
                <option value="">Сонгоно уу</option>
                {items.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <div className="flex justify-end">
            <Button type="submit" variant="secondary" disabled={!groupId || move.isPending}>
              {move.isPending ? "Шилжүүлж байна…" : "Шилжүүлэх"}
            </Button>
          </div>
        </form>
      </Card>
    </section>
  );
}

// ── Graduation ───────────────────────────────────────────────────────────────

/**
 * Recording that a child completed the programme.
 *
 * ★ `GRADUATED` is a status distinct from `ENDED`/`TRANSFERRED` — added so a
 * parent-facing "Цэцэрлэгээс төгссөн" date (the portfolio-style overview page)
 * can show a real fact instead of reusing the generic "this enrollment period
 * is over", which would also read as true for a withdrawal or a move to
 * another kindergarten. `PATCH /enrollments/:id` is the same endpoint
 * `TransferCard`'s "Бүлэг шилжүүлэх" sits beside — ADMIN-only, and it stamps
 * `endedOn` itself, so this screen sends only the status.
 *
 * Renders nothing once the child's current enrollment is already graduated,
 * or when there is no ACTIVE enrollment to graduate — the same "no dead
 * action" reasoning as `ArchiveButton` for an already-archived child.
 */
function GraduateCard({
  childId,
  child,
}: {
  childId: string;
  child: z.infer<typeof childDetailSchema>;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { hasRole } = useSession();
  const [confirming, setConfirming] = useState(false);

  const active = (child.enrollments ?? []).find((e) => e.status === "ACTIVE");

  const graduate = useMutation({
    mutationFn: () =>
      mutate(`/enrollments/${active!.id}`, z.unknown(), {
        method: "PATCH",
        body: { status: "GRADUATED" },
      }),
    onSuccess: () => {
      toast.success("Төгсгөлөө.");
      void queryClient.invalidateQueries({ queryKey: qk.child(childId) });
      void queryClient.invalidateQueries({ queryKey: ["children"] });
      setConfirming(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!hasRole("ADMIN") || !active) return null;

  return (
    <section aria-labelledby="graduate-heading">
      <SectionHeader
        id="graduate-heading"
        title="Төгсөлт"
        lede="Хүүхэд цэцэрлэгийн хөтөлбөрийг дүүргэж төгссөнийг тэмдэглэнэ."
      />

      <Card pad="roomy" className="flex flex-col gap-4">
        <FormError message={graduate.isError ? errorMessage(graduate.error) : null} />

        {graduate.isSuccess ? (
          <p
            role="status"
            className="rounded-control bg-mint px-3.5 py-2.5 text-body text-mint-ink"
          >
            Төгссөнөөр тэмдэглэлээ.
          </p>
        ) : confirming ? (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-body text-ink">Одоогийн бүртгэлийг төгссөнөөр хаах уу?</p>
            <div className="ml-auto flex gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setConfirming(false)}
                disabled={graduate.isPending}
              >
                Болих
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => graduate.mutate()}
                disabled={graduate.isPending}
              >
                {graduate.isPending ? "Тэмдэглэж байна…" : "Тийм, төгссөн"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end">
            <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>
              Төгссөнөөр тэмдэглэх
            </Button>
          </div>
        )}
      </Card>
    </section>
  );
}

// ── Archiving ────────────────────────────────────────────────────────────────

/**
 * Archiving the child.
 *
 * Admin only, mirroring the endpoint: `DELETE /children/:id` carries
 * `@Roles("ADMIN")`, so offering it to a teacher would be offering a 404.
 */
function ArchiveCard({ childId, childName }: { childId: string; childName: string }) {
  const { hasRole } = useSession();
  if (!hasRole("ADMIN")) return null;

  return (
    <section aria-labelledby="archive-heading">
      <SectionHeader
        id="archive-heading"
        title="Архивлах"
        lede="Хүүхэд жагсаалтад харагдахаа болино. Бүртгэл нь устахгүй."
      />

      <Card pad="roomy" className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body text-muted">
          Цэцэрлэгээс гарсан хүүхдийг архивлана. Ажиглалт, үнэлгээ нь хадгалагдана.
        </p>
        <ArchiveButton
          path={`/children/${childId}`}
          label="Архивлах"
          confirmation={`${childName} — архивлах уу? Хүүхэд жагсаалтад харагдахаа болино.`}
          invalidate={[["children"], ["child", childId]]}
          redirectTo="/children"
        />
      </Card>
    </section>
  );
}
