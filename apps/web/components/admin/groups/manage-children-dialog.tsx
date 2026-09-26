"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { UserMinus, UserPlus } from "lucide-react";
import { z } from "zod";
import { MAX_PAGE_SIZE, childSummarySchema, paginated } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { fullName, shortName } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { SelectBox } from "@/components/ui/selection";
import { useDebounced } from "@/lib/use-debounced";
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
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [removingId, setRemovingId] = useState<string | null>(null);
  const search = useDebounced(query.trim());

  /*
   * ★ Two reads, not one of the whole kindergarten — 2026-09-26.
   *
   * This read every child in the kindergarten with `pageSize=200` and split
   * them in the browser. The API caps a page at `MAX_PAGE_SIZE` (100) and
   * refused it outright — «100-аас ихгүй байх ёстой» — and even at 100 a
   * kindergarten of 656 (the ministry's SIS trial had one) would silently
   * lose everyone past the first page from both lists.
   *
   * So the class is read by `groupId`, which is small by construction, and
   * the children who could be added are found by the server's own name
   * search: the first hundred matches of what was typed, which is the set a
   * person is choosing from anyway.
   */
  const members = useQuery({
    queryKey: qk.children({ groupId, page: 1, pageSize: MAX_PAGE_SIZE, scope: "group-picker" }),
    queryFn: () =>
      get(`/children?groupId=${groupId}&page=1&pageSize=${MAX_PAGE_SIZE}`, childrenSchema),
  });

  const found = useQuery({
    queryKey: qk.children({ page: 1, pageSize: MAX_PAGE_SIZE, q: search, scope: "group-picker" }),
    queryFn: () =>
      get(
        `/children?page=1&pageSize=${MAX_PAGE_SIZE}${search ? `&q=${encodeURIComponent(search)}` : ""}`,
        childrenSchema,
      ),
    placeholderData: (previous) => previous,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["children"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "groups"] });
    void queryClient.invalidateQueries({ queryKey: ["groups"] });
  };

  /*
   * ★ Several children, one press — 2026-09-26, the client: "бүлэгтээ
   * хүүхдүүдээ сонгож хуваарилах хэрэгтэй". One `POST` per child, in turn:
   * the endpoint moves a child who is enrolled elsewhere, and doing them one
   * at a time means a failure names the child it stopped at rather than
   * leaving an unknown half of a batch written.
   */
  const add = useMutation({
    mutationFn: async (childIds: string[]) => {
      let added = 0;
      for (const id of childIds) {
        await mutate(`/children/${id}/enrollments`, z.unknown(), {
          method: "POST",
          body: { groupId },
        });
        added += 1;
      }
      return added;
    },
    onSuccess: (added) => {
      toast.success(`${added} суралцагчийг бүлэгт нэмлээ.`);
      setPicked(new Set());
      refresh();
    },
    onError: (error) => {
      toast.error(errorMessage(error));
      setPicked(new Set());
      refresh();
    },
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

  const inGroup = members.data?.items ?? [];

  /** The active enrolment tying a child to *this* group, if there is one. */
  const enrolmentHere = (child: (typeof inGroup)[number]) =>
    (child.enrollments ?? []).find(
      (enrolment) => enrolment.group?.id === groupId && enrolment.status === "ACTIVE",
    );

  /*
   * ★ Offered: everyone the search found who is not already in this class. A
   * child sitting in another group is deliberately **included** — moving them
   * is the common case, and the row says where they are now so it is never a
   * surprise.
   */
  const candidates = useMemo(
    () =>
      (found.data?.items ?? []).filter(
        (child) =>
          !(child.enrollments ?? []).some(
            (enrolment) => enrolment.group?.id === groupId && enrolment.status === "ACTIVE",
          ),
      ),
    [found.data, groupId],
  );

  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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

            {members.isLoading ? <LoadingState rows={2} /> : null}

            {!members.isLoading && inGroup.length === 0 ? (
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
              if (picked.size > 0 && !add.isPending) add.mutate([...picked]);
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

            {found.isLoading ? <LoadingState rows={2} /> : null}

            {candidates.length === 0 && found.data ? (
              <p className="rounded-control bg-sun px-3 py-2 text-body text-sun-ink">
                {search
                  ? "Хайлтад тохирох суралцагч олдсонгүй."
                  : "Нэмэх суралцагч алга. «Суралцагч» хэсгээс бүртгэнэ үү."}
              </p>
            ) : null}

            {candidates.length > 0 ? (
              <>
                <ul className="flex max-h-[260px] flex-col gap-1 overflow-y-auto">
                  {candidates.map((child) => {
                    /*
                      ★ Where they are now, on the row. Adding a child who is
                      in another class *moves* them, and a director should read
                      that before pressing rather than discover it from the
                      other group's roster afterwards.
                    */
                    const current = (child.enrollments ?? []).find(
                      (enrolment) => enrolment.status === "ACTIVE",
                    );
                    return (
                      <li
                        key={child.id}
                        className="flex min-h-[44px] items-center gap-3 rounded-row px-2 hover:bg-canvas"
                      >
                        <SelectBox
                          checked={picked.has(child.id)}
                          onChange={() => toggle(child.id)}
                          label={`${fullName(child)} — сонгох`}
                        />
                        <span className="min-w-0 flex-1 truncate text-body text-ink">
                          {fullName(child)}
                        </span>
                        {current?.group?.name ? (
                          <span className="shrink-0 text-caption text-muted">
                            {current.group.name}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>

                <Button type="submit" disabled={picked.size === 0 || add.isPending}>
                  <UserPlus size={16} />
                  {add.isPending
                    ? "Нэмж байна…"
                    : picked.size > 0
                      ? `Нэмэх (${picked.size})`
                      : "Нэмэх"}
                </Button>

                <p className="text-caption leading-relaxed text-muted">
                  Өөр бүлэгт байгаа суралцагчийг нэмэхэд тэр хүүхэд энэ бүлэг рүү шилжинэ. Хуучин
                  бүртгэл нь түүх болж үлдэнэ.
                </p>
              </>
            ) : null}
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
