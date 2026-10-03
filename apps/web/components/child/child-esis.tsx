"use client";

import type { ChildDetail } from "@kinder/contracts";
import { EsisDataPanel } from "@/components/esis/esis-data-panel";
import { EsisContactsWriteButton, EsisFactsWriteButton } from "@/components/esis/esis-write";
import { Disclosure } from "@/components/ui/disclosure";

/**
 * What ESIS holds about one child, beside what this product holds.
 *
 * ★ Placement is the client's, 2026-09-10: "хүүхдүүд дараад орохоор ерөнхий
 * хэсэг дотор асран хамгаалагч хэсэгт орно" for the contacts, with өрхийн
 * мэдээлэл and амьдрах орчин as two further sections of the same page. So all
 * three sit on Ерөнхий мэдээлэл, in that order, under the record they describe.
 * Since 2026-10-01 each is folded (a `Disclosure`), and the household pair is
 * one, at the client's request that the tab stop repeating itself.
 *
 * ★★ **None of it is stored.** `esis.catalog.ts` marks these services
 * `Child ESIS reference (NOT STORED)` — a `Child` column for "өрхийн төрөл" is
 * a schema decision nobody has asked for, and inventing one to hold a
 * ministry's answer would put this product in the business of keeping a
 * family's income band. The panels show what ESIS returns and the buttons send
 * what the kindergarten knows; nothing lands in our database in between.
 *
 * ★★★ Staff only, and by two separate mechanisms. The caller renders these
 * behind `isStaff`, and the services themselves are absent from a parent's
 * ESIS list — `esisServicesForActor` returns nothing for a guardian, so
 * `/esis/catalog` omits them and every panel below draws `null`. Either alone
 * would be enough; both is what CLAUDE.md §1.1 asks for when the data is a
 * family's own circumstances.
 */

/**
 * Send this kindergarten's guardians to ESIS.
 *
 * ★ `stdnt/all/contacts` takes the child's `personId` in its body, so it asks
 * for the child by `childId`, resolved by the API (2026-09-28).
 *
 * ★★ Only the button since 2026-10-01. The ministry's guardian list used to
 * be a folded table here; it is now read person by person into the
 * guardian cards themselves (`child-general-info.tsx`), and the raw rows —
 * the child's own contact points included — sit under "ЭСИС-ийн бүх
 * мэдээлэл". What was left to place was the one action.
 */
export function ChildEsisContactsSend({ child }: { child: ChildDetail }) {
  const prefill = child.guardianships
    .map((guardianship) => guardianship.guardian)
    .filter((guardian): guardian is NonNullable<typeof guardian> => Boolean(guardian))
    .map((guardian) => ({
      lastName: guardian.lastName,
      firstName: guardian.firstName,
      phone: guardian.phone ?? null,
      email: guardian.email ?? null,
    }));

  return <EsisContactsWriteButton childId={child.id} prefill={prefill} />;
}

/**
 * Өрхийн мэдээлэл — ESIS's household record, folded.
 *
 * ★ Folded on purpose. ESIS keeps it as thirteen unnamed flags
 * (`infoFlag1..13`, Y/N), three texts and two numbers, and what each flag
 * means is not documented anywhere this product can read — the ministry's
 * only answer was "infoFlag9 утгыг шалгана уу". Laid out like the cards above
 * it would be twenty rows reading "Тэмдэглэгээ 1: Y". It opens into the raw
 * record, with its "send to ESIS" action, until the flags have names.
 *
 * ★★ Амьдрах орчин left this fold on 2026-10-01, at the client's request: its
 * fields do have names, so it is a card like the rest
 * (`child-general-info.tsx`).
 */
export function ChildEsisHousehold({ childId }: { childId: string }) {
  return (
    <Disclosure title="Өрхийн мэдээлэл" hint="ЭСИС-ийн бүртгэлээр">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <EsisFactsWriteButton
            resource="studentStatisticsSave"
            childId={childId}
            title="Өрхийн мэдээлэл илгээх"
            description="Хүүхдийн өрхийн мэдээллийг ЭСИС рүү илгээнэ."
          />
        </div>
        <EsisDataPanel
          resource="studentStatistics"
          params={{ childId }}
          askForParams={false}
          compact
          title="ЭСИС-ийн бүртгэл"
        />
      </div>
    </Disclosure>
  );
}
