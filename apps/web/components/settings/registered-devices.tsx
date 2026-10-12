"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Laptop, Smartphone, Tablet } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { LoadingState } from "@/components/ui/states";
import { useToast } from "@/components/ui/toast";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import {
  describeDevice,
  deviceSessionsSchema,
  type DeviceKind,
  type DeviceSession,
} from "@/lib/devices";
import { formatDateTime } from "@/lib/format";

const ICON: Record<DeviceKind, typeof Laptop> = {
  phone: Smartphone,
  tablet: Tablet,
  computer: Laptop,
};

/**
 * «Бүртгэлтэй төхөөрөмж» — the last card of «Хувийн тохиргоо» (the user,
 * 2026-10-12). Each account signs in from at most `limit` devices; this is
 * where a person sees them and signs one out to make room. The contract is in
 * `lib/devices.ts`; while the API does not answer, the card says so.
 *
 * The device this page is open on has no «Гаргах»: signing yourself out is
 * the shell menu's «Гарах», and doing it from here would end the page.
 */
export function RegisteredDevicesCard() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<DeviceSession | null>(null);

  const devices = useQuery({
    queryKey: qk.devices(),
    queryFn: () => get("/auth/sessions", deviceSessionsSchema),
    retry: false,
  });

  const remove = useMutation({
    mutationFn: (id: string) => mutate(`/auth/sessions/${id}`, z.unknown(), { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Төхөөрөмжийг гаргалаа.");
      setRemoving(null);
      void queryClient.invalidateQueries({ queryKey: qk.devices() });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const count = devices.data ? `${devices.data.sessions.length}/${devices.data.limit}` : null;

  return (
    <Card pad="roomy" className="flex flex-col gap-4">
      <SectionHeader
        title={count ? `Бүртгэлтэй төхөөрөмж (${count})` : "Бүртгэлтэй төхөөрөмж"}
        lede="Нэг бүртгэлээр 2 төхөөрөмжөөс нэвтэрнэ. Шинэ төхөөрөмжөөс орохын тулд аль нэгийг нь гаргана уу."
      />

      {devices.isPending ? (
        <LoadingState label="Төхөөрөмжүүдийг ачаалж байна…" />
      ) : devices.isError ? (
        <p className="rounded-control bg-canvas px-3.5 py-3 text-caption text-muted">
          {isNotFound(devices.error)
            ? "Төхөөрөмжийн жагсаалт удахгүй нээгдэнэ."
            : errorMessage(devices.error)}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border-soft">
          {devices.data.sessions.map((session) => {
            const { label, kind } = describeDevice(session.userAgent);
            const Icon = ICON[kind];
            return (
              <li key={session.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span className="grid size-10 shrink-0 place-items-center rounded-control bg-canvas text-muted">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-ink">{label}</p>
                  <p className="text-caption text-muted">
                    Сүүлд: {formatDateTime(session.lastUsedAt ?? session.createdAt)}
                  </p>
                </div>
                {session.current ? (
                  <span className="shrink-0 text-caption font-semibold text-mint-ink">
                    Энэ төхөөрөмж
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setRemoving(session)}
                    aria-label={`${label} төхөөрөмжийг гаргах`}
                  >
                    Гаргах
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(next) => (next ? undefined : setRemoving(null))}
        title="Төхөөрөмжийг гаргах уу?"
        description={
          removing
            ? `${describeDevice(removing.userAgent).label} төхөөрөмж системээс гарна. Дахин орохдоо нууц үгээ оруулна.`
            : ""
        }
        confirmLabel="Гаргах"
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => (removing ? remove.mutate(removing.id) : undefined)}
      />
    </Card>
  );
}
