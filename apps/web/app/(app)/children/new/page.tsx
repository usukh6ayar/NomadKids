"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Database } from "lucide-react";
import { z } from "zod";
import {
  esisStudentRegistrationTemplateSchema,
  groupListItemSchema,
  paginated,
  SEX_LABEL,
  uuidSchema,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
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
  /*
   * ★ Гадаад иргэн — 2026-09-04.
   *
   * `nationalId` is validated as two Cyrillic letters and eight digits, which
   * a foreign child cannot produce, so registering one meant leaving the field
   * blank with nothing on the record saying why. The checkbox swaps which
   * identifier the form asks for rather than adding a second one beside it:
   * a child has one, and showing both invites staff to fill in whichever is
   * nearest.
   */
  const [isForeign, setIsForeign] = useState(false);
  const [foreignId, setForeignId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [healthNotes, setHealthNotes] = useState("");
  const appliedEsis = useRef(false);

  const groups = useQuery({
    queryKey: qk.adminGroups(),
    queryFn: () => get("/groups", groupsSchema),
  });

  const esisTemplate = useQuery({
    queryKey: qk.esisStudentRegistration(primaryKindergartenId ?? "none"),
    queryFn: () =>
      get(
        `/kindergartens/${primaryKindergartenId}/esis/student-registration-template`,
        esisStudentRegistrationTemplateSchema,
      ),
    enabled: Boolean(primaryKindergartenId),
  });

  useEffect(() => {
    const row = esisTemplate.data?.row;
    if (!row || appliedEsis.current) return;

    appliedEsis.current = true;
    setLastName(row.lastName ?? "");
    setFirstName(row.firstName ?? "");
    setSex(row.genderCode === "M" ? "MALE" : row.genderCode === "F" ? "FEMALE" : "");
    setDateOfBirth(row.dateOfBirth ?? "");
  }, [esisTemplate.data]);

  useEffect(() => {
    const esisGroupName = esisTemplate.data?.row.studentGroupName;
    if (!esisGroupName || groupId || !groups.data) return;

    const normalized = esisGroupName.toLocaleLowerCase("mn-MN").replace(/\s*бүлэг$/, "");
    const matched = groups.data.items.find(
      (group) => group.name.toLocaleLowerCase("mn-MN").replace(/\s*бүлэг$/, "") === normalized,
    );
    if (matched) setGroupId(matched.id);
  }, [esisTemplate.data, groupId, groups.data]);

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
          /*
            ★ Only the identifier that matches the flag is sent.

            A form that has been toggled back and forth holds text in both
            boxes; sending both would put a регистр on a child marked foreign,
            and the roster's Регистр column would then contradict the flag
            beside it.
          */
          isForeign,
          ...(isForeign
            ? { foreignId: foreignId.trim() || null }
            : nationalId.trim()
              ? { nationalId: nationalId.trim().toUpperCase() }
              : {}),
          ...(groupId ? { groupId } : {}),
          healthNotes: healthNotes.trim() || null,
        },
      }),
    onSuccess: (child) => {
      void queryClient.invalidateQueries({ queryKey: ["children"] });
      // Straight to the child, which is where the next thing always happens —
      // inviting the family, adding a photo, writing the first observation.
      router.push(`/children/${child.id}/general`);
    },
  });

  const errors = fieldErrors(create.error);
  const groupItems = groups.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <PageHeader
        title="Хүүхэд бүртгэх"
        lede="ESIS суралцагчийн гаралтыг дотоод бүртгэлтэй тулгаж хадгална."
      />

      {esisTemplate.isError ? <FormError message={errorMessage(esisTemplate.error)} /> : null}
      {esisTemplate.data ? <EsisStudentOutput template={esisTemplate.data} /> : null}

      <Card pad="roomy">
        <SectionHeader
          title="Дотоод бүртгэлд хадгалах"
          lede="ESIS гаралтаас тохирох талбарууд автоматаар бөглөгдсөн."
          action={
            <Badge tone="mint">
              <CheckCircle2 size={13} aria-hidden />
              Тулгалт бэлэн
            </Badge>
          }
        />
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
            <Field label="Овог" hint="ESIS: lastName" error={errors.lastName} required>
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

            <Field label="Нэр" hint="ESIS: firstName" error={errors.firstName} required>
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
            <Field label="Хүйс" hint="ESIS: genderCode" error={errors.sex} required>
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

            <Field
              label="Төрсөн огноо"
              hint="ESIS: dateOfBirth"
              error={errors.dateOfBirth}
              required
            >
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

          <Checkbox
            label="Гадаад иргэн"
            description="Монгол регистрийн дугааргүй хүүхэд. Паспорт эсвэл оршин суух үнэмлэхийн дугаарыг бичнэ."
            checked={isForeign}
            onChange={(e) => setIsForeign(e.target.checked)}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            {isForeign ? (
              <Field
                label="Гадаад бичиг баримтын дугаар"
                error={errors.foreignId}
                hint="Паспорт, оршин суух үнэмлэх — хэлбэрийг шалгахгүй."
              >
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={foreignId}
                    onChange={(e) => setForeignId(e.target.value)}
                    placeholder="E01234567"
                  />
                )}
              </Field>
            ) : (
              <Field
                label="Регистрийн дугаар"
                error={errors.nationalId}
                hint="ESIS-ээс татахгүй; дотоод бүртгэлд шаардлагатай бол оруулна."
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
            )}

            <Field
              label="Бүлэг"
              error={errors.groupId}
              hint="ESIS: studentGroupId, studentGroupName"
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
            hint="ESIS-ээс татахгүй дотоод мэдээлэл."
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
              {create.isPending ? "Хадгалж байна…" : "Хадгалах"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function EsisStudentOutput({
  template,
}: {
  template: z.infer<typeof esisStudentRegistrationTemplateSchema>;
}) {
  return (
    <section aria-labelledby="esis-student-output-heading">
      <SectionHeader
        id="esis-student-output-heading"
        title="ESIS суралцагчийн гаралт"
        lede={`${template.slug} · ID ${template.apiId} · ${template.method} ${template.endpoint}`}
        action={
          <Badge tone="mint">
            <CheckCircle2 size={13} aria-hidden />
            {template.mode === "LIVE" ? "Бодит ESIS синк" : "Demo ESIS синк"}
          </Badge>
        }
      />
      <Card pad="roomy">
        <div className="flex items-start gap-3 border-b border-border-soft pb-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-control bg-sky text-sky-ink">
            <Database size={20} aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-ink">
              {template.row.lastName} {template.row.firstName}
            </p>
            <p className="mt-0.5 text-caption text-muted">
              personId {template.row.personId} · studentGroupId {template.row.studentGroupId} ·
              шинэчилсэн {template.syncedAt.slice(0, 16).replace("T", " ")}
            </p>
          </div>
        </div>

        <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Хөтөлбөр", template.row.programOfStudyName],
            ["Сургалтын төлөвлөгөө", template.row.programPlanName],
            ["Түвшин", template.row.academicLevelName],
            ["Суралцах төлөв", template.row.programStatusName],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-caption font-semibold text-muted">{label}</dt>
              <dd className="mt-1 break-words text-body font-medium text-ink">{value ?? "—"}</dd>
            </div>
          ))}
        </dl>

        <section
          className="mt-5 border-t border-border-soft pt-4"
          aria-label="ESIS гаралтын талбар"
        >
          <h3 className="text-body font-semibold text-primary">
            Бүх {template.fields.length} гаралтын талбар
          </h3>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {template.fields.map((field) => (
              <li key={field.name} className="rounded-row bg-sunken px-3 py-2">
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block text-caption text-muted">{field.label}</span>
                    <span className="mt-0.5 block break-words text-body font-medium text-ink">
                      {template.row[field.name] ??
                        (field.ingested ? "Утга ирээгүй" : "Хадгалахгүй (хамгаалсан талбар)")}
                    </span>
                  </span>
                  <Badge tone={field.ingested ? "mint" : "sun"}>
                    {field.ingested ? "Гаралт" : "Авахгүй"}
                  </Badge>
                </span>
                <span className="mt-1 block font-mono text-caption text-faint">{field.name}</span>
                {field.omitReason ? (
                  <span className="mt-1 block text-caption text-muted">{field.omitReason}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      </Card>
    </section>
  );
}
