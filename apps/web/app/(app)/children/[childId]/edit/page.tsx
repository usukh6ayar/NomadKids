"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { childDetailSchema, groupListItemSchema, paginated } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
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
    <div className="flex flex-col gap-5 lg:gap-7">
      <PageHeader
        title="Хүүхдийн мэдээлэл засах"
        lede={`${child.data!.lastName} ${child.data!.firstName}`}
      />

      <DetailsForm childId={childId} child={child.data!} />
      <TransferCard childId={childId} />
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
  const router = useRouter();
  const queryClient = useQueryClient();

  const [lastName, setLastName] = useState(child.lastName);
  const [firstName, setFirstName] = useState(child.firstName);
  const [sex, setSex] = useState(child.sex ?? "");
  // `<input type="date">` needs YYYY-MM-DD; the API sends a full ISO string.
  const [dateOfBirth, setDateOfBirth] = useState((child.dateOfBirth ?? "").slice(0, 10));
  const [nationalId, setNationalId] = useState(child.nationalId ?? "");
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
          healthNotes: healthNotes.trim() || null,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.child(childId) });
      void queryClient.invalidateQueries({ queryKey: ["children"] });
    },
  });

  const errors = fieldErrors(save.error);

  return (
    <section aria-labelledby="details-heading">
      <SectionHeader title="Хувийн мэдээлэл" />

      <Card className="px-4 py-4 sm:px-5">
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
            <p role="status" className="rounded-[12px] bg-mint px-3.5 py-2.5 text-sm text-mint-ink">
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
                  <option value="MALE">Хүү</option>
                  <option value="FEMALE">Охин</option>
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
              onClick={() => router.push(`/children/${childId}`)}
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
      void queryClient.invalidateQueries({ queryKey: qk.child(childId) });
      void queryClient.invalidateQueries({ queryKey: ["children"] });
      setGroupId("");
    },
  });

  // Teachers are not shown this at all: the endpoint resolves the target group
  // through the actor's *admin* kindergartens, so for them it can only fail.
  if (!hasRole("ADMIN")) return null;

  const items = groups.data?.items ?? [];

  return (
    <section aria-labelledby="transfer-heading">
      <SectionHeader
        title="Бүлэг шилжүүлэх"
        lede="Одоогийн бүртгэл автоматаар хаагдаж, шинэ бүлэгт нээгдэнэ."
      />

      <Card className="px-4 py-4 sm:px-5">
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
            <p role="status" className="rounded-[12px] bg-mint px-3.5 py-2.5 text-sm text-mint-ink">
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
        title="Архивлах"
        lede="Хүүхэд жагсаалтад харагдахаа болино. Бүртгэл нь устахгүй."
      />

      <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
        <p className="text-sm text-muted">
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
