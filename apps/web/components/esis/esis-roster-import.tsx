"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { DownloadCloud } from "lucide-react";
import { esisRosterImportSchema, type EsisRosterImport } from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";

/**
 * Pulls this kindergarten's groups and children out of ESIS — 2026-09-20, the
 * client: "esis ees shuud buleg bolon buleg dotorh huuhduud ni irehgui ymuu?
 * tged irwel shuud hadgalchmaar baina."
 *
 * ★ **Confirmed before it runs, and not because it is dangerous.** It adds and
 * updates and never removes, so the risk is not damage — it is surprise. A
 * director pressing this on a kindergarten that already has children typed in
 * should know beforehand that ninety of them are about to appear, which is
 * what §5's "confirm before delete" rule is really about: no press should
 * produce a screen the presser did not expect.
 *
 * ★★ **No preview step**, at the client's explicit instruction ("шууд
 * хадгалчмаар байна"). What makes that safe is that the import is idempotent —
 * a second press changes nothing the first did not — rather than a dialog
 * nobody reads twice.
 */
export function EsisRosterImportButton({ kindergartenId }: { kindergartenId: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);

  const run = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/esis/roster-import`, esisRosterImportSchema, {
        method: "POST",
      }),
    onSuccess: (result) => {
      setConfirming(false);
      toast.success(summarise(result));

      /*
       * ★ Everything this touched, invalidated by prefix rather than by key.
       * The import writes groups, children and enrolments at once, and a
       * screen still showing "0 хүүхэд" beside a toast saying ninety arrived
       * is the version of this feature that gets reported as broken.
       */
      void queryClient.invalidateQueries({ queryKey: ["admin", "groups"] });
      void queryClient.invalidateQueries({ queryKey: ["children"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });

      /*
       * ★★ The two lists are a second toast, not a longer first one. They are
       * the half a director has to act on — a group nobody imported, a child
       * nobody could place — and burying them at the end of a success sentence
       * is how they go unread.
       */
      const unresolved = [
        result.groups.skipped.length > 0
          ? `Оруулаагүй бүлэг: ${result.groups.skipped.join(", ")}`
          : null,
        result.enrollments.unplaced.length > 0
          ? `Бүлэггүй үлдсэн ${result.enrollments.unplaced.length} хүүхэд: ${result.enrollments.unplaced.slice(0, 5).join(", ")}${result.enrollments.unplaced.length > 5 ? "…" : ""}`
          : null,
      ].filter(Boolean);

      if (unresolved.length > 0) toast.error(unresolved.join(" · "));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <ConfirmDialog
      open={confirming}
      onOpenChange={setConfirming}
      trigger={
        <Button variant="secondary" size="sm">
          <DownloadCloud size={16} aria-hidden="true" />
          ESIS-ээс татах
        </Button>
      }
      title="ESIS-ээс бүлэг, хүүхэд татах"
      description="ESIS дээрх бүлгүүд болон тэдгээрт бүртгэлтэй хүүхдүүдийг энэ цэцэрлэгийн бүртгэлд үүсгэнэ. Байгаа мэдээллийг шинэчилнэ, юу ч устгахгүй. Дахин татахад давхардахгүй."
      confirmLabel="Татах"
      pendingLabel="Татаж байна…"
      pending={run.isPending}
      onConfirm={() => run.mutate()}
    />
  );
}

/**
 * What happened, in one sentence.
 *
 * ★ A run that changed nothing says so plainly. "0 бүлэг, 0 хүүхэд" reads as a
 * failure; "бүх мэдээлэл шинэчлэгдсэн байна" is the same fact told as the
 * success it is — and re-running is the expected way to use this.
 */
function summarise(result: EsisRosterImport): string {
  const parts = [
    result.groups.created > 0 ? `${result.groups.created} бүлэг нэмэгдлээ` : null,
    result.children.created > 0 ? `${result.children.created} хүүхэд нэмэгдлээ` : null,
    result.enrollments.created > 0 ? `${result.enrollments.created} хүүхэд бүлэгт орлоо` : null,
    result.enrollments.moved > 0 ? `${result.enrollments.moved} хүүхэд бүлэг сольсон` : null,
  ].filter(Boolean);

  if (parts.length === 0)
    return "Шинээр нэмэгдэх зүйл олдсонгүй — бүх мэдээлэл шинэчлэгдсэн байна.";
  return parts.join(", ") + ".";
}
