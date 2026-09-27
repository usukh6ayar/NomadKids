"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { deletedKindergartenSchema } from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { FormError } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";

/**
 * Retiring a kindergarten — the third of the operator's three verbs, beside
 * Идэвхжүүлэх and Идэвхгүй болгох.
 *
 * ★ Why it is not a `window.confirm` like the toggle beside it.
 *
 * Deactivating is a suspension: nothing changes except that nobody can sign
 * in, and one more click puts it back. This closes every membership in the
 * tenant at once — a director and all their staff — and the operator cannot
 * undo it from any screen. The API asks for the kindergarten's name to be
 * typed back for that reason (`PlatformService.remove`), and this dialog is
 * where they read what is about to happen before they type it.
 *
 * ★★ The counts come from the row, not from a second request. They are the
 * same figures `/platform` already shows; asking the server again would put a
 * spinner in front of a warning, and the API repeats them in its response
 * anyway — which is what the toast reports, so the number the operator is told
 * afterwards is the one that was actually true at the moment of deletion.
 *
 * ★★★ Nothing is destroyed. `deletedAt` on the tenant, the memberships closed,
 * the ESIS mapping released — the children, portfolios, invoices and the audit
 * trail all stay (CLAUDE.md §3.2). The copy says "устгах" because that is what
 * the client asked for and what the operator means; it does not promise
 * erasure, and the dialog says so in a line rather than implying it.
 */
export function DeleteKindergartenButton({
  kindergarten,
  onDeleted,
}: {
  kindergarten: { id: string; name: string; isActive: boolean };
  /** The detail page navigates away; the list just refetches. */
  onDeleted?: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");

  const remove = useMutation({
    mutationFn: () =>
      mutate(`/platform/kindergartens/${kindergarten.id}`, deletedKindergartenSchema, {
        method: "DELETE",
        body: { confirmName },
      }),
    onSuccess: (result) => {
      toast.success(`${result.name} устлаа. ${result.closedMemberships} хүний эрх хаагдсан.`);
      void queryClient.invalidateQueries({ queryKey: ["platform", "kindergartens"] });
      void queryClient.invalidateQueries({ queryKey: qk.platformStats() });
      setOpen(false);
      setConfirmName("");
      onDeleted?.();
    },
  });

  // Checked here as well as on the server: the point of retyping is that the
  // operator reads the name, and a button that stays dim until they have is a
  // clearer way of saying so than an error after the fact.
  const typedCorrectly =
    confirmName.trim().toLocaleLowerCase("mn-MN") ===
    kindergarten.name.trim().toLocaleLowerCase("mn-MN");

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-danger hover:bg-danger-soft"
        onClick={() => setOpen(true)}
      >
        <Trash2 size={16} aria-hidden />
        Устгах
      </Button>

      <FormDialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setConfirmName("");
          setOpen(next);
        }}
        busy={remove.isPending}
        title={`${kindergarten.name} — устгах`}
        description="Энэ үйлдлийг буцаах боломжгүй. Цэцэрлэгийн бүх ажилтан, эцэг эхийн эрх хаагдана."
        footer={
          <>
            <Button
              type="submit"
              form="delete-kindergarten-form"
              variant="danger"
              disabled={!typedCorrectly || remove.isPending}
            >
              {remove.isPending ? "Устгаж байна…" : "Устгах"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={remove.isPending}
            >
              Болих
            </Button>
          </>
        }
      >
        <form
          id="delete-kindergarten-form"
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (typedCorrectly && !remove.isPending) remove.mutate();
          }}
        >
          <FormError message={remove.isError ? errorMessage(remove.error) : null} />

          {kindergarten.isActive ? (
            <p className="rounded-control bg-sun px-3 py-2 text-caption leading-relaxed text-sun-ink">
              Энэ цэцэрлэг одоо <strong>идэвхтэй</strong> байна. Түр зогсоох л бол «Идэвхгүй болгох»
              товчийг ашиглаарай — түүнийг дараа нь нэг товшилтоор буцаана.
            </p>
          ) : null}

          <p className="text-body leading-relaxed text-muted">
            Хүүхдийн бүртгэл, хавтас, нэхэмжлэх, үйлдлийн түүх{" "}
            <strong className="text-ink">устахгүй</strong> — тэдгээр нь архивлагдана. Устах нь
            цэцэрлэг жагсаалтаас алга болж, ESIS холболт нь салж, нэвтрэх эрх бүхэлдээ хаагдана.
          </p>

          <Field
            label="Баталгаажуулахын тулд цэцэрлэгийн нэрийг бичнэ үү"
            hint={kindergarten.name}
            required
          >
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={confirmName}
                onChange={(event) => setConfirmName(event.target.value)}
                autoComplete="off"
                autoFocus
              />
            )}
          </Field>
        </form>
      </FormDialog>
    </>
  );
}
