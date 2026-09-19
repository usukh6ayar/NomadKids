"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { Printer, UsersRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { groupGuardianInvitationsSchema, type GroupGuardianInvitations } from "@kinder/contracts";
import { mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { Button } from "@/components/ui/button";
import { ModalOverlay } from "@/components/ui/modal-overlay";
import { FormError } from "@/components/ui/states";
import { BRAND } from "@/lib/vocabulary";

/**
 * One press, one invitation per child, and a sheet the teacher can print.
 *
 * ★ The problem, in the client's words (2026-09-19): "олон хүүхэдтэй бүлэг бол
 * эцэг эхийг бүртгэхэд хэцүү". A group of thirty meant pressing «Урих» thirty
 * times and reading thirty codes off a screen one parent at a time.
 *
 * ★★ **It is thirty invitations, not a group invitation**, and that is the
 * whole design. A single code for a group would be a shared secret granting
 * guardianship of *any* child in it, and a "pick your child" list would hand
 * every child's name to whoever held the code. Each token here is created
 * after the guardianship it belongs to, exactly as the per-child button does,
 * so it opens one portfolio and no other.
 *
 * ★★★ The output is paper because the delivery is physical. A teacher hands
 * each parent their own card at pick-up, or puts it in the child's cubby;
 * `@media print` drops the chrome and lays the cards out four to a page.
 * Nothing is e-mailed — this product has no address for these people yet, and
 * that is what the invitation is for.
 */
export function GroupGuardianInvitations({
  groupId,
  groupName,
}: {
  groupId: string;
  groupName: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const invite = useMutation({
    mutationFn: () =>
      mutate(`/groups/${groupId}/guardian-invitations`, groupGuardianInvitationsSchema, {
        method: "POST",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["children"] });
    },
  });

  const close = () => {
    setOpen(false);
    invite.reset();
  };

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <UsersRound size={18} aria-hidden />
        Бүх эцэг эхийг урих
      </Button>

      {open ? (
        <ModalOverlay label="Бүх эцэг эхийг урих" onClose={close}>
          <div className="w-full max-w-[860px] rounded-card border border-border bg-surface p-5 print:max-w-none print:border-0 print:p-0 print:shadow-none">
            {invite.data ? (
              <Sheet groupName={groupName} result={invite.data} onClose={close} />
            ) : (
              <Intro
                groupName={groupName}
                pending={invite.isPending}
                error={invite.isError ? errorMessage(invite.error) : null}
                onConfirm={() => invite.mutate()}
                onClose={close}
              />
            )}
          </div>
        </ModalOverlay>
      ) : null}
    </>
  );
}

function Intro({
  groupName,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  groupName: string;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-title font-semibold text-ink">Бүх эцэг эхийг урих</h2>
        <p className="mt-0.5 text-body leading-relaxed text-muted">
          {groupName} бүлгийн <strong>асран хамгаалагчгүй</strong> хүүхэд бүрд нэг урилга үүснэ. Аль
          хэдийн холбогдсон хүүхдийг алгасна.
        </p>
      </div>

      <FormError message={error} />

      <p className="rounded-control bg-canvas px-3.5 py-2.5 text-caption leading-relaxed text-muted">
        Урилга бүр <strong>яг нэг хүүхдийн</strong> хавтсыг нээнэ. Тиймээс QR-уудыг хэвлээд, хүүхэд
        тус бүрийнхийг нь зөв эцэг эхэд нь гардуулна уу. Урилга 7 хоног хүчинтэй.
      </p>

      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <Button onClick={onConfirm} disabled={pending}>
          <UsersRound size={18} aria-hidden />
          {pending ? "Үүсгэж байна…" : "Урилга үүсгэх"}
        </Button>
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          Болих
        </Button>
      </div>
    </div>
  );
}

function Sheet({
  groupName,
  result,
  onClose,
}: {
  groupName: string;
  result: GroupGuardianInvitations;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div className="min-w-0">
          <h2 className="text-title font-semibold text-ink">{result.items.length} урилга бэлэн</h2>
          <p className="mt-0.5 text-body text-muted">
            {result.skipped > 0
              ? `${result.skipped} хүүхэд аль хэдийн холбогдсон тул алгассан.`
              : "Бүлгийн бүх хүүхдэд урилга үүслээ."}
          </p>
        </div>

        <span className="flex flex-wrap gap-2">
          <Button onClick={() => window.print()}>
            <Printer size={18} aria-hidden />
            Хэвлэх
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Хаах
          </Button>
        </span>
      </div>

      {result.items.length === 0 ? (
        <p className="rounded-control bg-canvas px-3.5 py-2.5 text-body text-muted print:hidden">
          Урих хүүхэд алга — бүлгийн бүх хүүхэд аль хэдийн асран хамгаалагчтай.
        </p>
      ) : (
        <>
          {/*
            ★ Shown only on paper. On screen the heading above already says
            which group this is; on a printed sheet that has been carried to a
            corridor, nothing else does.
          */}
          <p className="hidden text-body font-semibold text-ink print:block">
            {groupName} — {BRAND} урилга
          </p>

          <p className="rounded-control bg-sun px-3.5 py-2.5 text-caption leading-relaxed text-sun-ink print:hidden">
            Энэ жагсаалтыг одоо хэвлээрэй. Цонхыг хаасны дараа кодуудыг дахин харуулахгүй —
            шаардлагатай бол хүүхэд тус бүрийн хуудаснаас дахин урина.
          </p>

          <ul className="grid gap-3 sm:grid-cols-2 print:grid-cols-2 print:gap-2">
            {result.items.map((item) => (
              <InvitationCard
                key={item.childId}
                name={`${item.lastName} ${item.firstName}`}
                token={item.invitationToken}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * One child's card: their name, a QR, and the link written out.
 *
 * ★ The URL in text beneath the code is not redundant. A parent whose camera
 * will not read a QR — an old phone, a cracked lens, a dim corridor — can type
 * it, and a teacher reading it down a telephone needs the characters.
 *
 * ★★ `break-inside: avoid` so a card is never split across two sheets of
 * paper. Half a QR is not a shorter QR.
 */
function InvitationCard({ name, token }: { name: string; token: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // `window.location.origin`, so the printed link works on whichever host it
  // was made from — localhost in development, the real domain in production.
  const url = typeof window === "undefined" ? "" : `${window.location.origin}/invitation/${token}`;

  useEffect(() => {
    if (!canvasRef.current || !url) return;
    void QRCode.toCanvas(canvasRef.current, url, { width: 150, margin: 1 });
  }, [url]);

  return (
    <li className="flex items-center gap-3 rounded-card border border-border p-3 [break-inside:avoid]">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`${name} — урилгын QR код`}
        className="shrink-0"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-lead font-semibold text-ink">{name}</span>
        <span className="mt-1 block text-caption leading-relaxed text-muted">
          Утсаараа уншуулна уу. 7 хоног хүчинтэй.
        </span>
        <span className="mt-1 block break-all text-caption text-muted">{url}</span>
      </span>
    </li>
  );
}
