"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  paginated,
  platformKindergartenSchema,
  soloMergePreviewSchema,
  soloMergeResultSchema,
  soloWorkspaceSchema,
  type SoloMergePreview,
  type SoloWorkspace,
} from "@kinder/contracts";
import { UserRound } from "lucide-react";
import { useState } from "react";
import { PlatformPageHeading } from "@/components/platform/platform-page-heading";
import { RequireSuperAdmin } from "@/components/shell/require-role";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { EmptyState, ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { formatDate } from "@/lib/format";

const workspacesSchema = paginated(soloWorkspaceSchema);
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

function SoloWorkspaces() {
  const list = useQuery({
    queryKey: ["platform", "solo-workspaces"],
    queryFn: () => get("/platform/solo-workspaces?page=1&pageSize=100", workspacesSchema),
  });
  const [merging, setMerging] = useState<SoloWorkspace | null>(null);
  const items = list.data?.items ?? [];

  return (
    <div className="flex flex-col gap-6 pb-8">
      <PlatformPageHeading
        title="Бие даасан багш"
        lede="Цэцэрлэг гэрээ байгуулахад багшийн орчныг тэр цэцэрлэгт нэгтгэнэ. Юу ч устахгүй."
        mark={<UserRound />}
      />

      {list.isLoading ? <LoadingState rows={3} /> : null}
      {list.error ? <ErrorState description={errorMessage(list.error)} /> : null}
      {list.data && items.length === 0 ? (
        <EmptyState
          title="Бие даасан багш алга"
          description="Багш «Үнийн санал» хуудаснаас бүртгүүлэхэд энд харагдана."
        />
      ) : null}

      <ul className="flex flex-col gap-3">
        {items.map((workspace) => (
          <li key={workspace.id}>
            <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-lead font-bold text-ink">{workspace.name}</p>
                <p className="text-caption text-muted">
                  {[workspace.phone, workspace.email, workspace.location]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <p className="text-caption text-muted">
                  Ажилладаг: {workspace.workplace ?? "—"} · {workspace.childCount} хүүхэд ·{" "}
                  {formatDate(workspace.createdAt)}
                </p>
              </div>
              <Button size="sm" onClick={() => setMerging(workspace)}>
                Цэцэрлэгт нэгтгэх
              </Button>
            </Card>
          </li>
        ))}
      </ul>

      {merging ? <MergeDialog workspace={merging} onClose={() => setMerging(null)} /> : null}
    </div>
  );
}

function MergeDialog({ workspace, onClose }: { workspace: SoloWorkspace; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [targetId, setTargetId] = useState("");
  const [groupName, setGroupName] = useState("");
  const [preview, setPreview] = useState<SoloMergePreview | null>(null);

  const kindergartens = useQuery({
    queryKey: ["platform", "kindergartens", "merge-targets"],
    queryFn: () => get("/platform/kindergartens?page=1&pageSize=100", kindergartensSchema),
  });

  const body = () => ({
    targetKindergartenId: targetId,
    ...(groupName.trim() ? { groupName: groupName.trim() } : {}),
  });

  const runPreview = useMutation({
    mutationFn: () =>
      mutate(`/platform/solo-workspaces/${workspace.id}/merge-preview`, soloMergePreviewSchema, {
        method: "POST",
        body: body(),
      }),
    onSuccess: setPreview,
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
  const ready = preview?.ok === true;

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

        <Field label="Бүлгийн нэр (давхцвал)">
          {({ id }) => (
            <Input
              id={id}
              value={groupName}
              placeholder="Хоосон бол «… (бие даасан)»"
              onChange={(event) => {
                setGroupName(event.target.value);
                setPreview(null);
              }}
            />
          )}
        </Field>

        {preview ? <PreviewView preview={preview} /> : null}
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
        ? `Цэцэрлэгт ижил хүүхэд аль хэдийн бүртгэлтэй: ${refusal.children.map((c) => c.name).join(", ")}. Эдгээрийг нэгтгэх боломж дараагийн шатанд нэмэгдэнэ.`
        : refusal.kind === "blocked"
          ? `Багшийн орчинд нэгтгэх боломжгүй өгөгдөл байна: ${Object.keys(refusal.tables).join(", ")}.`
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
      {result.groupsRenamed.map((g) => (
        <p key={g.from} className="mt-2 text-caption text-muted">
          «{g.from}» бүлэг «{g.to}» нэртэй болно.
        </p>
      ))}
      <p className="mt-2 text-caption text-muted">
        Багшийн эрхлэгчийн эрх хасагдаж, тухайн цэцэрлэгт багш болно.
      </p>
    </div>
  );
}
