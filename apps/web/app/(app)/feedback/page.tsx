"use client";

import { FEEDBACK_LEDE, ParentFeedbackPanel } from "@/components/feedback/parent-feedback";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";

/**
 * Санал хүсэлт — a guardian writes to the kindergarten's administration, 2026-10-08.
 *
 * ★ "Нэрээ нууж илгээх" hides the guardian from the administration, not from
 * the system — `lib/feedback.ts` says why. So the guardian still sees their
 * own note here and its status, and the form says plainly what an anonymous
 * note gives up: an answer.
 *
 * Ready for the API (`GET`/`POST /me/feedback`); while it answers 404 the page
 * says so and a send keeps what was typed.
 */
export default function FeedbackPage() {
  return (
    <RequireRole roles={["PARENT"]}>
      <div className="flex w-full flex-col gap-4">
        <PageHeader title="Санал хүсэлт" lede={FEEDBACK_LEDE} />
        <ParentFeedbackPanel />
      </div>
    </RequireRole>
  );
}
