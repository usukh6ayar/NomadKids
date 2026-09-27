"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CloudUpload } from "lucide-react";
import { useState } from "react";
import { esisWriteRequestSchema, type EsisWriteRequest } from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";

/**
 * Sending a group **to** ESIS — spec №3б's prepare → approve → send.
 *
 * ★ **The preview renders the payload's own keys.** What a director approves
 * has to be what gets sent, and a relabelled field is a description of a write
 * rather than the write. The keys are the ministry's; only the words around
 * them are ours. This is the client's instruction on output, applied to a
 * request instead of a response: "garaltiin utguudiig bugdiig ni haruulna nuuj
 * haaj bolohgui".
 *
 * ★★ The screen never composes a payload. It names a service and this group;
 * the server builds the body by copying the programme ids out of the ministry's
 * own rows (`esis-group-writes.ts`). A browser that could supply the JSON would
 * be a browser that could write anything into the ministry's register.
 *
 * ★★★ Deleting is deliberately not offered here. There is no undo on the other
 * side of 152's delete, and spec №3б §5 opens it only against a group this
 * system created in ESIS itself — a trial-month exercise, not a button on a
 * director's group screen.
 */
export function EsisGroupWrite(props: {
  kindergartenId: string;
  groupId: string;
  groupName: string;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [request, setRequest] = useState<EsisWriteRequest | null>(null);

  const prepare = useMutation({
    mutationFn: (service: "groupCreate" | "groupUpdate" | "groupInstructor") =>
      mutate(`/kindergartens/${props.kindergartenId}/esis/group-writes`, esisWriteRequestSchema, {
        method: "POST",
        body: { service, groupId: props.groupId },
      }),
    onSuccess: (prepared) => setRequest(prepared),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const approve = useMutation({
    mutationFn: (id: string) =>
      mutate(
        `/kindergartens/${props.kindergartenId}/esis/group-writes/${id}/approve`,
        esisWriteRequestSchema,
        { method: "POST", body: {} },
      ),
    onSuccess: () => {
      toast.success("ЭСИС рүү илгээхээр дараалалд орлоо.");
      setRequest(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "esis", props.kindergartenId] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const cancel = useMutation({
    mutationFn: (id: string) =>
      mutate(
        `/kindergartens/${props.kindergartenId}/esis/group-writes/${id}/cancel`,
        esisWriteRequestSchema,
        { method: "POST", body: {} },
      ),
    onSuccess: () => setRequest(null),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const busy = prepare.isPending || approve.isPending || cancel.isPending;

  if (!request) {
    return (
      <Card className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <CloudUpload size={18} aria-hidden className="shrink-0 text-primary" />
          <h2 className="text-body font-semibold text-ink">ЭСИС</h2>
        </div>
        <p className="text-caption text-muted">
          Бүлгийн мэдээллийг Боловсролын ЭСИС систем рүү илгээнэ. Илгээхээс өмнө яг ямар өгөгдөл
          явахыг бүтнээр нь харуулна.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={busy} onClick={() => prepare.mutate("groupCreate")}>
            ЭСИС-д бүртгүүлэх
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => prepare.mutate("groupUpdate")}
          >
            Засварыг илгээх
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => prepare.mutate("groupInstructor")}
          >
            Багш тохируулах
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-body font-semibold text-ink">
          {SERVICE_LABEL[request.service] ?? request.service}
        </h2>
        <p className="text-caption text-muted">API {request.apiId}</p>
      </div>

      <p className="text-caption text-muted">
        Доорх утгууд яг ийм хэлбэрээр ЭСИС рүү илгээгдэнэ. Талбарын нэрс нь ЭСИС-ийнх.
      </p>

      <dl className="flex flex-col gap-1.5 overflow-x-auto rounded-control bg-sunken p-3">
        {Object.entries(request.payload).map(([key, value]) => (
          <div key={key} className="flex items-baseline justify-between gap-4">
            <dt className="shrink-0 font-mono text-caption text-muted">{key}</dt>
            <dd className="break-all text-right text-body text-ink">{String(value)}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={busy} onClick={() => approve.mutate(request.id)}>
          Батлах
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => cancel.mutate(request.id)}
        >
          Болих
        </Button>
      </div>
    </Card>
  );
}

const SERVICE_LABEL: Record<string, string> = {
  groupCreate: "Бүлэг үүсгэх",
  groupUpdate: "Бүлэг засах",
  groupDelete: "Бүлэг устгах",
  groupInstructor: "Бүлгийн багш тохируулах",
};

/** Exported for the queue screen, which labels the same four services. */
export { SERVICE_LABEL as ESIS_WRITE_SERVICE_LABEL };
