"use client";

import { EsisCurriculumChain } from "@/components/esis/esis-curriculum";
import { EsisDataPanel } from "@/components/esis/esis-data-panel";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { SectionHeader } from "@/components/ui/card";

/**
 * Сургалтын хөтөлбөр — the ministry's curriculum, as ESIS holds it.
 *
 * ★ **A screen of its own, at the client's choosing (2026-09-10).** The four
 * services are a chain rather than a set: `program/list` returns the
 * programmes, `program/stage/list` takes a programme's id, the plan list takes
 * a stage's, and the course list takes a plan's. Four unrelated panels on an
 * existing admin page would ask a director to copy an id from one box into the
 * next three times; a page whose whole subject is the chain can draw it as
 * what it is.
 *
 * ★★ **Read-only, and there is no write to add.** Nothing here corresponds to
 * a NomadKids record — `esis.catalog.ts` marks all four
 * `Curriculum reference (DISPLAY_ONLY)`. A kindergarten does not author the
 * state curriculum; it reads which programme its groups sit under, which is
 * exactly what the roster's own `programOfStudyId` already points at.
 *
 * ★★★ The two reference lists at the foot — академик нэгж and судлагдахуун —
 * are here for the same reason: they are what the chain's rows name. A course
 * carries a `subjectAreaId`, and a director reading "41" wants the list that
 * says what 41 is.
 */
export default function CurriculumPage() {
  return (
    <RequireRole roles={["ADMIN"]}>
      <div className="flex w-full flex-col gap-6 lg:gap-8">
        <PageHeader
          title="Сургалтын хөтөлбөр"
          lede="ЭСИС-д бүртгэлтэй хөтөлбөр, үе шат, төлөвлөгөө, хичээл."
        />

        {/*
          ★ **One chain, not four panels — corrected 2026-09-10.**

          The first version of this page drew `programs` with a one-level
          drill-down and then left `programPlans` and `programCourses` as
          standalone panels that asked the reader to type `programOfStudyId`,
          `programStageId` and `programPlanId`. In a demo deployment those
          boxes were pre-filled with `501`, `12` and `780` — hardcoded ids in
          everything but name, and wrong the moment a real token returns a
          programme numbered anything else.

          `EsisCurriculumChain` passes each level's *selected* id to the one
          below it, which is what the four services are shaped for.
        */}
        <section aria-labelledby="curriculum-chain-heading">
          <SectionHeader
            id="curriculum-chain-heading"
            title="Хөтөлбөрийн шатлал"
            lede="Хөтөлбөр сонгоод үе шат, дараа нь төлөвлөгөө, эцэст нь хичээлүүд нь харагдана."
          />
          <EsisCurriculumChain />
        </section>

        <section aria-labelledby="curriculum-reference-heading">
          <SectionHeader
            id="curriculum-reference-heading"
            title="Лавлах"
            lede="Дээрх мөрүүдийн нэрлэсэн нэгж ба судлагдахууны жагсаалт."
          />
          <div className="flex flex-col gap-6">
            <EsisDataPanel
              resource="academicOrg"
              title="Академик нэгж"
              description="Байгууллагын дотоод нэгж, заах аргын нэгдэл"
            />
            <EsisDataPanel
              resource="subjectAreas"
              title="Судлагдахууны чиглэл"
              description="Хичээлүүдийн харьяалагдах судлагдахуун"
            />
          </div>
        </section>
      </div>
    </RequireRole>
  );
}
