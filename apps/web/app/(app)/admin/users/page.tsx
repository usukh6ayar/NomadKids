"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { UserPlus } from "lucide-react";
import { ASSIGNABLE_ROLES, ROLE_LABEL, invitedUserSchema, type Role } from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormError } from "@/components/ui/states";
import { Tabs, TabButton } from "@/components/ui/tabs";
import { EsisDataPanel } from "@/components/esis/esis-data-panel";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { InvitationHandover } from "@/components/admin/invitation-handover";
import { useBackdropDismiss } from "@/components/ui/modal-overlay";
import { StaffDirectory } from "@/components/admin/staff/staff-directory";
import type { StaffDirectoryRow } from "@/components/admin/staff/staff-model";

const ROLES: { value: Role; label: string }[] = ASSIGNABLE_ROLES.map((value) => ({
  value,
  label: ROLE_LABEL[value],
}));

/**
 * Багш, ажилтан — the staff directory.
 *
 * ★ **Renamed from "Хэрэглэгчид" and rebuilt, 2026-09-23.** What stood here
 * was an accurate description of the data and a poor description of the job:
 * the kindergarten's own accounts, then ESIS `teacher/list`, then ESIS
 * `school/staff`, then `teacherMovements`, then two мэргэшлийн зэрэг services,
 * each as a full-width panel of ministry field names. Six sections, five
 * outbound requests on first paint, and a person who works here appearing on
 * as many as three of them.
 *
 * The directory below merges those *concepts* — one row per person, joined on
 * `esisPersonId` — without merging the sources. `StaffDirectory` explains the
 * join; `staff-model.ts` is where it lives and is a pure function, so the
 * dedupe and the group-assignment rules are testable without a screen.
 *
 * ★★ **The raw panels are not deleted**, they are behind the second tab.
 * Reconciling our records against the ministry's is a real task and those
 * tables are how it is done — but it is not the task a director opens this
 * screen for, and it is not one they should pay five ministry requests for on
 * the way to finding a teacher's phone number. The tab renders nothing until
 * it is selected, so nothing is fetched until it is.
 *
 * ★★★ Creating a user here never sets a password. The API generates 32 random
 * bytes nobody sees and returns an invitation token; the person chooses their
 * own password on `/invitation/[token]`. An administrator who types a password
 * for someone else knows that password, and "temporary" credentials are
 * permanent in practice.
 */
export default function AdminUsersPage() {
  return (
    <RequireRole roles={["ADMIN"]}>
      <AdminStaff />
    </RequireRole>
  );
}

function AdminStaff() {
  const { primaryKindergartenId } = useSession();
  const [tab, setTab] = useState<"directory" | "esis">("directory");
  /*
   * `null` closes the dialog; an object opens it. The object may carry a
   * person from the directory — the "Бүртгэл урих" button in the drawer — so
   * that inviting somebody ESIS already lists does not mean retyping their
   * name off the row that prompted it.
   */
  const [inviting, setInviting] = useState<{ prefill?: StaffDirectoryRow } | null>(null);

  return (
    <div className="flex flex-col gap-5 lg:gap-6">
      <PageHeader title="Багш, ажилтан" />

      <Tabs label="Харагдац">
        <TabButton active={tab === "directory"} onClick={() => setTab("directory")}>
          Жагсаалт
        </TabButton>
        <TabButton active={tab === "esis"} onClick={() => setTab("esis")}>
          ЭСИС мэдээлэл
        </TabButton>
      </Tabs>

      {tab === "directory" ? (
        <StaffDirectory onInvite={(prefill) => setInviting({ prefill })} />
      ) : (
        <EsisReference />
      )}

      {inviting && primaryKindergartenId ? (
        <InviteUserDialog
          kindergartenId={primaryKindergartenId}
          prefill={inviting.prefill}
          onClose={() => setInviting(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * The ministry's own tables, kept for reconciliation.
 *
 * ★ Two panels for the staff question, because ESIS answers it with two
 * services and neither is a subset of the other. `teacher/list` carries the
 * teaching assignment — instructor type, заах аргын нэгдэл, availability — and
 * `school/staff` carries employment: position, job code, years of service, the
 * parent education authority. The directory merges the people; here they stay
 * as the ministry sends them, which is what makes this tab useful for checking
 * one against the other.
 *
 * ★★ The мэргэшлийн зэрэг pair ask for a request number rather than reading on
 * open: a service that needs an id the reader has to supply cannot be called
 * without guessing one, and guessing means asking the ministry about somebody
 * else's application.
 */
function EsisReference() {
  return (
    <div className="flex flex-col gap-6">
      <EsisDataPanel resource="teachers" title="Багш нар" description="Томилгоо ба заах эрх" />
      <EsisDataPanel
        resource="staff"
        title="Ажилтнууд"
        description="Эрхлэгч, эмч, тогооч, нягтлан — албан тушаал ба ажил эрхлэлт"
      />
      <EsisDataPanel
        resource="teacherMovements"
        title="Багшийн шилжилт хөдөлгөөн"
        description="Томилгоо, шилжилт, чөлөөлөлт — сонгосон огнооноос хойш"
      />
      <EsisDataPanel
        resource="degreeDecisions"
        title="Мэргэшлийн зэргийн шийдвэрлэлт"
        description="Хүсэлтийн дугаараар ЭСИС-ийн шийдвэрлэлтийн төлөв"
      />
      <EsisDataPanel
        resource="degreeHistory"
        title="Мэргэшлийн зэргийн хүсэлтийн түүх"
        description="Хүсэлтийн дугаараар өөрчлөлтийн түүх"
      />
    </div>
  );
}

function InviteUserDialog({
  kindergartenId,
  prefill,
  onClose,
}: {
  kindergartenId: string;
  prefill?: StaffDirectoryRow;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [lastName, setLastName] = useState(prefill?.lastName ?? "");
  const [firstName, setFirstName] = useState(prefill?.firstName ?? "");
  const [email, setEmail] = useState("");
  /*
   * ★ The prefill carries a name and never a role.
   *
   * Copying a name off an ESIS row saves retyping something the ministry and
   * this product already agree on. A role is an authorization decision — it is
   * what `Membership` grants and what every `canAccessChild` check resolves
   * through — and deriving one from a job title ESIS happens to have recorded
   * would let the ministry's spreadsheet decide who administers a kindergarten.
   * So the select opens where it always did and the administrator chooses.
   */
  const [role, setRole] = useState<Role>("TEACHER");

  const invite = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/users`, invitedUserSchema, {
        method: "POST",
        body: {
          username,
          lastName,
          firstName,
          role,
          email: email.trim() === "" ? null : email.trim(),
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    },
  });

  const errors = fieldErrors(invite.error);
  const backdrop = useBackdropDismiss(onClose);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Хэрэглэгч нэмэх"
      {...backdrop}
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/50 p-4"
    >
      <div className="w-full max-w-[480px] rounded-card border border-border bg-surface p-5">
        {invite.isSuccess ? (
          <InvitationHandover
            token={invite.data.invitationToken}
            title="Урилга бэлэн"
            subtitle={`${invite.data.user.lastName} ${invite.data.user.firstName} — ${ROLE_LABEL[role]}`}
            onClose={onClose}
          />
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!invite.isPending) invite.mutate();
            }}
            className="flex flex-col gap-4"
            noValidate
          >
            <div>
              <h2 className="text-title font-semibold text-ink">Хэрэглэгч нэмэх</h2>
              <p className="mt-0.5 text-body text-muted">
                Нууц үгээ тэр хүн өөрөө сонгоно. Урилга 7 хоног хүчинтэй.
              </p>
            </div>

            <FormError message={invite.isError ? errorMessage(invite.error) : null} />

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

            <Field
              label="Нэвтрэх нэр"
              error={errors.username}
              hint="Латин үсэг, тоо, . _ -"
              required
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
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
                  onChange={(e) => setEmail(e.target.value)}
                  autoCapitalize="none"
                />
              )}
            </Field>

            <Field label="Эрх" error={errors.role} required>
              {({ id, describedBy }) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                >
                  {ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            {/*
              Parents are normally invited from a child's page: that flow
              attaches the guardianship at the same time, so the account is
              bound to a child from the moment it exists. Creating one here
              makes an account with no children attached.
            */}
            {role === "PARENT" ? (
              <p className="rounded-control bg-sun px-3 py-2 text-caption leading-relaxed text-sun-ink">
                Эцэг эхийг ихэвчлэн хүүхдийн хуудаснаас урина — тэгвэл хүүхэдтэй нь шууд холбогдоно.
                Эндээс үүсгэвэл хүүхэдгүй бүртгэл үүснэ.
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              <Button type="submit" disabled={invite.isPending}>
                <UserPlus size={18} />
                {invite.isPending ? "Үүсгэж байна…" : "Урилга үүсгэх"}
              </Button>
              <Button type="button" variant="ghost" onClick={onClose} disabled={invite.isPending}>
                Болих
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
