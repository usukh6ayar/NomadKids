"use client";

import type { ChildDetail } from "@kinder/contracts";
import { EsisDataPanel } from "@/components/esis/esis-data-panel";
import { EsisContactsWriteButton, EsisFactsWriteButton } from "@/components/esis/esis-write";
import { SectionHeader } from "@/components/ui/card";

/**
 * What ESIS holds about one child, beside what this product holds.
 *
 * ★ Placement is the client's, 2026-09-10: "хүүхдүүд дараад орохоор ерөнхий
 * хэсэг дотор асран хамгаалагч хэсэгт орно" for the contacts, with өрхийн
 * мэдээлэл and амьдрах орчин as two further sections of the same page. So all
 * three sit on Ерөнхий мэдээлэл, in that order, under the record they describe.
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
 * ★ The panels pass `childId` and the API finds the ESIS person — 2026-09-28.
 *
 * They used to ask the reader for "ESIS хүний дугаар", when no child carried
 * one. The roster import («ESIS Суралцагч») now writes `Child.esisPersonId`,
 * and `read()` substitutes it after `canAccessChild`, so the number never has
 * to reach the browser at all.
 */
export function ChildEsisRegistration({ childId }: { childId: string }) {
  return (
    <section aria-labelledby="esis-registration-heading">
      <SectionHeader
        id="esis-registration-heading"
        title="ЭСИС дэх бүртгэл"
        lede="Хүүхэд ЭСИС-д бүртгэлтэй эсэх, ямар бүлэгт байгааг шалгана."
      />
      <EsisDataPanel resource="studentCheck" params={{ childId }} askForParams={false} />
    </section>
  );
}

/**
 * The guardians, as ESIS holds them.
 *
 * ★ `stdnt/all/contacts` takes the child's `personId` in its body, so it asks
 * for the child like the panels above — by `childId`, resolved by the API
 * (2026-09-28).
 */
export function ChildEsisGuardians({ child }: { child: ChildDetail }) {
  const prefill = child.guardianships
    .map((guardianship) => guardianship.guardian)
    .filter((guardian): guardian is NonNullable<typeof guardian> => Boolean(guardian))
    .map((guardian) => ({
      lastName: guardian.lastName,
      firstName: guardian.firstName,
      phone: guardian.phone ?? null,
      email: guardian.email ?? null,
    }));

  /*
   * ★ No `SectionHeader`. This renders *inside* the page's own Асран
   * хамгаалагч section, so a heading here would be the second one saying the
   * same thing. The panel carries its own title and the send button sits in
   * its header, which is where every other ESIS panel puts an action.
   */
  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <EsisContactsWriteButton childId={child.id} prefill={prefill} />
      </div>
      <EsisDataPanel
        resource="studentContacts"
        params={{ childId: child.id }}
        askForParams={false}
        title="ЭСИС дэх асран хамгаалагчид"
        description="Хамаарал, утас, ажлын газар — ЭСИС-ийн бүртгэлээр."
      />
    </div>
  );
}

/** Өрхийн мэдээлэл — household composition and livelihood. */
export function ChildEsisHousehold({ childId }: { childId: string }) {
  return (
    <section aria-labelledby="esis-household-heading">
      <SectionHeader
        id="esis-household-heading"
        title="Өрхийн мэдээлэл"
        lede="Өрхийн бүрэлдэхүүн, амьжиргаа, халамжийн байдал."
        action={
          <EsisFactsWriteButton
            resource="studentStatisticsSave"
            childId={childId}
            title="Өрхийн мэдээлэл илгээх"
            description="Хүүхдийн өрхийн мэдээллийг ЭСИС рүү илгээнэ."
          />
        }
      />
      <EsisDataPanel resource="studentStatistics" params={{ childId }} askForParams={false} />
    </section>
  );
}

/** Амьдрах орчин — dwelling, heating, water, sanitation. */
export function ChildEsisLiving({ childId }: { childId: string }) {
  return (
    <section aria-labelledby="esis-living-heading">
      <SectionHeader
        id="esis-living-heading"
        title="Амьдрах орчин"
        lede="Орон сууц, халаалт, ус хангамж, ариун цэврийн байгууламж."
        action={
          <EsisFactsWriteButton
            resource="studentConditionSave"
            childId={childId}
            title="Амьдрах орчин илгээх"
            description="Хүүхдийн амьдрах орчны мэдээллийг ЭСИС рүү илгээнэ."
          />
        }
      />
      <EsisDataPanel resource="studentCondition" params={{ childId }} askForParams={false} />
    </section>
  );
}
