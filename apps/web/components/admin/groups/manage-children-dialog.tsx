"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { UserMinus, UserPlus } from "lucide-react";
import { z } from "zod";
import { childSummarySchema, paginated } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { fullName, shortName } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { SearchField } from "@/components/ui/search-field";
import { FormError, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { useBackdropDismiss } from "@/components/ui/modal-overlay";

const childrenSchema = paginated(childSummarySchema);

/**
 * Суралцагч хуваарилалт — who is in this class, added and removed by hand.
 *
 * ★ **The same shape as `ManageTeachersDialog`, at the client's request**
 * (2026-09-25): "bulegt huuhed huwaarilah … bagsh songoh shig". A director who
 * has learnt one of these two dialogs has learnt the other.
 *
 * ★★ **It writes `Enrollment`, and `Enrollment` is what authorization reads.**
 * `canAccessChild` resolves a teacher's reach through the groups they are
 * assigned to and the enrolments in them (SECURITY.md §7), so moving a child
 * here changes who can open that child's record — immediately, because roles
 * and assignments are re-read on every request. That is why removal asks
 * first.
 *
 * ★★★ **Adding a child already in another group *moves* them.** `POST
 * /children/:id/enrollments` ends the old enrolment and opens a new one rather
 * than leaving two open — so the roster of the group they left is correct the
 * moment this returns, and the child has one current class, which is the only
 * shape the register, the meal sheet and the assessment can read.
 *
 * ★★★★ **No ESIS call, and no ESIS write.** The ministry's own roster for this
 * group is compared on the page behind this dialog (`GroupRosterCheck`); what
 * happens here is this system's own record of who sits in the room. Sending it
 * to ESIS is the separate, approved write, exactly as with teachers.
 */
export function ManageChildrenDialog({
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
  const [query, setQuery] = useState("");
  const [childId, setChildId] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);

  /*
   * ★ Every child in the kindergarten, not just this group's — the picker has
   * to offer the ones who are somewhere else. 200 is past any kindergarten
   * this product describes, and the same ceiling the roster behind it uses.
   */
  const all = useQuery({
    queryKey: qk.children({ page: 1, pageSize: 200, scope: "group-picker" }),
    queryFn: () => get("/children?page=1&pageSize=200", childrenSchema),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["children"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "groups"] });
    void queryClient.invalidateQueries({ queryKey: ["groups"] });
  };

  const add = useMutation({
    mutationFn: () =>
      mutate(`/children/${childId}/enrollments`, z.unknown(), {
        method: "POST",
        body: { groupId },
      }),
    onSuccess: () => {
      toast.success("Суралцагчийг бүлэгт нэмлээ.");
      setChildId("");
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    /*
     * `PATCH`, not `DELETE`. An enrolment is history — it records that a child
     * sat in this class between two dates — so it is closed, never erased.
     * `ENDED` is the plain case; a promotion uses `GRADUATED` and a move uses
     * `TRANSFERRED`, and neither of those is what this button means.
     */
    mutationFn: (enrollmentId: string) =>
      mutate(`/enrollments/${enrollmentId}`, z.unknown(), {
        method: "PATCH",
        body: { status: "ENDED" },
      }),
    onSuccess: () => {
      toast.success("Суралцагчийг бүлгээс хаслаа.");
      setRemovingId(null);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const items = all.data?.items ?? [];

  /** The active enrolment tying a child to *this* group, if there is one. */
  const enrolmentHere = (child: (typeof items)[number]) =>
    (child.enrollments ?? []).find(
      (enrolment) => enrolment.group?.id === groupId && enrolment.status === "ACTIVE",
    );

  const inGroup = items.filter((child) => enrolmentHere(child));

  /*
   * ★ Offered: everyone not already in this class. A child sitting in another
   * group is deliberately **included** — moving them is the common case, and
   * the label says where they are now so it is never a surprise.
   */
  const candidates = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("mn-MN");
    /*
     * The group test is inlined rather than reusing `enrolmentHere`, so every
     * value this memo reads is named in its own dependency list. A helper
     * closing over `groupId` would make the list look complete while hiding
     * one of them.
     */
    const here = (child: (typeof items)[number]) =>
      (child.enrollments ?? []).some(
        (enrolment) => enrolment.group?.id === groupId && enrolment.status === "ACTIVE",
      );

    return (
      items
        .filter((child) => !here(child))
        .filter((child) => !needle || fullName(child).toLocaleLowerCase("mn-MN").includes(needle))
        /*
         * ★ Fifty. The select is a list somebody reads, and a kindergarten of
         * two hundred children would make it a wall — the search above is how
         * you reach the rest, which is why it sits over the picker rather than
         * beside it.
         */
        .slice(0, 50)
    );
  }, [items, query, groupId]);

  const backdrop = useBackdropDismiss(onClose);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${groupName} — суралцагч хуваарилалт`}
      {...backdrop}
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-ink/50 p-4"
    >
      <div className="max-h-[90vh] w-full max-w-[480px] overflow-y-auto rounded-card border border-border bg-surface p-5">
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="text-title font-semibold text-ink">Суралцагч хуваарилалт</h2>
            <p className="mt-0.5 text-body text-muted">{groupName}</p>
          </div>

          <FormError
            message={
              add.isError
                ? errorMessage(add.error)
                : remove.isError
                  ? errorMessage(remove.error)
                  : null
            }
          />

          <section className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-caption font-semibold uppercase tracking-wide text-muted">
                Бүлгийн суралцагчид
              </h3>
              <span className="text-caption tabular-nums text-muted">{inGroup.length}</span>
            </div>

            {all.isLoading ? <LoadingState rows={2} /> : null}

            {!all.isLoading && inGroup.length === 0 ? (
              <p className="text-body text-muted">Энэ бүлэгт суралцагч бүртгэгдээгүй байна.</p>
            ) : (
              <ul className="flex max-h-[220px] flex-col gap-1.5 overflow-y-auto">
                {inGroup.map((child) => {
                  const enrolment = enrolmentHere(child)!;
                  return (
                    <li
                      key={child.id}
                      className="flex min-h-[44px] items-center gap-2 rounded-row border border-border bg-canvas px-3 py-1.5"
                    >
                      <span className="min-w-0 flex-1 truncate text-body text-ink">
                        {shortName(child)}
                      </span>

                      {removingId === enrolment.id ? (
                        <>
                          <span className="text-caption text-muted">Хасах уу?</span>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => remove.mutate(enrolment.id!)}
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
                          onClick={() => setRemovingId(enrolment.id ?? null)}
                          aria-label={`${fullName(child)}-г бүлгээс хасах`}
                          className="grid size-11 shrink-0 place-items-center rounded-pill text-muted hover:bg-surface hover:text-danger"
                        >
                          <UserMinus size={15} />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (childId && !add.isPending) add.mutate();
            }}
            className="flex flex-col gap-3 border-t border-border pt-4"
          >
            <h3 className="text-caption font-semibold uppercase tracking-wide text-muted">
              Суралцагч нэмэх
            </h3>

            <SearchField
              label="Суралцагчийн нэрээр хайх"
              placeholder="Нэрээр хайх…"
              value={query}
              onChange={setQuery}
            />

            {candidates.length === 0 && all.data ? (
              <p className="rounded-control bg-sun px-3 py-2 text-body text-sun-ink">
                {query.trim()
                  ? "Хайлтад тохирох суралцагч олдсонгүй."
                  : "Нэмэх суралцагч алга. «Суралцагч» хэсгээс бүртгэнэ үү."}
              </p>
            ) : (
              <>
                <Field label="Суралцагч">
                  {({ id }) => (
                    <Select id={id} value={childId} onChange={(e) => setChildId(e.target.value)}>
                      <option value="">Сонгоно уу</option>
                      {candidates.map((child) => {
                        /*
                          ★ Where they are now, in the label. Adding a child who
                          is in another class *moves* them, and a director
                          should read that before pressing rather than discover
                          it from the other group's roster afterwards.
                        */
                        const current = (child.enrollments ?? []).find(
                          (enrolment) => enrolment.status === "ACTIVE",
                        );
                        return (
                          <option key={child.id} value={child.id}>
                            {fullName(child)}
                            {current?.group?.name ? ` — ${current.group.name}` : ""}
                          </option>
                        );
                      })}
                    </Select>
                  )}
                </Field>

                <Button type="submit" disabled={!childId || add.isPending}>
                  <UserPlus size={16} />
                  {add.isPending ? "Нэмж байна…" : "Нэмэх"}
                </Button>

                <p className="text-caption leading-relaxed text-muted">
                  Өөр бүлэгт байгаа суралцагчийг нэмэхэд тэр хүүхэд энэ бүлэг рүү шилжинэ. Хуучин
                  бүртгэл нь түүх болж үлдэнэ.
                </p>
              </>
            )}
          </form>

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
