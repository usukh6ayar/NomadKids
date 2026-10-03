"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { CheckCircle2, MessageSquareText } from "lucide-react";
import {
  phoneVerificationAvailabilitySchema,
  phoneVerificationCheckSchema,
  type PhoneVerificationCheckResponse,
  type PhoneVerificationStartResponse,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/states";

/** The number `User.phone` accepts — eight digits, first 5–9. */
export const MOBILE_PHONE = /^[5-9]\d{7}$/;

/** verify.mn asks for no faster than one status call every three seconds. */
const POLL_MS = 3_000;

/**
 * Whether this deployment verifies phones at all, and whether that is known
 * yet — a screen that is *only* phone verification has to tell "still asking"
 * from "off" before it can say which.
 *
 * ★ Anything but a clear `true` reads as off — a failed request included. Off
 * is how every flow behaved before verify.mn, and the server enforces the
 * same rule from its own setting, so a wrong guess here cannot let an
 * unproven phone through; at worst it shows a step the server would not ask
 * for.
 */
export function usePhoneVerificationAvailability(): { enabled: boolean; loading: boolean } {
  const { data, isPending } = useQuery({
    queryKey: qk.phoneVerificationAvailability(),
    queryFn: () => get("/phone-verifications/availability", phoneVerificationAvailabilitySchema),
    staleTime: 5 * 60_000,
    retry: false,
  });
  return { enabled: data?.enabled === true, loading: isPending };
}

export function usePhoneVerificationEnabled(): boolean {
  return usePhoneVerificationAvailability().enabled;
}

/**
 * One verify.mn proof, from "send me a code" to "the SMS arrived".
 *
 * The state behind every SMS step in the product — the compact
 * `PhoneVerificationStep` below and the full-page forgot-password flow, which
 * draws its own screen around the same machine.
 */
export function usePhoneVerification({
  start,
  onVerified,
}: {
  start: (phone: string) => Promise<PhoneVerificationStartResponse>;
  onVerified: (handle: string, check: PhoneVerificationCheckResponse) => void;
}) {
  const [session, setSession] = useState<
    (PhoneVerificationStartResponse & { totalSeconds: number }) | null
  >(null);

  const begin = useMutation({
    mutationFn: (phone: string) => start(phone),
    onSuccess: (data) =>
      setSession({
        ...data,
        // Measured from now, not from verify.mn's clock: the bar that drains
        // has to start full on *this* screen.
        totalSeconds: Math.max(
          1,
          Math.round((new Date(data.expiresAt).getTime() - Date.now()) / 1_000),
        ),
      }),
  });

  const secondsLeft = useSecondsUntil(session?.expiresAt);

  const check = useQuery({
    queryKey: qk.phoneVerificationCheck(session?.handle ?? ""),
    queryFn: () =>
      mutate("/phone-verifications/check", phoneVerificationCheckSchema, {
        method: "POST",
        body: { handle: session?.handle },
      }),
    enabled: Boolean(session) && secondsLeft > 0,
    // ★ Stops the moment there is an answer: a screen that kept asking would
    // read as "send it again".
    //
    // ★★ And *only* on an answer. A failed poll — a mobile network blip, a
    // 429 behind a carrier's shared address — has no status, and stopping on
    // it would leave a person who has already sent the SMS watching a
    // countdown that can no longer succeed.
    refetchInterval: (query) => {
      const settled = query.state.data?.status;
      return settled === "VERIFIED" || settled === "EXPIRED" ? false : POLL_MS;
    },
    retry: false,
  });

  const status = session ? check.data?.status : undefined;
  const handle = session?.handle;
  const result = check.data;
  useEffect(() => {
    if (status === "VERIFIED" && handle && result) onVerified(handle, result);
    // Keyed on the proof, not on `onVerified` — the caller's inline function
    // is new on every render, and this must fire once per proof.
  }, [status, handle]);

  const verified = status === "VERIFIED";
  const expired = status === "EXPIRED" || (session !== null && secondsLeft === 0 && !verified);

  return {
    session,
    verified,
    expired,
    secondsLeft,
    starting: begin.isPending,
    startError: begin.isError ? errorMessage(begin.error) : null,
    /** Asks for a code — a fresh one when there was one before. */
    begin: (phone: string) => {
      setSession(null);
      begin.mutate(phone);
    },
    /** Back to before any code was asked for — «Дугаар солих». */
    reset: () => {
      setSession(null);
      begin.reset();
    },
  };
}

/**
 * «SMS-ээр баталгаажуулах» — the compact step, inside another form.
 *
 * The person sends one SMS **from** the phone being proven; nothing is sent to
 * them. On a phone the big button opens the SMS app with the message already
 * written; on a computer the instruction names the number and the code.
 *
 * ★ Mount it with `key={phone}`. A different number is a different proof,
 * and remounting is what throws the old one away.
 *
 * `start` is the caller's: an invitation and a profile each start a
 * verification at their own route, bound to their own subject.
 */
export function PhoneVerificationStep({
  phone,
  start,
  onVerified,
}: {
  phone: string;
  start: (phone: string) => Promise<PhoneVerificationStartResponse>;
  onVerified: (handle: string, check: PhoneVerificationCheckResponse) => void;
}) {
  const proof = usePhoneVerification({ start, onVerified });
  const { session } = proof;

  if (proof.verified) {
    return (
      <p role="status" className="flex items-center gap-2 text-body font-semibold text-mint-ink">
        <CheckCircle2 aria-hidden="true" size={18} />
        Утасны дугаар баталгаажлаа
      </p>
    );
  }

  if (!session || proof.expired) {
    return (
      <div className="flex flex-col gap-2 rounded-control border border-border bg-canvas p-3.5">
        <p role={proof.expired ? "status" : undefined} className="text-body text-muted">
          {proof.expired
            ? "Хугацаа дууссан тул өмнөх код хүчингүй боллоо. Шинэ код авна уу."
            : "Энэ дугаараасаа нэг SMS илгээж баталгаажуулна."}
        </p>
        <FormError message={proof.startError} />
        <Button
          variant="secondary"
          block
          disabled={proof.starting}
          onClick={() => proof.begin(phone)}
        >
          {proof.starting
            ? "Код авч байна…"
            : proof.expired
              ? "Шинэ код авах"
              : "SMS-ээр баталгаажуулах"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-control border border-border bg-canvas p-3.5">
      {/* verify.mn's own words, verbatim — they name the number to send from,
          and sending from another SIM is the commonest reason a code fails. */}
      <p className="text-body leading-relaxed text-ink">{session.displayInstruction}</p>

      <Button asChild size="lg" block>
        <a href={session.smsUri}>
          <MessageSquareText aria-hidden="true" />
          SMS бичих
        </a>
      </Button>

      <dl className="grid grid-cols-2 gap-2 text-body">
        <div>
          <dt className="text-caption text-muted">Хүлээн авах дугаар</dt>
          <dd className="font-semibold tabular-nums text-ink">{session.shortcode}</dd>
        </div>
        <div>
          <dt className="text-caption text-muted">Код</dt>
          <dd className="font-semibold tabular-nums tracking-wider text-ink">{session.code}</dd>
        </div>
      </dl>

      <p role="status" aria-live="polite" className="text-caption text-muted">
        SMS ирэхийг хүлээж байна… {formatSeconds(proof.secondsLeft)}
      </p>
    </div>
  );
}

/** Whole seconds until `iso`, ticking once a second; 0 once it has passed. */
function useSecondsUntil(iso: string | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [iso]);
  if (!iso) return 0;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 1_000));
}

export function formatSeconds(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}
