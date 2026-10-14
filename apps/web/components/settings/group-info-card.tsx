"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { MAX_PAGE_SIZE } from "@kinder/contracts";
import { useMyGroup } from "@/components/dashboard/use-my-group";
import { EsisButton } from "@/components/esis/esis-button";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { FactRow } from "@/components/ui/fact-row";
import { Field, Input, Select } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { FormError } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { get, mutate } from "@/lib/api/browser";
import { ApiError } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { useEsisLinked } from "@/lib/use-esis-linked";

/**
 * A group's kind as a teacher and a family read it — `Group.ageBand`.
 *
 * ★ «Холимог» (2026-10-14, the user) is not in the API's `AgeBand` yet: the
 * web sends `MIXED`, and until the admin adds it the save says so plainly.
 */
export const GROUP_TYPES = [
  { value: "NURSERY", label: "Бага бүлэг" },
  { value: "JUNIOR", label: "Дунд бүлэг" },
  { value: "MIDDLE", label: "Ахлах бүлэг" },
  { value: "SENIOR", label: "Бэлтгэл бүлэг" },
  { value: "MIXED", label: "Холимог бүлэг" },
] as const;

export const GROUP_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  GROUP_TYPES.map((type) => [type.value, type.label]),
);

const rosterSchema = z.object({
  items: z.array(z.object({ sex: z.string().nullish() })),
  total: z.number(),
});

/** How many children, boys and girls — counted from «Суралцагч», never typed. */
export function useGroupHeadcount(groupId: string | undefined) {
  const roster = useQuery({
    queryKey: ["groups", groupId ?? "", "headcount"],
    queryFn: () =>
      get(`/children?groupId=${groupId}&page=1&pageSize=${MAX_PAGE_SIZE}`, rosterSchema),
    enabled: Boolean(groupId),
  });
  const items = roster.data?.items ?? [];
  return {
    isPending: roster.isPending,
    total: roster.data?.total ?? 0,
    boys: items.filter((child) => child.sex === "MALE").length,
    girls: items.filter((child) => child.sex === "FEMALE").length,
  };
}

/** `POST /kindergartens/:id/esis/sync-groups` — as «Анги, бүлэг» reads it. */
const syncResultSchema = z.object({
  groups: z.object({ created: z.number(), updated: z.number() }),
});

/**
 * «Бүлгийн мэдээлэл» — a teacher's group in «Хувийн тохиргоо», above
 * «Бүртгэлтэй төхөөрөмж» (2026-10-14, the user): the name, the kind (Бага …
 * Холимог), and how many children, boys and girls, counted from the roster.
 *
 * A kindergarten linked to ESIS pulls the group from ESIS with the same «ESIS
 * татах» as everywhere else (a director's pull — it renews every group); one
 * without ESIS fills it in by hand.
 */
export function GroupInfoCard() {
  const { session, hasRole } = useSession();
  const isTeacher = hasRole("TEACHER");
  const { group } = useMyGroup({ enabled: isTeacher });
  const headcount = useGroupHeadcount(group?.id);
  const esisLinked = useEsisLinked();
  const [editing, setEditing] = useState(false);
  const toast = useToast();
  const queryClient = useQueryClient();

  const directs = (session?.memberships ?? []).some(
    (m) => m.role === "ADMIN" && m.kindergartenId === group?.kindergartenId,
  );

  const sync = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${group?.kindergartenId}/esis/sync-groups`, syncResultSchema, {
        method: "POST",
        body: {},
      }),
    onSuccess: () => {
      toast.success("Бүлгийн мэдээллийг ЭСИС-ээс шинэчиллээ.");
      void queryClient.invalidateQueries({ queryKey: ["groups"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (!isTeacher || !group) return null;

  const count = (n: number) => (headcount.isPending ? "…" : `${n} хүүхэд`);

  return (
    <Card pad="roomy" className="flex flex-col gap-4">
      <SectionHeader
        title="Бүлгийн мэдээлэл"
        lede="Хүүхдийн тоо «Суралцагч»-аас автоматаар тоологдоно."
        action={
          esisLinked ? (
            directs ? (
              <EsisButton pending={sync.isPending} onClick={() => sync.mutate()} />
            ) : null
          ) : esisLinked === false ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-caption font-normal text-muted hover:text-ink"
              onClick={() => setEditing(true)}
            >
              <Pencil size={14} aria-hidden="true" />
              Засах
            </Button>
          ) : null
        }
      />
      <dl className="border-t border-border-soft">
        <FactRow label="Бүлгийн нэр">{group.name}</FactRow>
        <FactRow label="Бүлгийн төрөл">
          {group.ageBand ? (GROUP_TYPE_LABEL[group.ageBand] ?? group.ageBand) : "—"}
        </FactRow>
        <FactRow label="Хүүхдийн тоо">{count(headcount.total)}</FactRow>
        <FactRow label="Эрэгтэй">{count(headcount.boys)}</FactRow>
        <FactRow label="Эмэгтэй" last>
          {count(headcount.girls)}
        </FactRow>
      </dl>
      {esisLinked && !directs ? (
        <p className="text-caption text-muted">
          Бүлгийн мэдээлэл ЭСИС-ээс татагдана. Эрхлэгч «ESIS татах»-аар шинэчилнэ.
        </p>
      ) : null}

      {editing ? (
        <EditGroupDialog
          group={{ id: group.id, name: group.name, ageBand: group.ageBand ?? "" }}
          onClose={() => setEditing(false)}
        />
      ) : null}
    </Card>
  );
}

function EditGroupDialog({
  group,
  onClose,
}: {
  group: { id: string; name: string; ageBand: string };
  onClose: () => void;
}) {
  const [name, setName] = useState(group.name);
  const [ageBand, setAgeBand] = useState(group.ageBand);
  const toast = useToast();
  const queryClient = useQueryClient();

  const save = useMutation({
    mutationFn: () =>
      mutate(`/groups/${group.id}`, z.unknown(), {
        method: "PATCH",
        body: { name: name.trim(), ...(ageBand ? { ageBand } : {}) },
      }),
    onSuccess: () => {
      toast.success("Бүлгийн мэдээлэл хадгалагдлаа.");
      void queryClient.invalidateQueries({ queryKey: ["groups"] });
      onClose();
    },
  });

  return (
    <FormDialog
      open
      onOpenChange={(open) => (open ? null : onClose())}
      title="Бүлгийн мэдээлэл засах"
      busy={save.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Болих
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !name.trim()}>
            {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Бүлгийн нэр" required>
          {({ id }) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="Бүлгийн төрөл">
          {({ id }) => (
            <Select id={id} value={ageBand} onChange={(e) => setAgeBand(e.target.value)}>
              <option value="">Сонгох</option>
              {GROUP_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {save.isError ? <FormError message={saveRefusal(save.error, ageBand)} /> : null}
      </div>
    </FormDialog>
  );
}

/** The server's refusal, in the words that tell the teacher what to do. */
function saveRefusal(error: unknown, ageBand: string): string {
  if (error instanceof ApiError) {
    if (error.status === 403 || error.status === 404) {
      return "Бүлгийн мэдээллийг одоогоор зөвхөн эрхлэгч засна.";
    }
    if (error.status === 400 && ageBand === "MIXED") {
      return "«Холимог бүлэг» хараахан хадгалагдахгүй байна. Удахгүй нэмэгдэнэ.";
    }
  }
  return errorMessage(error);
}
