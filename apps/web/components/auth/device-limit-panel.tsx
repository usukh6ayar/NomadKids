"use client";

import { useMutation } from "@tanstack/react-query";
import { Laptop, LogOut, Smartphone, Tablet } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";
import { mutate } from "@/lib/api/browser";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import {
  DEVICE_LIMIT_CODE,
  describeDevice,
  loginDevicesSchema,
  type DeviceKind,
} from "@/lib/devices";
import { formatDateTime } from "@/lib/format";

const ICON: Record<DeviceKind, typeof Laptop> = {
  phone: Smartphone,
  tablet: Tablet,
  computer: Laptop,
};

/** The sign-in refusal that means «two devices already» — see `lib/devices.ts`. */
export function isDeviceLimit(error: unknown): boolean {
  return (
    error instanceof ApiError && error.status === 409 && error.problem.code === DEVICE_LIMIT_CODE
  );
}

/**
 * Shown in the login card when this account is already signed in on its limit
 * of devices (2026-10-12, the user). A person who lost a phone cannot reach
 * «Хувийн тохиргоо» on it, so the way out has to be here: the password they
 * just typed lists the devices again, and choosing one signs it out and this
 * one in.
 */
export function DeviceLimitPanel({
  identifier,
  password,
  message,
  pending,
  onReplace,
  onCancel,
}: {
  identifier: string;
  password: string;
  /**
   * The 409's own sentence — it names the limit, which is a deployment
   * setting (`AUTH_DEVICE_LIMIT`), not a number this screen may assume.
   */
  message?: string | null;
  /** The sign-in that replaces a device is running. */
  pending: boolean;
  onReplace: (sessionId: string) => void;
  onCancel: () => void;
}) {
  const devices = useMutation({
    mutationFn: () =>
      mutate("/auth/login/devices", loginDevicesSchema, {
        method: "POST",
        body: { identifier, password },
      }),
  });

  // Asked once, when the panel opens; the credentials do not change under it.
  const { mutate: listDevices } = devices;
  useEffect(() => {
    listDevices();
  }, [listDevices]);

  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-control bg-[#fff6ec] p-3.5 ring-1 ring-[#fbe3c8]"
    >
      <p className="text-body font-semibold text-[#9a3412]">
        {message ??
          "Та зөвшөөрөгдсөн тооны төхөөрөмжөөс нэвтэрсэн байна. Аль нэгийг нь гаргаад энд нэвтэрнэ үү."}
      </p>

      {devices.isPending ? (
        <p className="text-caption text-slate-500">Төхөөрөмжүүдийг ачаалж байна…</p>
      ) : devices.isError ? (
        <p className="text-caption text-slate-600">
          {isNotFound(devices.error)
            ? "Нэвтэрсэн төхөөрөмжийнхөө аль нэгээс «Хувийн тохиргоо» → «Бүртгэлтэй төхөөрөмж» хэсэгт орж гарна уу."
            : errorMessage(devices.error)}
        </p>
      ) : devices.data ? (
        <ul className="flex flex-col gap-2">
          {devices.data.sessions.map((session) => {
            const { label, kind } = describeDevice(session.userAgent);
            const Icon = ICON[kind];
            return (
              <li key={session.id}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => onReplace(session.id)}
                  className="flex min-h-12 w-full items-center gap-3 rounded-control bg-white px-3 py-2 text-left ring-1 ring-[#f5d8b9] hover:bg-[#fffaf4] disabled:opacity-60"
                >
                  <Icon className="size-5 shrink-0 text-slate-500" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-semibold text-ink">{label}</span>
                    <span className="block text-caption text-slate-500">
                      Сүүлд: {formatDateTime(session.lastUsedAt ?? session.createdAt)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-caption font-bold text-[#c2410c]">
                    <LogOut className="size-4" aria-hidden="true" />
                    Гаргах
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <Button type="button" size="sm" variant="secondary" onClick={onCancel} className="self-start">
        Болих
      </Button>
    </div>
  );
}
