"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { Printer, UsersRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  ROLE_LABEL,
  ROSTER_INVITABLE_ROLES,
  rosterInvitationsSchema,
  type Role,
  type RosterInvitations,
} from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { FormError } from "@/components/ui/states";
import { BRAND } from "@/lib/vocabulary";
import { fullName } from "@/lib/format";

/**
 * «Бүх багшийг урих» — one QR card per member of staff on the ESIS roster who
 * has no account yet, the same way «Бүх эцэг эхийг урих» works for families
 * (the client, 2026-10-15).
 *
 * ★ Each card opens exactly one account, already linked to that person's ESIS
 * record, so there is no «Холбох» afterwards. The person scans it, proves
 * their phone and chooses a password; the name is the ministry's and is not
 * asked again. The director hands each card to the person named on it — that
 * hand-over is what makes the link right.
 *
 * `esisPersonId` narrows it to one person — «Урих» on a single row — and
 * there the director picks the role: ESIS gives a PE or music teacher the
 * class teacher's job code, so it cannot choose for them (2026-10-15).
 */
export function RosterStaffInvitations({
  kindergartenId,
  esisPersonId,
  suggestedRole,
  label = "Бүх багшийг урих",
  invalidateKeys,
  size = "sm",
  variant = "secondary",
}: {
  kindergartenId: string;
  esisPersonId?: string;
  /** The job code's role, preselected; `null` — the director must choose. */
  suggestedRole?: Role | null;
  label?: string;
  /** Query keys to refresh once the accounts exist. */
  invalidateKeys: readonly (readonly unknown[])[];
  size?: "sm" | "md";
  variant?: "primary" | "secondary";
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const single = esisPersonId !== undefined;
  const preset = (ROSTER_INVITABLE_ROLES as readonly string[]).includes(suggestedRole ?? "")
    ? (suggestedRole as Role)
    : "";
  const [role, setRole] = useState<Role | "">(preset);

  const invite = useMutation({
    mutationFn: () =>
      mutate(`/kindergartens/${kindergartenId}/staff-invitations`, rosterInvitationsSchema, {
        method: "POST",
        body: single ? { esisPersonId, ...(role ? { role } : {}) } : {},
      }),
  });

  /*
   * ★ The lists refresh on close, never on success. The person just invited
   * leaves the unclaimed list — and with them the row this button lives in —
   * so refreshing while the sheet is open would unmount it, and the one-time
   * codes would be gone before anyone printed them.
   */
  const close = () => {
    const created = invite.isSuccess;
    setOpen(false);
    invite.reset();
    setRole(preset);
    if (created) {
      for (const queryKey of invalidateKeys) void queryClient.invalidateQueries({ queryKey });
    }
  };

  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        <UsersRound size={16} aria-hidden />
        {label}
      </Button>

      {open ? (
        <ModalOverlay label={label} onClose={close}>
          <div className="w-full max-w-[860px] rounded-card border border-border bg-surface p-5 print:max-w-none print:border-0 print:p-0 print:shadow-none">
            {invite.data ? (
              <Sheet result={invite.data} onClose={close} />
            ) : (
              <div className="flex flex-col gap-4">
                <div>
                  <h2 className="text-title font-semibold text-ink">{label}</h2>
                  <p className="mt-0.5 text-body leading-relaxed text-muted">
                    {single
                      ? "Энэ хүнд нэг урилга үүснэ."
                      : "ЭСИС-д бүртгэлтэй, системд бүртгүүлээгүй ажилтан бүрд нэг урилга үүснэ. Эрх олгох боломжгүй албан тушаалыг (жижүүр, эрхлэгч) алгасна."}
                  </p>
                </div>

                <FormError message={invite.isError ? errorMessage(invite.error) : null} />

                {single ? (
                  <Field label="Эрх" required>
                    {({ id, describedBy }) => (
                      <Select
                        id={id}
                        aria-describedby={describedBy}
                        value={role}
                        onChange={(e) => setRole(e.target.value as Role | "")}
                      >
                        {preset ? null : <option value="">Эрх сонгоно уу</option>}
                        {ROSTER_INVITABLE_ROLES.map((value) => (
                          <option key={value} value={value}>
                            {ROLE_LABEL[value]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                ) : null}

                <p className="rounded-control bg-canvas px-3.5 py-2.5 text-caption leading-relaxed text-muted">
                  Ажилтан QR-аа уншуулаад утасны дугаараа баталгаажуулж, нууц үгээ үүсгэнэ. Бүртгэл
                  нь ЭСИС-ийн бүртгэлтэйгээ <strong>автоматаар холбогдоно</strong>. QR бүрийг нэр
                  бүхий хүнд нь гардуулна уу. Урилга 7 хоног хүчинтэй.
                </p>

                <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                  <Button
                    onClick={() => invite.mutate()}
                    disabled={invite.isPending || (single && !role)}
                  >
                    <UsersRound size={18} aria-hidden />
                    {invite.isPending ? "Үүсгэж байна…" : "Урилга үүсгэх"}
                  </Button>
                  <Button variant="ghost" onClick={close} disabled={invite.isPending}>
                    Болих
                  </Button>
                </div>
              </div>
            )}
          </div>
        </ModalOverlay>
      ) : null}
    </>
  );
}

function Sheet({ result, onClose }: { result: RosterInvitations; onClose: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div className="min-w-0">
          <h2 className="text-title font-semibold text-ink">{result.items.length} урилга бэлэн</h2>
          {result.skipped > 0 ? (
            <p className="mt-0.5 text-body text-muted">
              {result.skipped} хүнийг албан тушаалд нь эрх олгох боломжгүй тул алгассан.
            </p>
          ) : null}
        </div>

        <span className="flex flex-wrap gap-2">
          {result.items.length > 0 ? (
            <Button onClick={() => window.print()}>
              <Printer size={18} aria-hidden />
              Хэвлэх
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Хаах
          </Button>
        </span>
      </div>

      {result.items.length === 0 ? (
        <p className="rounded-control bg-canvas px-3.5 py-2.5 text-body text-muted print:hidden">
          Урих ажилтан алга — ЭСИС-ийн жагсаалтын бүх ажилтан бүртгэлтэй байна.
        </p>
      ) : (
        <>
          <p className="hidden text-body font-semibold text-ink print:block">{BRAND} урилга</p>

          <p className="rounded-control bg-sun px-3.5 py-2.5 text-caption leading-relaxed text-sun-ink print:hidden">
            Энэ жагсаалтыг одоо хэвлээрэй. Цонхыг хаасны дараа кодуудыг дахин харуулахгүй.
          </p>

          <ul className="grid gap-3 sm:grid-cols-2 print:grid-cols-2 print:gap-2">
            {result.items.map((item) => (
              <InvitationCard
                key={item.esisPersonId}
                name={fullName(item)}
                role={ROLE_LABEL[item.role]}
                token={item.invitationToken}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** One person's card: their name above the QR, the link written out beneath. */
function InvitationCard({ name, role, token }: { name: string; role: string; token: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const url = typeof window === "undefined" ? "" : `${window.location.origin}/invitation/${token}`;

  useEffect(() => {
    if (!canvasRef.current || !url) return;
    void QRCode.toCanvas(canvasRef.current, url, { width: 150, margin: 1 });
  }, [url]);

  return (
    <li className="flex flex-col items-center gap-2 rounded-card border border-border p-4 text-center [break-inside:avoid]">
      <span className="block text-title font-bold leading-heading text-ink">{name}</span>
      <span className="-mt-1 block text-caption text-muted">{role}</span>
      <canvas ref={canvasRef} role="img" aria-label={`${name} — урилгын QR код`} />
      <span className="block text-caption leading-relaxed text-muted">
        Утсаараа уншуулна уу. 7 хоног хүчинтэй.
      </span>
      <span className="block break-all text-caption text-muted">{url}</span>
    </li>
  );
}
