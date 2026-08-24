"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { groupListItemSchema, paginated, SEX_LABEL, uuidSchema } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";

/**
 * Registering a child.
 *
 * ★ The screen that turns this from a demo into a product.
 *
 * `POST /kindergartens/:id/children` has existed since Phase 5 with nothing in
 * front of it, so a real kindergarten could not enrol a single child without
 * someone calling the API by hand. Phase 1 acceptance recorded that as a
 * deliberate gap; this closes it.
 *
 * Staff, not admin: the API authorizes with `assertStaff`, and a teacher
 * meeting a new family on their first morning is exactly who needs this.
 *
 * ★ The group is part of registration, not a later step.
 *
 * A child with no enrolment belongs to no group, so no teacher sees them on a
 * roster and no observation can be written about them — they are registered
 * and invisible. The API takes `groupId` on create and opens the enrolment in
 * the same call, so the form offers it here. It stays optional because a child
 * genuinely can arrive before their group is decided, and refusing the
 * registration until someone chooses would push staff into picking any group
 * to get past the form.
 *
 * The group list is whatever `GET /groups` returns for the caller, which is
 * already narrowed: a teacher sees only groups they are assigned to, an admin
 * sees every group in their kindergarten. Neither can enrol a child somewhere
 * they do not belong, and neither had to be told so here.
 */
const groupsSchema = paginated(groupListItemSchema);
const createdSchema = z.object({ id: uuidSchema });

export default function NewChildPage() {
  return (
    <RequireRole roles={["TEACHER", "ADMIN"]}>
      <NewChild />
    </RequireRole>
  );
}

function NewChild() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { primaryKindergartenId } = useSession();

  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [sex, setSex] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [healthNotes, setHealthNotes] = useState("");

  const groups = useQuery({
    queryKey: qk.adminGroups(),
    queryFn: () => get("/groups", groupsSchema),
  });

  const create = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${primaryKindergartenId}/children`, createdSchema, {
        method: "POST",
        body: {
          lastName: lastName.trim(),
          firstName: firstName.trim(),
          sex,
          dateOfBirth,
          // Omitted rather than sent empty: the register number has a format
          // rule, and "" fails it instead of meaning "not recorded yet".
          ...(nationalId.trim() ? { nationalId: nationalId.trim().toUpperCase() } : {}),
          ...(groupId ? { groupId } : {}),
          healthNotes: healthNotes.trim() || null,
        },
      }),
    onSuccess: (child) => {
      void queryClient.invalidateQueries({ queryKey: ["children"] });
      // Straight to the child, which is where the next thing always happens —
      // inviting the family, adding a photo, writing the first observation.
      router.push(`/children/${child.id}`);
    },
  });

  const errors = fieldErrors(create.error);
  const groupItems = groups.data?.items ?? [];

  return (
    <div className="flex flex-col gap-5 lg:gap-7">
      <PageHeader title="Хүүхэд бүртгэх" lede="Бүлэгт нэмбэл багш нар шууд харна." />

      <Card className="px-4 py-4 sm:px-5">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!create.isPending) create.mutate();
          }}
          className="flex flex-col gap-4"
          noValidate
        >
          <FormError
            message={
              create.isError && Object.keys(errors).length === 0 ? errorMessage(create.error) : null
            }
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Овог" error={errors.lastName} required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  autoFocus
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
                  <option value="">Сонгоно уу</option>
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

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Регистрийн дугаар"
              error={errors.nationalId}
              hint="Хоёр үсэг, найман орон. Жишээ: УБ12345678"
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

            <Field
              label="Бүлэг"
              error={errors.groupId}
              hint="Хожим ч нэмж болно, гэхдээ бүлэггүй хүүхэд бүртгэлд харагдахгүй."
            >
              {({ id, describedBy, invalid }) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                  disabled={groups.isLoading}
                >
                  <option value="">Сонгоогүй</option>
                  {groupItems.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <Field
            label="Эрүүл мэндийн тэмдэглэл"
            error={errors.healthNotes}
            hint="Багшийн мэдэх шаардлагатай зүйл байвал."
          >
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
            <Button type="button" variant="secondary" onClick={() => router.back()}>
              Болих
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Бүртгэж байна…" : "Бүртгэх"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
