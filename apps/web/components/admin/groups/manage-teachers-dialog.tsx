"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { UserMinus, UserPlus } from "lucide-react";
import { z } from "zod";
import { adminUserSchema, groupWithTeachersSchema, paginated } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { fullName, shortName } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { FormError, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { useBackdropDismiss } from "@/components/ui/modal-overlay";
import { SingleImageUpload } from "@/components/media/single-image-upload";

const usersSchema = paginated(adminUserSchema);

/**
 * Багш хуваарилалт — who teaches this group, in NomadKids.
 *
 * ★ **This dialog writes `GroupTeacher` and nothing else.** That row is what
 * decides which children a teacher can open: a TEACHER membership on its own
 * reaches nobody, and `canAccessChild` resolves through the groups somebody is
 * *actively assigned to* (SECURITY.md §7). So adding here is a real grant and
 * removing is a real revocation, effective on that teacher's next request
 * because roles and assignments are re-read every time.
 *
 * ★★ **It does not touch ESIS, deliberately.** The ministry records a group's
 * instructor too, and sending that is a separate, approved write — prepare,
 * show the director the exact payload, approve, queue (`EsisGroupWrite` on
 * `/groups/:id`). Collapsing the two into one press would mean either a local
 * assignment silently waiting on a ministry queue, or an approval step that is
 * not an approval. The link at the foot says where the second half lives.
 *
 * ★★★ Removal asks first. This is the screen where a misclick quietly takes a
 * teacher's children away from them.
 */
export function ManageTeachersDialog({
  groupId,
  groupName,
  onClose,
}: {
  groupId: string;
  groupName: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { primaryKindergartenId } = useSession();
  const [membershipId, setMembershipId] = useState("");
  const [role, setRole] = useState("LEAD");
  const [removingId, setRemovingId] = useState<string | null>(null);

  /*
   * `GET /groups/:id` is the assignment list — there is no `/teachers` route.
   * The detail endpoint includes the group's active `GroupTeacher` rows with
   * the teacher's name on each, which is exactly what this draws.
   */
  const group = useQuery({
    queryKey: ["admin", "groups", groupId],
    queryFn: () => get(`/groups/${groupId}`, groupWithTeachersSchema),
  });

  const teachers = useQuery({
    queryKey: qk.adminUsers({ role: "TEACHER" }),
    queryFn: () => {
      const params = new URLSearchParams({ page: "1", pageSize: "100", role: "TEACHER" });
      if (primaryKindergartenId) params.set("kindergartenId", primaryKindergartenId);
      return get(`/users?${params}`, usersSchema);
    },
  });

  /*
   * ★ Invalidates the whole `["admin", "groups"]` prefix, which is both the
   * list and this group's detail — the grid's "Багшгүй" tile and its card are
   * computed from the same rows, so one press has to refresh both. The list's
   * teachers arrive with it (`GET /groups` carries its assignments), so there
   * is nothing else to refetch.
   */
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "groups"] });
    void queryClient.invalidateQueries({ queryKey: ["groups"] });
  };

  const assign = useMutation({
    mutationFn: () =>
      mutate(`/groups/${groupId}/teachers`, z.unknown(), {
        method: "POST",
        body: { membershipId, role },
      }),
    onSuccess: () => {
      toast.success("Багш хуваарилагдлаа.");
      setMembershipId("");
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => mutate(`/group-teachers/${id}`, z.unknown(), { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Багшийг хаслаа.");
      setRemovingId(null);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  // Only assignments that have not ended — `endedOn` is how the API retires one.
  const assigned = (group.data?.teachers ?? []).filter((teacher) => !teacher.endedOn);
  const assignedMembershipIds = new Set(assigned.map((teacher) => teacher.membership?.id));

  /*
   * The API takes a `membershipId`, not a user id — the assignment is to this
   * person's role *in this kindergarten*. Anyone already assigned is left out
   * rather than shown and rejected with a 409.
   */
  const options = (teachers.data?.items ?? []).flatMap((user) => {
    const membership = user.memberships.find((entry) => entry.role === "TEACHER");
    return membership && !assignedMembershipIds.has(membership.id)
      ? [{ membershipId: membership.id, label: fullName(user) }]
      : [];
  });

  const backdrop = useBackdropDismiss(onClose);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${groupName} — багш хуваарилалт`}
      {...backdrop}
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/50 p-4"
    >
      <div className="w-full max-w-[460px] rounded-card border border-border bg-surface p-5">
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-title font-semibold text-ink">Багш хуваарилалт</h2>
            <p className="mt-0.5 text-body text-muted">{groupName}</p>
          </div>

          <FormError
            message={
              assign.isError
                ? errorMessage(assign.error)
                : remove.isError
                  ? errorMessage(remove.error)
                  : null
            }
          />

          <section className="flex flex-col gap-2">
            <h3 className="text-caption font-semibold uppercase tracking-wide text-muted">
              Одоогийн багш
            </h3>

            {group.isLoading ? <LoadingState rows={1} /> : null}

            {assigned.length === 0 && !group.isLoading ? (
              <p className="text-body text-muted">Багш тохируулаагүй байна.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {assigned.map((teacher) => (
                  <li
                    key={teacher.id}
                    className="flex min-h-[44px] items-center gap-2 rounded-row border border-border bg-canvas px-3 py-1.5"
                  >
                    <span className="min-w-0 flex-1 truncate text-body text-ink">
                      {shortName(teacher.membership?.user)}
                    </span>
                    <Badge tone={teacher.role === "ASSISTANT" ? "neutral" : "sky"}>
                      {teacher.role === "ASSISTANT" ? "Туслах" : "Үндсэн"}
                    </Badge>

                    {removingId === teacher.id ? (
                      <>
                        <span className="text-caption text-muted">Хасах уу?</span>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => remove.mutate(teacher.id)}
                          disabled={remove.isPending}
                        >
                          Тийм
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setRemovingId(null)}>
                          Үгүй
                        </Button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setRemovingId(teacher.id)}
                        aria-label={`${fullName(teacher.membership?.user)}-г бүлгээс хасах`}
                        className="grid size-11 shrink-0 place-items-center rounded-pill text-muted hover:bg-surface hover:text-danger"
                      >
                        <UserMinus size={15} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (membershipId && !assign.isPending) assign.mutate();
            }}
            className="flex flex-col gap-3 border-t border-border pt-4"
          >
            <h3 className="text-caption font-semibold uppercase tracking-wide text-muted">
              Багш нэмэх
            </h3>

            {options.length === 0 && teachers.data ? (
              <p className="rounded-control bg-sun px-3 py-2 text-body text-sun-ink">
                Нэмэх багш алга.{" "}
                <Link href="/admin/users" className="underline">
                  «Багш, ажилтан»
                </Link>{" "}
                хэсгээс багш урина уу.
              </p>
            ) : (
              <>
                <Field label="Багш">
                  {({ id }) => (
                    <Select
                      id={id}
                      value={membershipId}
                      onChange={(event) => setMembershipId(event.target.value)}
                    >
                      <option value="">Сонгоно уу</option>
                      {options.map((option) => (
                        <option key={option.membershipId} value={option.membershipId}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>

                <Field label="Үүрэг">
                  {({ id }) => (
                    <Select id={id} value={role} onChange={(event) => setRole(event.target.value)}>
                      <option value="LEAD">Үндсэн багш</option>
                      <option value="ASSISTANT">Туслах багш</option>
                    </Select>
                  )}
                </Field>

                <Button type="submit" disabled={!membershipId || assign.isPending}>
                  <UserPlus size={16} />
                  {assign.isPending ? "Нэмж байна…" : "Нэмэх"}
                </Button>
              </>
            )}
          </form>

          {/*
            RFP §3.2 — ангийн зураг. It lives in this dialog rather than on the
            cards because a grid of class photographs is a gallery, and this is
            already the place a director opens to change the group's people.
          */}
          <div className="border-t border-border pt-4">
            <SingleImageUpload
              endpoint={`/groups/${groupId}/photo`}
              currentMediaId={group.data?.photoMediaFileId}
              label="Ангийн зураг нэмэх"
              alt={`${groupName} бүлгийн зураг`}
              invalidateKeys={[["admin", "groups"]]}
            />
          </div>

          {/*
            ★ Says where the ESIS half is, and does not do it. The ministry's
            own instructor record is written through the approval flow on the
            group's page — a second button here would either bypass that or
            imply this one already did it.
          */}
          <p className="rounded-control bg-canvas px-3 py-2 text-caption leading-relaxed text-muted">
            Энд хийсэн хуваарилалт NomadKids-ийн эрхэд шууд үйлчилнэ. ЭСИС рүү илгээхийг{" "}
            <Link href={`/groups/${groupId}`} className="text-primary underline">
              бүлгийн хуудаснаас
            </Link>{" "}
            баталгаажуулна.
          </p>

          <div className="border-t border-border pt-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              Хаах
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
