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
 * ★ **No child carries an ESIS person id yet.**
 *
 * `Child` has no column for one and `my-profile` matches a signed-in teacher
 * by reading the roster, so there is nothing on this screen to hand the panels
 * as `personId`. They therefore ask for it — `EsisDataPanel` draws the input
 * itself, and a demo deployment pre-fills the demo tenant's own id.
 *
 * That is the honest state rather than a gap left quiet: a director typing an
 * ESIS number once per child is a real cost, and it disappears the day the
 * roster import writes the id onto the record. Until then, asking is better
 * than guessing.
 */
export function ChildEsisRegistration({ childId: _childId }: { childId: string }) {
  return (
    <section aria-labelledby="esis-registration-heading">
      <SectionHeader
        id="esis-registration-heading"
        title="ЭСИС дэх бүртгэл"
        lede="Хүүхэд ЭСИС-д бүртгэлтэй эсэх, ямар бүлэгт байгааг шалгана."
      />
      <EsisDataPanel resource="studentCheck" />
    </section>
  );
}

/**
 * The guardians, as ESIS holds them.
 *
 * ★ **`stdnt/all/contacts` returns the whole institution, not one child.** It
 * takes no person parameter — the client's own URL has only `institutionId` —
 * so this panel is the kindergarten's contact list rather than this child's
 * three rows. It is placed here anyway because this is where the client asked
 * for it and because it is the only read the service offers; the description
 * says which list it is, so nobody reads a roster as one family.
 *
 * Narrowing it needs a child↔ESIS person mapping, which is the same missing
 * piece the panels above and below wait on.
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
        <EsisContactsWriteButton prefill={prefill} />
      </div>
      <EsisDataPanel
        resource="studentContacts"
        title="ЭСИС дэх асран хамгаалагчид"
        description="Хамаарал, утас, ажлын газар — ЭСИС-ийн бүртгэлээр. Энэ жагсаалт бүх цэцэрлэгийн хэмжээнд ирнэ."
      />
    </div>
  );
}

/** Өрхийн мэдээлэл — household composition and livelihood. */
export function ChildEsisHousehold() {
  return (
    <section aria-labelledby="esis-household-heading">
      <SectionHeader
        id="esis-household-heading"
        title="Өрхийн мэдээлэл"
        lede="Өрхийн бүрэлдэхүүн, амьжиргаа, халамжийн байдал."
        action={
          <EsisFactsWriteButton
            resource="studentStatisticsSave"
            title="Өрхийн мэдээлэл илгээх"
            description="Хүүхдийн өрхийн мэдээллийг ЭСИС рүү илгээнэ."
          />
        }
      />
      <EsisDataPanel resource="studentStatistics" />
    </section>
  );
}

/** Амьдрах орчин — dwelling, heating, water, sanitation. */
export function ChildEsisLiving() {
  return (
    <section aria-labelledby="esis-living-heading">
      <SectionHeader
        id="esis-living-heading"
        title="Амьдрах орчин"
        lede="Орон сууц, халаалт, ус хангамж, ариун цэврийн байгууламж."
        action={
          <EsisFactsWriteButton
            resource="studentConditionSave"
            title="Амьдрах орчин илгээх"
            description="Хүүхдийн амьдрах орчны мэдээллийг ЭСИС рүү илгээнэ."
          />
        }
      />
      <EsisDataPanel resource="studentCondition" />
    </section>
  );
}
