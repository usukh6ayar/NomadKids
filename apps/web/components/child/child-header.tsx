"use client";

import type { ReactNode } from "react";
import type { ChildDetail } from "@kinder/contracts";
import { Card } from "@/components/ui/card";
import { ChildAvatar } from "@/components/media/media-image";
import { formatAge, formatDate, fullName } from "@/lib/format";

/**
 * Who this child is.
 *
 * The same identity block on every child screen, so a teacher moving between
 * portfolio, observations and assessment never loses track of whose record is
 * open. That sounds obvious and is exactly what goes wrong when each screen
 * builds its own header: on a phone, with the name scrolled off, an observation
 * gets written against the wrong child.
 */
export function ChildHeader({ child, actions }: { child: ChildDetail; actions?: ReactNode }) {
  const enrollment = child.enrollments?.[0];

  return (
    <Card className="px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-center gap-4">
        <ChildAvatar child={child} size={64} />

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold text-ink sm:text-xl">{fullName(child)}</h1>
          <p className="mt-0.5 text-sm text-muted">
            {[formatAge(child.dateOfBirth), enrollment?.group?.name, enrollment?.schoolYear?.name]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="mt-0.5 text-xs text-muted">Төрсөн: {formatDate(child.dateOfBirth)}</p>
        </div>

        {actions ? <div className="flex w-full flex-wrap gap-2 sm:w-auto">{actions}</div> : null}
      </div>
    </Card>
  );
}
