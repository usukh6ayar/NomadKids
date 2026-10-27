import type { PlatformPeople as People } from "@kinder/contracts";

/**
 * «Хэрэглэгчид» on the operator's «Самбар» — the user, 2026-10-27: «хэдэн эцэг
 * эх, хэдэн багш бүртгэгдсэн». People, not memberships, and a family that has
 * not used its invitation yet is counted apart from one that has.
 */
export function PlatformPeople({ people }: { people: People }) {
  const tiles: { label: string; value: number; hint?: string }[] = [
    {
      label: "Эцэг эх бүртгүүлсэн",
      value: people.parentsJoined,
      hint: `${people.parentsInvited.toLocaleString("en-US")} урилга ашиглагдаагүй`,
    },
    {
      label: "Эцэг эхтэй холбогдсон хүүхэд",
      value: people.childrenWithParent,
    },
    {
      label: "Багш",
      value: people.teachers + people.soloTeachers,
      hint: `${people.soloTeachers.toLocaleString("en-US")} нь бие даасан`,
    },
    { label: "Эрхлэгч", value: people.directors },
    { label: "Бусад ажилтан", value: people.otherStaff, hint: "Нягтлан, тогооч, эмч г.м." },
    {
      label: "Цэцэрлэг",
      value: people.kindergartens.contracted,
      hint: `${people.kindergartens.solo.toLocaleString("en-US")} бие даасан багшийн`,
    },
    { label: "7 хоногт нэвтэрсэн", value: people.activeLast7Days },
    {
      label: "7 хоногт шинээр нэгдсэн",
      value: people.joinedLast7Days,
      hint: "Урилга хүлээн авсан",
    },
  ];

  return (
    <section aria-labelledby="platform-people" className="flex flex-col gap-2">
      <h2
        id="platform-people"
        className="text-caption font-semibold uppercase tracking-[0.12em] text-muted"
      >
        Хэрэглэгчид
      </h2>
      <dl className="grid grid-cols-2 overflow-hidden rounded-card border border-border bg-white sm:grid-cols-4">
        {tiles.map(({ label, value, hint }) => (
          <div key={label} className="border-b border-r border-border-soft px-4 py-3">
            <dt className="text-caption text-muted">{label}</dt>
            <dd className="mt-0.5 text-title font-bold tabular-nums text-ink">
              {value.toLocaleString("en-US")}
            </dd>
            {hint ? <dd className="text-caption text-faint">{hint}</dd> : null}
          </div>
        ))}
      </dl>
    </section>
  );
}
