"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { UserMinus, UserPlus } from "lucide-react";
import { z } from "zod";
import {
  ROLE_LABEL,
  SPECIALIST_ROLES,
  adminUserSchema,
  groupSpecialistSchema,
  paginated,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { fullName, shortName } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";

const usersSchema = paginated(adminUserSchema);
const listSchema = z.array(groupSpecialistSchema);

/**
 * Биеийн тамирын / Хөгжмийн багш — the group's PE and music teachers
 * (2026-10-15), inside «Багш хуваарилалт».
 *
 * ★ A separate list from the class teachers above, and a separate table
 * behind it (`GroupSpecialist`): a PE teacher assigned here reaches this
 * group's children's cards and writes their observations, and nothing of the
 * register, the health record or the money. Removing asks first, as the
 * teacher list does — it takes the group's children away from them.
 */
export function GroupSpecialists({ groupId }: { groupId: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { primaryKindergartenId } = useSession();
  const [membershipId, setMembershipId] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const listKey = ["admin", "groups", groupId, "specialists"] as const;

  const assigned = useQuery({
    queryKey: listKey,
    queryFn: () => get(`/groups/${groupId}/specialists`, listSchema),
  });

  const people = useQuery({
    queryKey: qk.adminUsers({
      roles: SPECIALIST_ROLES.join(","),
      kindergartenId: primaryKindergartenId ?? "",
    }),
    queryFn: () => {
      const params = new URLSearchParams({
        page: "1",
        pageSize: "100",
        roles: SPECIALIST_ROLES.join(","),
      });
      if (primaryKindergartenId) params.set("kindergartenId", primaryKindergartenId);
      return get(`/users?${params}`, usersSchema);
    },
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: listKey });

  const assign = useMutation({
    mutationFn: () =>
      mutate(`/groups/${groupId}/specialists`, z.unknown(), {
        method: "POST",
        body: { membershipId },
      }),
    onSuccess: () => {
      toast.success("Багш хуваарилагдлаа.");
      setMembershipId("");
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      mutate(`/group-specialists/${id}`, z.unknown(), { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Багшийг хаслаа.");
      setRemovingId(null);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const rows = assigned.data ?? [];
  const taken = new Set(rows.map((row) => row.membershipId));
  const options = (people.data?.items ?? []).flatMap((user) =>
    user.memberships
      .filter(
        (m) =>
          m.kindergartenId === primaryKindergartenId &&
          (SPECIALIST_ROLES as readonly string[]).includes(m.role) &&
          m.isActive !== false &&
          !taken.has(m.id),
      )
      .map((m) => ({
        membershipId: m.id,
        label: `${fullName(user)} — ${ROLE_LABEL[m.role]}`,
      })),
  );

  return (
    <section className="flex flex-col gap-3 border-t border-border pt-4">
      <h3 className="text-caption font-semibold uppercase tracking-wide text-muted">
        Биеийн тамир, хөгжмийн багш
      </h3>

      {assigned.isLoading ? <LoadingState rows={1} /> : null}

      {rows.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex min-h-[44px] items-center gap-2 rounded-row border border-border bg-canvas px-3 py-1.5"
            >
              <span className="min-w-0 flex-1 truncate text-body text-ink">
                {shortName(row.user)}
              </span>
              <Badge tone="neutral">{ROLE_LABEL[row.role]}</Badge>
              {removingId === row.id ? (
                <>
                  <span className="text-caption text-muted">Хасах уу?</span>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => remove.mutate(row.id)}
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
                  onClick={() => setRemovingId(row.id)}
                  aria-label={`${fullName(row.user)}-г бүлгээс хасах`}
                  className="grid size-11 shrink-0 place-items-center rounded-pill text-muted hover:bg-surface hover:text-danger"
                >
                  <UserMinus size={15} />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {options.length === 0 && people.data ? (
        <p className="text-body text-muted">
          {rows.length === 0 ? "Хуваарилсан багш алга. " : ""}
          Биеийн тамир, хөгжмийн багшийг{" "}
          <Link href="/admin/users" className="text-primary underline">
            «Багш, ажилтан»
          </Link>{" "}
          хэсгээс тухайн эрхээр урина.
        </p>
      ) : options.length > 0 ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (membershipId && !assign.isPending) assign.mutate();
          }}
          className="flex flex-col gap-3"
        >
          <Field label="Биеийн тамир, хөгжмийн багш">
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
          <Button type="submit" disabled={!membershipId || assign.isPending}>
            <UserPlus size={16} />
            {assign.isPending ? "Нэмж байна…" : "Нэмэх"}
          </Button>
        </form>
      ) : null}
    </section>
  );
}
