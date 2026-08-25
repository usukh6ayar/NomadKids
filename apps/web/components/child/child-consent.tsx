"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, ShieldX } from "lucide-react";
import { z } from "zod";
import { childConsentSchema, CONSENT_KIND_LABEL } from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { errorMessage } from "@/lib/api/errors";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { ErrorState, FormError, LoadingState } from "@/components/ui/states";

/**
 * Consent — RFP §16.
 *
 * ★ Only a guardian decides; staff read it.
 *
 * §16 asks for two separate permissions, and photo publishing is named
 * separately in its own sentence. A single "I agree" would make refusing
 * photographs mean refusing the system.
 *
 * ★★ "Not asked" is shown as its own state, not as "refused".
 *
 * They are different facts and only one has an action attached: a family that
 * has never been asked still needs to be. A screen that showed both as "no"
 * would let a kindergarten believe it had a refusal on file when it had
 * nothing.
 */
export function ChildConsent({ childId, isGuardian }: { childId: string; isGuardian: boolean }) {
  const consent = useQuery({
    queryKey: qk.consent(childId),
    queryFn: () => get(`/children/${childId}/consent`, childConsentSchema),
  });

  if (consent.isPending) return <LoadingState rows={2} />;
  if (consent.isError) return <ErrorState description={errorMessage(consent.error)} />;

  const { current, history } = consent.data;

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        title="Зөвшөөрөл"
        lede={
          isGuardian
            ? "Та хүссэн үедээ өөрчилж болно."
            : "Эцэг эхийн өгсөн зөвшөөрлийг харуулж байна."
        }
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <ConsentCard
          childId={childId}
          kind="DATA_PROCESSING"
          decision={current.dataProcessing}
          isGuardian={isGuardian}
        />
        <ConsentCard
          childId={childId}
          kind="PHOTO_PUBLISHING"
          decision={current.photoPublishing}
          isGuardian={isGuardian}
        />
      </div>

      {history.length > 0 ? (
        <details className="group">
          <summary className="inline-flex min-h-[44px] cursor-pointer list-none items-center text-caption font-medium text-primary hover:underline [&::-webkit-details-marker]:hidden">
            Түүх ({history.length})
          </summary>

          {/*
            The history is the record, and it is why a decision is never
            updated in place: "we had permission on the day we published" is
            the question this exists to answer.
          */}
          <ul className="mt-2 flex flex-col gap-1.5">
            {history.map((row) => (
              <li key={row.id} className="text-caption text-muted">
                {formatDate(row.decidedAt)} · {CONSENT_KIND_LABEL[row.kind] ?? row.kind} ·{" "}
                <span className={row.granted ? "text-mint-ink" : "text-danger"}>
                  {row.granted ? "Зөвшөөрсөн" : "Татгалзсан"}
                </span>
                {row.decidedBy ? ` · ${row.decidedBy.lastName} ${row.decidedBy.firstName}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function ConsentCard({
  childId,
  kind,
  decision,
  isGuardian,
}: {
  childId: string;
  kind: "DATA_PROCESSING" | "PHOTO_PUBLISHING";
  decision: z.infer<typeof childConsentSchema>["current"]["dataProcessing"];
  isGuardian: boolean;
}) {
  const queryClient = useQueryClient();

  const decide = useMutation({
    mutationFn: (granted: boolean) =>
      mutate(`/children/${childId}/consent`, z.unknown(), {
        method: "POST",
        body: { kind, granted },
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: qk.consent(childId) }),
  });

  return (
    <Card pad="roomy" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {decision.granted ? (
          <ShieldCheck size={18} aria-hidden="true" className="shrink-0 text-mint-ink" />
        ) : (
          <ShieldX size={18} aria-hidden="true" className="shrink-0 text-muted" />
        )}
        <span className="text-body font-medium text-ink">{CONSENT_KIND_LABEL[kind]}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {decision.granted ? (
          <Badge tone="mint">Зөвшөөрсөн</Badge>
        ) : decision.asked ? (
          <Badge tone="danger">Татгалзсан</Badge>
        ) : (
          // Its own state, not "refused" — see the note on ChildConsent.
          <Badge tone="sun">Асуугаагүй</Badge>
        )}

        {decision.decidedAt ? (
          <span className="text-caption text-muted">{formatDate(decision.decidedAt)}</span>
        ) : null}
      </div>

      <FormError message={decide.isError ? errorMessage(decide.error) : null} />

      {/*
        The buttons appear only for a guardian. Consent given on somebody's
        behalf is not consent, and the API refuses it — showing a control that
        always fails would teach staff the app is broken.
      */}
      {isGuardian ? (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={decision.granted ? "secondary" : "primary"}
            disabled={decide.isPending}
            onClick={() => decide.mutate(true)}
          >
            Зөвшөөрөх
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={decide.isPending}
            onClick={() => decide.mutate(false)}
          >
            Татгалзах
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
