import Link from "next/link";
import { Link2, TriangleAlert } from "lucide-react";
import type { AdminDashboard } from "@kinder/contracts";
import { Card, SectionHeader } from "@/components/ui/card";
import { formatRelative } from "@/lib/format";

type EsisCounts = NonNullable<AdminDashboard["esis"]>;

/**
 * ЭСИС-д хэд, энд хэд — the ministry's register beside this system's.
 *
 * ★ **The question a director actually asks.** The tiles above say "Багш,
 * ажилтан 3", and nothing on the screen said whether three is all of them.
 * ESIS lists the staff of the kindergarten; this system lists the people who
 * can sign in; those are different numbers and the gap is the work.
 *
 * ★★ **No call reaches the ministry.** `EsisStaffRoster` is refilled nightly
 * by tier 2 of the sync, so the ministry's staff total is already on disk —
 * and a dashboard opened thirty times a day must not spend a rate-limited
 * token each time. `dashboard.repository.ts` carries the argument in full.
 *
 * ★★★ **Children and groups are labelled as provenance, not as the ministry's
 * total**, because that is what they are: there is no stored copy of ESIS's
 * student roster, so what can be counted for free is "how many of ours came
 * from an import". Presenting that as "ЭСИС-д N суралцагч" would be a figure
 * that looks authoritative and is not. The honest live comparison is on each
 * group's own page, where one read answers for one class.
 */
export function EsisVsRegistered({
  esis,
  groupsTotal,
}: {
  esis: EsisCounts;
  /**
   * Every active group, from the dashboard's own counts — `esis` holds only
   * how many of them carry a ministry id.
   */
  groupsTotal: number;
}) {
  /*
   * Nothing has ever been synced or imported — the kindergarten is either not
   * connected to ESIS or has never pressed a button. A table of zeroes would
   * read as "the ministry has no staff"; the sentence says which it is.
   */
  const untouched =
    esis.staffInRoster === 0 && esis.childrenLinked === 0 && esis.groupsLinked === 0;

  return (
    <Card pad="roomy" className="flex flex-col gap-3">
      <SectionHeader
        title="ЭСИС-тэй тулгалт"
        as="h2"
        lede={
          esis.rosterSyncedAt
            ? `Ажилтны жагсаалтыг ${formatRelative(esis.rosterSyncedAt)} шинэчилсэн.`
            : undefined
        }
      />

      {untouched ? (
        <p className="text-body text-muted">
          ЭСИС-ээс мэдээлэл татаагүй байна.{" "}
          <Link href="/admin/esis-sync" className="text-primary underline">
            ЭСИС холболт
          </Link>{" "}
          хэсгээс ажилтны бүртгэлийг, «Анги бүлэг» хэсгээс бүлэг, суралцагчийг татна.
        </p>
      ) : (
        <>
          <dl className="flex flex-col gap-2.5">
            <Row
              label="Багш, ажилтан"
              esisLabel="ЭСИС-д"
              esisValue={esis.staffInRoster}
              localLabel="Бүртгэлтэй"
              localValue={esis.staffRegistered}
              href="/admin/users"
            />
            <Row
              label="Суралцагч"
              esisLabel="ЭСИС-ээс ирсэн"
              esisValue={esis.childrenLinked}
              localLabel="Нийт"
              localValue={esis.childrenTotal}
              href="/children"
            />
            <Row
              label="Бүлэг"
              esisLabel="ЭСИС-тэй холбогдсон"
              esisValue={esis.groupsLinked}
              localLabel="Нийт"
              localValue={groupsTotal}
              href="/admin/groups"
            />
          </dl>

          {/*
            ★ The one row that is a to-do rather than a statistic. An account
            with no `esisPersonId` is a person this system cannot match to the
            ministry's record — which is what makes the same human appear twice
            on the staff screen. The link goes where the fix is.
          */}
          {esis.staffRegistered > esis.staffLinked ? (
            <p className="flex items-start gap-1.5 rounded-control bg-sun px-3 py-2 text-caption leading-relaxed text-sun-ink">
              <TriangleAlert size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span>
                {esis.staffRegistered - esis.staffLinked} бүртгэл ЭСИС-ийн хүнтэй холбогдоогүй байна
                — тэд жагсаалтад хоёр мөрөөр харагдана.{" "}
                <Link href="/admin/users" className="underline">
                  Холбох
                </Link>
              </span>
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-caption text-muted">
              <Link2 size={14} aria-hidden="true" className="shrink-0 text-mint-ink" />
              Бүх бүртгэл ЭСИС-ийн хүнтэй холбогдсон.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

/** One line: what the ministry says, what we hold, and where to go. */
function Row({
  label,
  esisLabel,
  esisValue,
  localLabel,
  localValue,
  href,
}: {
  label: string;
  esisLabel: string;
  esisValue: number;
  localLabel: string;
  localValue: number;
  href: string;
}) {
  /*
   * ★ Amber only where a difference is somebody's to-do. Equal counts are the
   * settled case and get no colour at all — the design rule the rest of the
   * product follows, and the reason this strip is scannable.
   */
  const differs = esisValue !== localValue;

  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <dt className="text-body text-ink">
        <Link href={href} className="hover:underline">
          {label}
        </Link>
      </dt>
      <dd className="flex items-baseline gap-4 text-caption">
        <span className={differs ? "text-sun-ink" : "text-muted"}>
          {esisLabel} <span className="font-semibold tabular-nums">{esisValue}</span>
        </span>
        <span className={differs ? "text-sun-ink" : "text-muted"}>
          {localLabel} <span className="font-semibold tabular-nums">{localValue}</span>
        </span>
      </dd>
    </div>
  );
}
