"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  paginated,
  platformKindergartenSchema,
  soloMergePreviewSchema,
  soloMergeResultSchema,
  type SoloMergePreview,
  type SoloWorkspace,
} from "@kinder/contracts";
import { UserRound } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { PlatformPageHeading } from "@/components/platform/platform-page-heading";
import {
  SoloTeachersTable,
  teacherName,
  type SoloRow,
} from "@/components/platform/solo-teachers-table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ResetPasswordLinkDialog } from "@/components/platform/reset-password-link-dialog";
import { RequireSuperAdmin } from "@/components/shell/require-role";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { FormError, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";

const kindergartensSchema = paginated(platformKindergartenSchema);

/**
 * Бие даасан багш — the operator's list of solo teachers' workspaces, and the
 * merge of one into the contracted kindergarten the teacher works at (D3, the
 * user 2026-10-11). The preview runs the merge and rolls it back, so what it
 * shows is what «Нэгтгэх» will do — or why it would stop.
 */
export default function SoloWorkspacesPage() {
  return (
    <RequireSuperAdmin>
      <SoloWorkspaces />
    </RequireSuperAdmin>
  );
}

/*
 * ★ The same table as «Цэцэрлэгүүд» — 2026-10-14, the user: search, filters,
 * the children who paid their QPay fee and those who have not; «⋯» opens the
 * merge right here.
 */
function SoloWorkspaces() {
  const [merging, setMerging] = useState<SoloWorkspace | null>(null);
  const [deleting, setDeleting] = useState<SoloRow | null>(null);
  const [purging, setPurging] = useState<SoloRow | null>(null);
  const [resetting, setResetting] = useState<SoloRow | null>(null);

  return (
    <div className="flex flex-col gap-5 pb-8">
      <PlatformPageHeading
        title="Бие даасан багш"
        lede="Цэцэрлэг гэрээ байгуулахад багшийн орчныг тэр цэцэрлэгт нэгтгэнэ. Юу ч устахгүй."
        mark={<UserRound />}
      />

      <SoloTeachersTable
        onMerge={setMerging}
        onDelete={setDeleting}
        onPurge={setPurging}
        onResetPassword={setResetting}
      />

      {merging ? <MergeDialog workspace={merging} onClose={() => setMerging(null)} /> : null}
      {resetting ? (
        <ResetPasswordLinkDialog
          path={`/platform/solo-workspaces/${resetting.id}/password-reset`}
          person={teacherName(resetting)}
          notReady="Сэргээх холбоос үүсгэх хэсэг хараахан бэлэн болоогүй."
          onClose={() => setResetting(null)}
        />
      ) : null}
      {deleting ? (
        <DeleteSoloDialog workspace={deleting} onClose={() => setDeleting(null)} />
      ) : null}
      {purging ? <PurgeSoloDialog workspace={purging} onClose={() => setPurging(null)} /> : null}
    </div>
  );
}

/**
 * «Устгах» — at any time (2026-10-18, the user: the client's trial left
 * made-up accounts). A soft delete (CLAUDE.md §3.2): `DELETE /platform/
 * solo-workspaces/:id`. The children whose families paid are named, so the
 * operator deletes knowing it.
 */
function DeleteSoloDialog({ workspace, onClose }: { workspace: SoloRow; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () =>
      mutate(`/platform/solo-workspaces/${workspace.id}`, z.unknown(), { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Бие даасан багшийг устгалаа.");
      void queryClient.invalidateQueries({ queryKey: ["platform"] });
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const paid = workspace.paidChildCount ?? 0;

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`${teacherName(workspace)}-г устгах уу?`}
      description={`${workspace.childCount} хүүхэд${
        paid > 0 ? `, үүнээс ${paid} хүүхдийн эцэг эх төлбөр төлсөн` : ""
      }. Устгасны дараа багш болон эцэг эхчүүд нэвтрэх боломжгүй. Өгөгдөл нь хадгалагдана.`}
      confirmLabel="Устгах"
      pendingLabel="Устгаж байна…"
      tone="danger"
      pending={remove.isPending}
      onConfirm={() => remove.mutate()}
    />
  );
}

const purgePreviewSchema = z.object({
  purgeable: z.boolean(),
  deleted: z.record(z.string(), z.number()),
  usersDeleted: z.number(),
  usersKept: z.number(),
  files: z.number(),
});

/**
 * «Бүр мөсөн устгах» — the rows go (the user, 2026-10-18; the one exception
 * to CLAUDE.md §3.2), only where no money moved. The preview runs the purge
 * and rolls it back, so the counts are what goes; the teacher's username,
 * typed, is the confirmation.
 */
function PurgeSoloDialog({ workspace, onClose }: { workspace: SoloRow; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState("");

  const preview = useQuery({
    queryKey: ["platform", "solo-purge-preview", workspace.id],
    queryFn: () =>
      mutate(`/platform/solo-workspaces/${workspace.id}/purge-preview`, purgePreviewSchema, {
        method: "POST",
      }),
    retry: false,
    gcTime: 0,
  });

  const purge = useMutation({
    mutationFn: () =>
      mutate(`/platform/solo-workspaces/${workspace.id}/purge`, z.unknown(), {
        method: "POST",
        body: { username: typed.trim() },
      }),
    onSuccess: () => {
      toast.success("Бүртгэлийг бүр мөсөн устгалаа.");
      void queryClient.invalidateQueries({ queryKey: ["platform"] });
      onClose();
    },
  });

  const counts = preview.data;
  const rows = counts ? Object.values(counts.deleted).reduce((sum, n) => sum + n, 0) : 0;
  const username = workspace.teacherUsername ?? "";
  const ready = Boolean(counts?.purgeable) && username !== "" && typed.trim() === username;

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && !purge.isPending && onClose()}
      title={`${teacherName(workspace)}-г бүр мөсөн устгах уу?`}
      description="Буцаах боломжгүй. Хүүхэд, бүлэг, ажиглалт, зураг, багш болон эцэг эхчүүдийн бүртгэл устна. Audit log хадгалагдана."
      busy={purge.isPending}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={purge.isPending}>
            Болих
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => purge.mutate()}
            disabled={!ready || purge.isPending}
          >
            {purge.isPending ? "Устгаж байна…" : "Бүр мөсөн устгах"}
          </Button>
        </>
      }
    >
      {preview.isPending ? <LoadingState label="Тоолж байна…" rows={2} /> : null}
      <FormError message={preview.isError ? errorMessage(preview.error) : null} />
      {counts && !counts.purgeable ? (
        <p role="alert" className="text-body font-semibold text-danger">
          Энэ бүртгэлээр төлбөр төлөгдсөн тул бүр мөсөн устгах боломжгүй. «Устгах»-ыг ашиглана уу.
        </p>
      ) : null}
      {counts?.purgeable ? (
        <div className="flex flex-col gap-3">
          <p className="text-body text-ink">
            {workspace.childCount} хүүхэд, {counts.usersDeleted} хэрэглэгч, {counts.files} файл —
            нийт {rows} мөр устна.
            {counts.usersKept > 0
              ? ` ${counts.usersKept} хүн өөр цэцэрлэгт бүртгэлтэй тул бүртгэл нь үлдэнэ.`
              : ""}
          </p>
          <Field
            label="Баталгаажуулахын тулд багшийн нэвтрэх нэрийг бичнэ үү"
            hint={username ? `«${username}»` : "Багшийн нэвтрэх нэр олдсонгүй."}
          >
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
              />
            )}
          </Field>
          <FormError message={purge.isError ? errorMessage(purge.error) : null} />
        </div>
      ) : null}
    </FormDialog>
  );
}

/** «нарлаг» for «Нарлаг цэцэрлэг (тест)» — the words that tell a kindergarten apart. */
function nameKey(name: string): string {
  return name
    .toLocaleLowerCase("mn")
    .replace(/\([^)]*\)/g, " ")
    .replace(/цэцэрлэг/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Merging a solo teacher's workspace into a kindergarten — made simple on
 * 2026-10-14 (the user: "яаж хялбар болгох"). One screen, one decision:
 *
 *   - the kindergarten the teacher said they work at is chosen already;
 *     inactive kindergartens are not offered;
 *   - the preview runs by itself whenever a choice changes — it is the merge,
 *     rolled back (D3), so what it shows is what happens — and «Нэгтгэх»
 *     waits for the preview of exactly these choices;
 *   - a group's name is asked for only when it clashes;
 *   - nothing is undone, so «Нэгтгэх» asks once more.
 */
function MergeDialog({ workspace, onClose }: { workspace: SoloWorkspace; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("");
  const [targetGroupId, setTargetGroupId] = useState("");
  /** Children kept apart, by id, with their names — they leave the preview's list. */
  const [kept, setKept] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);

  const kindergartens = useQuery({
    queryKey: ["platform", "kindergartens", "merge-targets"],
    queryFn: () => get("/platform/kindergartens?page=1&pageSize=100", kindergartensSchema),
  });
  const targets = (kindergartens.data?.items ?? []).filter((kg) => kg.isActive);
  const said = workspace.workplace ? nameKey(workspace.workplace) : "";
  const suggested = said
    ? targets.find((kg) => {
        const key = nameKey(kg.name);
        return key !== "" && (key === said || key.includes(said) || said.includes(key));
      })
    : undefined;
  const targetId = picked ?? suggested?.id ?? "";

  const body = {
    targetKindergartenId: targetId,
    ...(groupName.trim() ? { groupName: groupName.trim() } : {}),
    ...(targetGroupId ? { targetGroupId } : {}),
    ...(Object.keys(kept).length > 0 ? { keepSeparate: Object.keys(kept) } : {}),
  };

  const preview = useQuery({
    queryKey: ["platform", "solo-merge-preview", workspace.id, body],
    queryFn: () =>
      mutate(`/platform/solo-workspaces/${workspace.id}/merge-preview`, soloMergePreviewSchema, {
        method: "POST",
        body,
      }),
    enabled: Boolean(targetId),
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });

  const runMerge = useMutation({
    mutationFn: () =>
      mutate(`/platform/solo-workspaces/${workspace.id}/merge`, soloMergeResultSchema, {
        method: "POST",
        body,
      }),
    onSuccess: () => {
      toast.success("Багшийн орчныг цэцэрлэгт нэгтгэлээ.");
      void queryClient.invalidateQueries({ queryKey: ["platform"] });
      onClose();
    },
  });

  const shown = preview.data;
  const ready = shown?.ok === true && !preview.isFetching;
  const result = shown?.ok ? shown.result : null;
  const target = targets.find((kg) => kg.id === targetId);
  const clash = !targetGroupId && result && !result.intoExistingGroup ? result.groupsRenamed : [];
  const attached = result?.childrenAttached ?? [];
  const toggleKept = (id: string, name: string) =>
    setKept((current) => {
      const next = { ...current };
      if (next[id]) delete next[id];
      else next[id] = name;
      return next;
    });

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && !runMerge.isPending && onClose()}
      title={`${teacherName(workspace)}-г цэцэрлэгт нэгтгэх`}
      description="Хүүхэд, бүлэг, эцэг эх, ажиглалт, төлбөр бүгд сонгосон цэцэрлэг рүү шилжинэ. Багш тэнд багш болно. Юу ч устахгүй."
      busy={runMerge.isPending}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={runMerge.isPending}>
            Болих
          </Button>
          <Button
            size="sm"
            disabled={!ready || runMerge.isPending}
            onClick={() => setConfirming(true)}
          >
            {runMerge.isPending ? "Нэгтгэж байна…" : "Нэгтгэх"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormError
          message={
            runMerge.error
              ? errorMessage(runMerge.error)
              : preview.error
                ? errorMessage(preview.error)
                : null
          }
        />

        <Field
          label="Цэцэрлэг"
          hint={
            suggested && targetId === suggested.id
              ? `Багшийн бичсэн «${workspace.workplace}»-аар сонгогдсон.`
              : undefined
          }
          required
        >
          {({ id, describedBy }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              value={targetId}
              onChange={(event) => {
                setPicked(event.target.value);
                setTargetGroupId("");
                setKept({});
                setGroupName("");
              }}
            >
              <option value="">Сонгоно уу</option>
              {targets.map((kg) => (
                <option key={kg.id} value={kg.id}>
                  {kg.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {shown && shown.targetGroups.length > 0 ? (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-caption font-semibold text-ink">Бүлэг</legend>
            {[{ id: "", name: "" }, ...shown.targetGroups].map((group) => (
              <label key={group.id || "__new"} className="flex items-center gap-2 text-body">
                <input
                  type="radio"
                  name="merge-group"
                  className="size-4"
                  checked={targetGroupId === group.id}
                  onChange={() => {
                    setTargetGroupId(group.id);
                    setGroupName("");
                  }}
                />
                {group.id ? `«${group.name}» бүлэгт нэгтгэх` : "Шинэ бүлэг болж орно"}
              </label>
            ))}
          </fieldset>
        ) : null}

        {preview.isFetching ? <LoadingState rows={2} /> : null}

        {shown && !preview.isFetching ? <PreviewView preview={shown} /> : null}

        {/* Asked only when the group's name is already taken there. */}
        {clash.length > 0 && !preview.isFetching ? (
          <Field label="Бүлгийн нэр давхцаж байна" hint={`Хоосон бол «${clash[0]!.to}» болно.`}>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={groupName}
                placeholder={clash[0]!.to}
                onChange={(event) => setGroupName(event.target.value)}
              />
            )}
          </Field>
        ) : null}

        {(attached.length > 0 || Object.keys(kept).length > 0) && !preview.isFetching ? (
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-caption font-semibold text-ink">
              Цэцэрлэгт аль хэдийн бүртгэлтэй хүүхэд — нэг бичлэг болгоно
            </legend>
            {[
              ...attached.map((child) => [child.soloChildId, child.name] as const),
              ...Object.entries(kept),
            ].map(([soloChildId, name]) => (
              <Checkbox
                key={soloChildId}
                label={`${name} — тусад нь үлдээх`}
                checked={Boolean(kept[soloChildId])}
                onChange={() => toggleKept(soloChildId, name)}
              />
            ))}
          </fieldset>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`${teacherName(workspace)}-г ${target?.name ?? "цэцэрлэг"}-т нэгтгэх үү?`}
        description="Нэгтгэлийг буцаах боломжгүй. Хүүхэд, эцэг эх, бүлэг цэцэрлэг рүү шилжиж, багш тэнд багш болно."
        confirmLabel="Нэгтгэх"
        pendingLabel="Нэгтгэж байна…"
        pending={runMerge.isPending}
        onConfirm={() => runMerge.mutate()}
      />
    </FormDialog>
  );
}

const TABLE_LABEL: Record<string, string> = {
  "children.kindergartenId": "Хүүхэд",
  "guardianships.kindergartenId": "Эцэг эхийн холбоос",
  "observations.kindergartenId": "Ажиглалт",
  "media_files.kindergartenId": "Зураг, файл",
  "assessments.kindergartenId": "Үнэлгээ",
  "attendance_records.kindergartenId": "Ирц",
  "access_subscriptions.kindergartenId": "Хандалтын төлбөр",
  "groups.kindergartenId": "Бүлэг",
};

function PreviewView({ preview }: { preview: SoloMergePreview }) {
  if (!preview.ok) {
    const refusal = preview.refusal;
    const message =
      refusal.kind === "duplicates"
        ? `Цэцэрлэгт ижил хүүхэд аль хэдийн бүртгэлтэй: ${refusal.children.map((c) => c.name).join(", ")}.`
        : refusal.kind === "blocked"
          ? `Багшийн орчинд нэгтгэх боломжгүй өгөгдөл байна: ${Object.keys(refusal.tables).join(", ")}.`
          : refusal.kind === "ambiguous"
            ? `Нэг хүүхэд цэцэрлэгийн хэд хэдэн хүүхэдтэй таарч байна: ${refusal.children.map((c) => c.name).join(", ")}. Тэдгээрийг тусад нь үлдээж болно.`
            : refusal.kind === "badGroup"
              ? "Сонгосон бүлэг тухайн цэцэрлэгийн одоогийн хичээлийн жилд алга."
              : refusal.kind === "noSchoolYear"
                ? "Цэцэрлэгт идэвхтэй хичээлийн жил алга."
                : refusal.kind === "conflict"
                  ? `Давхардал гарна (${refusal.constraint}).`
                  : "Нэгтгэх боломжгүй.";
    return <FormError message={message} />;
  }

  const { result } = preview;
  const rows = Object.entries(result.moved).filter(([key]) => key.endsWith(".kindergartenId"));
  return (
    <div className="rounded-row bg-sunken p-3 text-body" aria-live="polite">
      <p className="font-semibold text-ink">Шилжих өгөгдөл</p>
      <ul className="mt-1 grid grid-cols-2 gap-x-4 text-muted">
        {rows.map(([key, count]) => (
          <li key={key}>
            {TABLE_LABEL[key] ?? key.split(".")[0]}: {count}
          </li>
        ))}
      </ul>
      {result.intoExistingGroup
        ? null
        : result.groupsRenamed.map((g) => (
            <p key={g.from} className="mt-2 text-caption text-muted">
              «{g.from}» бүлэг «{g.to}» нэртэй болно.
            </p>
          ))}
      {result.childrenAttached.length > 0 ? (
        <p className="mt-2 text-caption text-muted">
          Цэцэрлэгийн бичлэгт нэгтгэгдэх хүүхэд: {result.childrenAttached.length}.
        </p>
      ) : null}
      {Object.keys(result.kept).length > 0 ? (
        <p className="mt-2 text-caption text-muted">
          Давхардах тул архивт үлдэх мөр:{" "}
          {Object.entries(result.kept)
            .map(([key, count]) => `${key.split(".")[0]} ${count}`)
            .join(", ")}
          . Юу ч устахгүй.
        </p>
      ) : null}
      <p className="mt-2 text-caption text-muted">
        Багшийн эрхлэгчийн эрх хасагдаж, тухайн цэцэрлэгт багш болно.
      </p>
    </div>
  );
}
