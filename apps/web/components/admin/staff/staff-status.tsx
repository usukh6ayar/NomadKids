import { Badge } from "@/components/ui/badge";
import { STAFF_STATUS_LABEL, type StaffDirectoryRow, type StaffStatus } from "./staff-model";

/**
 * The Төлөв chip.
 *
 * ★ Three tones, used for their meanings rather than their colours
 * (`tone.ts`): mint is *complete*, sun is *waiting on somebody*, neutral is
 * simply off. Green is never used for anything but a settled row — the design
 * direction's rule — so "Анхаарах" cannot be mistaken for "fine" at a glance
 * down the column.
 */
export function StaffStatusBadge({ status }: { status: StaffStatus }) {
  const tone = status === "ACTIVE" ? "mint" : status === "ATTENTION" ? "sun" : "neutral";
  return <Badge tone={tone}>{STAFF_STATUS_LABEL[status]}</Badge>;
}

/**
 * Where this person is on record — our books, the ministry's, or both.
 *
 * ★ **It says what is true, not which endpoint said so.** A director does not
 * need to know that ESIS answers the staff question with `teacher/list` and
 * `school/staff`; they need to know whether this person can sign in. So the
 * label for the settled case is a tick beside one word, and the label for the
 * gap is the sentence that names the gap.
 *
 * ★★ `LOCAL_ONLY` draws nothing at all. Almost every invited account is in
 * that state — `createInvitedAccount` never sets an `esisPersonId` — so a chip
 * there would mark the ordinary case as exceptional on most rows of most
 * kindergartens, which is how a status strip stops being read.
 */
export function StaffSourceBadge({ row }: { row: StaffDirectoryRow }) {
  if (row.source === "ESIS_ONLY") return <Badge tone="sun">NomadKids бүртгэлгүй</Badge>;
  if (row.source === "BOTH") return <Badge tone="sky">ЭСИС ✓</Badge>;
  return null;
}
