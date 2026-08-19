"use client";

import { Eye, EyeOff, Image as ImageIcon } from "lucide-react";
import type { Observation } from "@kinder/contracts";
import { Badge } from "@/components/ui/badge";
import { excerpt, formatDate, fullName } from "@/lib/format";

/**
 * One observation in a list.
 *
 * ★ `showVisibility` is a display choice, never a filter.
 *
 * A parent's list arrives already filtered by the API — a private teaching note
 * is not in the response at all. This flag only decides whether to render the
 * "who can see this" chip, which is meaningful to a teacher and meaningless to
 * a family. Filtering client-side would mean the data was on the page.
 */
export function ObservationRow({
  observation,
  showVisibility = false,
  onClick,
}: {
  observation: Observation;
  showVisibility?: boolean;
  onClick?: () => void;
}) {
  const body = observation.situation || observation.teacherComment || observation.childDid || "";

  const content = (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-ink">{observation.type?.name ?? "Ажиглалт"}</span>
          <span className="text-xs text-muted">{formatDate(observation.observedOn)}</span>

          {observation.source === "PARENT" ? <Badge tone="sky">Эцэг эхээс</Badge> : null}

          {/* Only ever shown to staff — see the note above. */}
          {showVisibility ? (
            observation.visibleToParents ? (
              <Badge tone="mint">
                <Eye size={12} aria-hidden="true" />
                Эцэг эх хардаг
              </Badge>
            ) : (
              <Badge tone="neutral">
                <EyeOff size={12} aria-hidden="true" />
                Дотоод
              </Badge>
            )
          ) : null}

          {observation.reviewStatus === "PENDING" ? <Badge tone="sun">Хүлээгдэж буй</Badge> : null}
          {observation.reviewStatus === "RETURNED" ? <Badge tone="peach">Буцаагдсан</Badge> : null}
        </div>

        {body ? <p className="text-sm text-muted">{excerpt(body, 140)}</p> : null}

        <div className="flex items-center gap-3 text-xs text-muted">
          {observation.author ? <span>{fullName(observation.author)}</span> : null}
          {observation.media.length > 0 ? (
            <span className="inline-flex items-center gap-1">
              <ImageIcon size={12} aria-hidden="true" />
              {observation.media.length}
              <span className="sr-only">зураг</span>
            </span>
          ) : null}
        </div>
      </div>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="flex min-h-[64px] w-full items-start gap-3 px-4 py-3 text-left hover:bg-canvas"
      >
        {content}
      </button>
    );
  }

  return <div className="flex min-h-[64px] items-start gap-3 px-4 py-3">{content}</div>;
}
