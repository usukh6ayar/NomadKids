"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { useState } from "react";
import {
  esisInstitutionLookupSchema,
  platformAdminInvitedSchema,
  ROLE_LABEL,
  type EsisInstitutionLookup,
  type PlatformAdmin,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { formatRelative, fullName } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { cn } from "@/lib/utils";
import { InvitationHandover } from "@/components/admin/invitation-handover";

/**
 * Who administers this kindergarten, and the way to add one.
 *
 * ★ The gap this closes. `POST /kindergartens/:id/users` — what `/admin/users`
 * calls — is `@Roles("ADMIN")`, and a platform operator holds no membership,
 * so it answers them 404. Correct (CLAUDE.md §1.1), and it left one situation
 * with no route out inside the product: a kindergarten whose only director
 * cannot sign in, because the invitation was closed without being handed over,
 * or expired, or the person left. The answer was a shell on the server, which
 * is not an answer for somebody onboarding kindergartens.
 *
 * ★★ The list exists for `lastLoginAt`, not for the names.
 *
 * "Who administers this" is a question the operator can mostly guess. "Can
 * anybody actually get in" is the one they cannot, and a director who was
 * invited and never accepted looks identical to a working one in every other
 * column. That is exactly the tenant that needs a second invitation, so the
 * row says **Нэвтэрч байгаагүй** in as many words rather than leaving a date
 * column blank.
 *
 * ★★★ Adding one grants the operator nothing new. Registering a kindergarten
 * already creates its first ADMIN and hands them that invitation — this is the
 * same act at a later moment, and it writes the same kind of audit row.
 */
export function KindergartenAdmins({
  kindergartenId,
  esisInstitutionId,
  admins,
}: {
  kindergartenId: string;
  /** Null for a kindergarten registered by hand — see `AddAdminDialog`. */
  esisInstitutionId: string | null;
  admins: PlatformAdmin[];
}) {
  const [adding, setAdding] = useState(false);

  return (
    <section aria-labelledby="platform-admins-heading">
      <SectionHeader
        id="platform-admins-heading"
        title="Удирдлага"
        lede="Энэ цэцэрлэгийг удирдах эрхтэй хүмүүс. Багш, ажилтныг тэд өөрсдөө нэмнэ."
        action={
          <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
            <UserPlus size={18} aria-hidden />
            Удирдлага нэмэх
          </Button>
        }
      />

      <Card pad="roomy" className="shadow-sm">
        {admins.length === 0 ? (
          /*
           * Reachable, and the worst state there is: a tenant nobody can
           * administer. It should read as a problem to fix rather than as an
           * empty table.
           */
          <EmptyState
            title="Удирдлагагүй байна"
            description="Энэ цэцэрлэгт нэвтрэх эрхтэй хүн алга. Дээрх товчоор удирдлага нэмнэ үү."
          />
        ) : (
          <ul className="flex flex-col gap-2.5">
            {admins.map((admin) => (
              <li
                key={admin.id}
                className="flex min-h-[68px] flex-wrap items-center gap-x-3 gap-y-2 rounded-row border border-border-soft bg-sunken/50 px-3 py-2.5 sm:px-4"
              >
                <span
                  aria-hidden="true"
                  className="grid size-10 shrink-0 place-items-center rounded-control bg-primary-soft text-body font-bold text-primary"
                >
                  {admin.firstName.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-bold text-ink">
                    {fullName(admin)}
                  </span>
                  <span className="block truncate text-caption text-muted">
                    {admin.username}
                    {admin.email ? ` · ${admin.email}` : ""}
                  </span>
                </span>

                {admin.isActive ? null : <Badge>Идэвхгүй</Badge>}

                {admin.lastLoginAt ? (
                  <span className="shrink-0 text-caption text-muted">
                    Сүүлд нэвтэрсэн: {formatRelative(admin.lastLoginAt)}
                  </span>
                ) : (
                  <Badge tone="sun">Нэвтэрч байгаагүй</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {adding ? (
        <AddAdminDialog
          kindergartenId={kindergartenId}
          esisInstitutionId={esisInstitutionId}
          onClose={() => setAdding(false)}
        />
      ) : null}
    </section>
  );
}

/**
 * ★ On a mapped kindergarten the person is **chosen from its own ESIS staff
 * list**, never typed — client, 2026-09-19: "удирдлага нэмэх нь зөвхөн тэр
 * тухайн байгууллага дахь ажилчдаас сонгоно".
 *
 * Two things follow from that, and both matter. The operator cannot install
 * somebody the institution has never employed; and the name is saved with the
 * **ministry's own spelling**, which is what staff self-registration matches a
 * register number against later. `PlatformService.addAdmin` re-reads the list
 * server-side and refuses a `personId` that is not on it — this picker is a
 * convenience, not the check.
 *
 * ★★ A kindergarten with **no institution** keeps the typed fields. There is
 * no list to read, and refusing here would make a manually-registered tenant
 * whose only director cannot sign in unrescuable — the exact hole this dialog
 * was added to close. The copy says which case the operator is in rather than
 * leaving them to infer it from which fields appeared.
 */
function AddAdminDialog({
  kindergartenId,
  esisInstitutionId,
  onClose,
}: {
  kindergartenId: string;
  esisInstitutionId: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [personId, setPersonId] = useState<string | null>(null);

  const staff = useQuery({
    queryKey: ["platform", "esis-institution", esisInstitutionId],
    queryFn: () =>
      get(
        `/platform/esis/institutions/${encodeURIComponent(esisInstitutionId!)}`,
        esisInstitutionLookupSchema,
      ),
    enabled: Boolean(esisInstitutionId),
  });

  const choose = (person: EsisInstitutionLookup["staff"][number]) => {
    setPersonId(person.personId);
    // Shown so the operator sees what will be saved. The API overwrites both
    // from the ministry's answer anyway.
    setLastName(person.lastName);
    setFirstName(person.firstName);
  };

  const create = useMutation({
    mutationFn: () =>
      mutate(`/platform/kindergartens/${kindergartenId}/admins`, platformAdminInvitedSchema, {
        method: "POST",
        body: {
          username,
          lastName,
          firstName,
          email: email.trim() === "" ? null : email.trim(),
          phone: null,
          // Omitted entirely on an unmapped kindergarten: the API refuses a
          // `esisPersonId` it has no institution to verify against.
          ...(esisInstitutionId && personId ? { esisPersonId: personId } : {}),
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.platformKindergarten(kindergartenId) });
      void queryClient.invalidateQueries({ queryKey: qk.platformStats() });
    },
  });

  const errors = fieldErrors(create.error);

  if (create.isSuccess) {
    return (
      <FormDialog
        open
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
        title="Урилга бэлэн"
      >
        <InvitationHandover
          token={create.data.invitationToken}
          title="Урилга бэлэн"
          subtitle={`${fullName(create.data.user)} — Захирал/Эрхлэгч`}
          onClose={onClose}
        />
      </FormDialog>
    );
  }

  return (
    <FormDialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      busy={create.isPending}
      title="Удирдлага нэмэх"
      description="Нууц үг энд тавигдахгүй — тэр хүн урилгын холбоосоор орж өөрөө сонгоно."
      footer={
        <>
          <Button
            type="submit"
            form="add-admin-form"
            disabled={create.isPending || (Boolean(esisInstitutionId) && !personId)}
          >
            <UserPlus size={18} aria-hidden />
            {create.isPending ? "Үүсгэж байна…" : "Урилга үүсгэх"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose} disabled={create.isPending}>
            Болих
          </Button>
        </>
      }
    >
      <form
        id="add-admin-form"
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!create.isPending) create.mutate();
        }}
      >
        <FormError message={create.isError ? errorMessage(create.error) : null} />

        {esisInstitutionId ? (
          <fieldset className="rounded-card border border-border-soft p-2">
            <legend className="px-1 text-caption text-muted">
              ESIS-ийн ажилтны жагсаалт — институц {esisInstitutionId}
            </legend>

            {staff.isLoading ? <LoadingState rows={3} /> : null}
            {staff.isError ? <ErrorState description={errorMessage(staff.error)} /> : null}

            {staff.data && staff.data.staff.length === 0 ? (
              <p className="px-2 py-3 text-caption leading-relaxed text-muted">
                Энэ байгууллагад бүртгэлтэй ажилтан ESIS-ээс ирсэнгүй. Яамны бүртгэлээ шалгана уу.
              </p>
            ) : null}

            {staff.data && staff.data.staff.length > 0 ? (
              <div className="flex max-h-[260px] flex-col gap-0.5 overflow-y-auto">
                {staff.data.staff.map((person) => (
                  <label
                    key={person.personId}
                    className={cn(
                      "flex cursor-pointer items-start gap-2 rounded-control px-2 py-2 transition-colors",
                      personId === person.personId ? "bg-primary-soft" : "hover:bg-canvas",
                    )}
                  >
                    <input
                      type="radio"
                      name="esis-admin"
                      className="mt-1"
                      value={person.personId}
                      checked={personId === person.personId}
                      onChange={() => choose(person)}
                    />
                    <span className="min-w-0">
                      <span className="block text-body text-ink">{fullName(person)}</span>
                      <span className="block text-caption text-muted">
                        {[
                          person.positionName,
                          person.suggestedRole && ROLE_LABEL[person.suggestedRole],
                        ]
                          .filter(Boolean)
                          .join(" · ") || "Албан тушаал тодорхойгүй"}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            ) : null}
          </fieldset>
        ) : (
          <>
            <p className="rounded-control bg-sun px-3 py-2 text-caption leading-relaxed text-sun-ink">
              Энэ цэцэрлэг ESIS-д холбогдоогүй тул ажилтны жагсаалт алга. Нэрийг гараар бөглөнө үү.
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Овог" error={errors.lastName} required>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
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
                    onChange={(event) => setFirstName(event.target.value)}
                  />
                )}
              </Field>
            </div>
          </>
        )}

        <Field label="Нэвтрэх нэр" error={errors.username} hint="Латин үсэг, тоо, . _ -" required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoCapitalize="none"
            />
          )}
        </Field>

        <Field label="И-мэйл" error={errors.email} hint="Заавал биш.">
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              invalid={invalid}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoCapitalize="none"
            />
          )}
        </Field>
      </form>
    </FormDialog>
  );
}
