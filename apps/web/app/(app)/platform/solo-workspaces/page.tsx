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
import { PlatformPageHeading } from "@/components/platform/platform-page-heading";
import { SoloTeachersTable } from "@/components/platform/solo-teachers-table";
import { RequireSuperAdmin } from "@/components/shell/require-role";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { FormError } from "@/components/ui/states";
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

  return (
    <div className="flex flex-col gap-5 pb-8">
      <PlatformPageHeading
        title="Бие даасан багш"
        lede="Цэцэрлэг гэрээ байгуулахад багшийн орчныг тэр цэцэрлэгт нэгтгэнэ. Юу ч устахгүй."
        mark={<UserRound />}
      />

      <SoloTeachersTable onMerge={setMerging} />

      {merging ? <MergeDialog workspace={merging} onClose={() => setMerging(null)} /> : null}
    </div>
  );
}

function MergeDialog({ workspace, onClose }: { workspace: SoloWorkspace; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [targetId, setTargetId] = useState("");
  const [groupName, setGroupName] = useState("");
  /** D3b — "" moves the teacher's group in as a group of its own. */
  const [targetGroupId, setTargetGroupId] = useState("");
  /** D3b — matched children the operator says are different children. */
  const [keepSeparate, setKeepSeparate] = useState<string[]>([]);
  /** Every match any preview has shown, so a child kept separate can be ticked back. */
  const [matched, setMatched] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<SoloMergePreview | null>(null);
  /** A change since the last preview: «Нэгтгэх» waits for a fresh one. */
  const [stale, setStale] = useState(false);

  const kindergartens = useQuery({
    queryKey: ["platform", "kindergartens", "merge-targets"],
    queryFn: () => get("/platform/kindergartens?page=1&pageSize=100", kindergartensSchema),
  });

  const body = () => ({
    targetKindergartenId: targetId,
    ...(groupName.trim() ? { groupName: groupName.trim() } : {}),
    ...(targetGroupId ? { targetGroupId } : {}),
    ...(keepSeparate.length > 0 ? { keepSeparate } : {}),
  });

  const runPreview = useMutation({
    mutationFn: () =>
      mutate(`/platform/solo-workspaces/${workspace.id}/merge-preview`, soloMergePreviewSchema, {
        method: "POST",
        body: body(),
      }),
    onSuccess: (next) => {
      setPreview(next);
      setStale(false);
      if (next.ok) {
        setMatched((seen) => ({
          ...seen,
          ...Object.fromEntries(next.result.childrenAttached.map((c) => [c.soloChildId, c.name])),
        }));
      }
    },
  });

  const runMerge = useMutation({
    mutationFn: () =>
      mutate(`/platform/solo-workspaces/${workspace.id}/merge`, soloMergeResultSchema, {
        method: "POST",
        body: body(),
      }),
    onSuccess: () => {
      toast.success("Багшийн орчныг цэцэрлэгт нэгтгэлээ.");
      void queryClient.invalidateQueries({ queryKey: ["platform"] });
      onClose();
    },
  });

  const busy = runPreview.isPending || runMerge.isPending;
  const ready = preview?.ok === true && !stale;
  const changed = () => setStale(true);

  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && !busy && onClose()}
      title={`${workspace.name} — нэгтгэх`}
      description="Хүүхэд, бүлэг, эцэг эх, ажиглалт, төлбөр бүгд сонгосон цэцэрлэг рүү шилжинэ. Багш тэнд багш болно."
      busy={busy}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            Болих
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!targetId || busy}
            onClick={() => runPreview.mutate()}
          >
            Урьдчилан харах
          </Button>
          <Button size="sm" disabled={!ready || busy} onClick={() => runMerge.mutate()}>
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
              : runPreview.error
                ? errorMessage(runPreview.error)
                : null
          }
        />

        <Field label="Цэцэрлэг" required>
          {({ id }) => (
            <Select
              id={id}
              value={targetId}
              onChange={(event) => {
                setTargetId(event.target.value);
                setTargetGroupId("");
                setKeepSeparate([]);
                setMatched({});
                setPreview(null);
              }}
            >
              <option value="">Сонгоно уу</option>
              {(kindergartens.data?.items ?? []).map((kg) => (
                <option key={kg.id} value={kg.id}>
                  {kg.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {preview && preview.targetGroups.length > 0 ? (
          <Field label="Бүлэг">
            {({ id }) => (
              <Select
                id={id}
                value={targetGroupId || "__new"}
                onChange={(event) => {
                  setTargetGroupId(event.target.value === "__new" ? "" : event.target.value);
                  changed();
                }}
              >
                <option value="__new">Шинэ бүлэг болж орно</option>
                {preview.targetGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name} бүлэгт нэгтгэх
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}

        {!targetGroupId ? (
          <Field label="Бүлгийн нэр (давхцвал)">
            {({ id }) => (
              <Input
                id={id}
                value={groupName}
                placeholder="Хоосон бол «… (бие даасан)»"
                onChange={(event) => {
                  setGroupName(event.target.value);
                  changed();
                }}
              />
            )}
          </Field>
        ) : null}

        {Object.keys(matched).length > 0 ? (
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-caption font-semibold text-ink">
              Цэцэрлэгт аль хэдийн бүртгэлтэй хүүхэд — бичлэгийг нь нэгтгэнэ
            </legend>
            {Object.entries(matched).map(([soloChildId, name]) => (
              <Checkbox
                key={soloChildId}
                label={`${name} — тусад нь үлдээх`}
                checked={keepSeparate.includes(soloChildId)}
                onChange={(event) => {
                  setKeepSeparate((current) =>
                    event.target.checked
                      ? [...current, soloChildId]
                      : current.filter((id) => id !== soloChildId),
                  );
                  changed();
                }}
              />
            ))}
          </fieldset>
        ) : null}

        {stale ? (
          <p className="text-caption text-muted">
            Өөрчлөлт орсон тул дахин «Урьдчилан харах» дарна уу.
          </p>
        ) : null}
        {preview && !stale ? <PreviewView preview={preview} /> : null}
      </div>
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
