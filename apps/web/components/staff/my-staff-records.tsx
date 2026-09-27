"use client";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { STAFF_RECORD_KIND_LABEL, staffRecordSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { Card, SectionHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TableShell, Td, Th } from "@/components/ui/table";
import { formatDate } from "@/lib/format";

const listSchema = z.array(staffRecordSchema);

/**
 * The reader's own experience, certificates and grades — "Мэргэшлийн зэрэг".
 *
 * ★ The client, 2026-09-22: "Багш болон удирдлага хэсэгт Мэргэшлийн зэргийг
 * оруулах." The management half has existed since #119 —
 * `staff-records-dialog.tsx`, off `/admin/users`. This is the teacher's half,
 * and it is **read-only on purpose**.
 *
 * ★★ **A teacher cannot write their own file, and that is a rule rather than a
 * gap.** `assertCanManageStaffRecords` is administrator-only with the reason
 * written out: criterion 51 of Order А/261 is about data the kindergarten
 * submits to the ministry, and "a record somebody wrote about themselves is not
 * evidence of anything" — a teacher who earns a grade brings the certificate to
 * the office, the administrator records it, and can be asked what they saw.
 *
 * Giving a teacher the form here would need that rule weakened, which is
 * CLAUDE.md's "if a rule blocks the task, stop and ask" rather than something to
 * route around in a component. So the teacher gets the half the API already
 * authorises: `canReadStaffRecords` has always admitted a person to their own
 * file at a kindergarten they belong to. **No API change, no new permission.**
 *
 * ★★★ Grades first, then certificates, then posts. The client named
 * мэргэшлийн зэрэг specifically, so `QUALIFICATION` leads regardless of date —
 * the API returns one file newest-first across all three kinds, which buries
 * the grade under whatever was added last.
 */
export function MyStaffRecords() {
  const { session, primaryKindergartenId } = useSession();
  const userId = session?.user.id;

  const records = useQuery({
    queryKey: qk.staffRecords(primaryKindergartenId ?? "", userId ?? ""),
    queryFn: () =>
      get(`/kindergartens/${primaryKindergartenId}/staff/${userId}/records`, listSchema),
    enabled: Boolean(primaryKindergartenId && userId),
  });

  /*
   * ★ Renders nothing at all when the file is empty, rather than an empty
   * state. An empty state's job is to say what to do next, and there is nothing
   * this reader can do — the office records these. A panel reading "no
   * qualifications" on a teacher's own screen states a fact about them, in
   * their own account, that they cannot act on.
   */
  if (!records.data || records.data.length === 0) return null;

  const order = { QUALIFICATION: 0, CERTIFICATE: 1, EXPERIENCE: 2 } as const;
  const rows = [...records.data].sort(
    (a, b) => (order[a.kind] ?? 3) - (order[b.kind] ?? 3) || b.startedOn.localeCompare(a.startedOn),
  );

  return (
    <div className="flex w-full max-w-[760px] flex-col gap-6 lg:gap-8">
      <Card className="p-0">
        <div className="p-5 pb-0">
          <SectionHeader
            title="Мэргэшлийн зэрэг, гэрчилгээ"
            lede="Цэцэрлэгийн удирдлага бүртгэсэн хувийн хэрэг. Нэмэх, засах бол эрхлэгчид хандана."
          />
        </div>

        <TableShell caption="Өөрийн мэргэшил, гэрчилгээ, туршлага" minWidth="min-w-0" stacked>
          <thead>
            <tr>
              <Th>Төрөл</Th>
              <Th>Нэр</Th>
              <Th>Хугацаа</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((record) => (
              <tr key={record.id}>
                <Td data-label="Төрөл">
                  <Badge tone={record.kind === "QUALIFICATION" ? "mint" : "sky"}>
                    {STAFF_RECORD_KIND_LABEL[record.kind]}
                  </Badge>
                </Td>
                <Td data-label="Нэр" className="font-medium text-ink">
                  {record.title}
                  {record.issuer ? (
                    <span className="block text-caption font-normal text-muted">
                      {record.issuer}
                    </span>
                  ) : null}
                </Td>
                {/*
                  ★ An open `endedOn` reads "одоог хүртэл", not a blank. The
                  schema's own note says null means "still current" — a post a
                  person still holds, or a certificate that does not expire —
                  and a dash there would read as a missing value.
                */}
                <Td data-label="Хугацаа" className="tabular-nums text-muted">
                  {formatDate(record.startedOn)}
                  {" — "}
                  {record.endedOn ? formatDate(record.endedOn) : "одоог хүртэл"}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </Card>
    </div>
  );
}
