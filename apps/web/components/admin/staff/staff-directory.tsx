"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { UserPlus, UsersRound } from "lucide-react";
import { STAFF_ROLES, adminUserSchema, groupListItemSchema, paginated } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { errorMessage } from "@/lib/api/errors";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { Art } from "@/components/ui/art";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useEsisRows } from "@/components/esis/use-esis-rows";
import {
  EMPTY_STAFF_FILTERS,
  buildStaffDirectory,
  filterStaff,
  staffSummary,
  type StaffDirectoryRow,
  type StaffFilters,
} from "./staff-model";
import { StaffDetailDrawer } from "./staff-detail-drawer";
import { StaffLinkDialog } from "./staff-link-dialog";
import { StaffTable } from "./staff-table";
import { StaffToolbar } from "./staff-toolbar";

const usersSchema = paginated(adminUserSchema);
const groupsSchema = paginated(groupListItemSchema);

/**
 * The staff roles this screen counts and lists.
 *
 * ★ `STAFF_ROLES`, not `ASSIGNABLE_ROLES` — see the contract's own note. The
 * second contains `PARENT` on purpose, and passing it here asked the API for
 * every family in the kindergarten on a screen titled Багш, ажилтан.
 */
const STAFF_ROLE_FILTER = STAFF_ROLES.join(",");

/**
 * Багш, ажилтан — everyone who works here, in one view.
 *
 * ★ **Four requests, and every one of them is the directory.** The accounts,
 * the groups (for who teaches what), and ESIS's two staff services. Nothing
 * else is called on open: `teacherMovements` and the two мэргэшлийн зэрэг
 * services moved to the «ЭСИС мэдээлэл» tab and are read when it is opened,
 * because a director arriving to find a teacher should not spend five outbound
 * requests to the ministry to do it.
 *
 * ★★ **ESIS is a decoration on our own records, never the spine.** The rows
 * are built from `Membership` and joined on `esisPersonId`; if the ministry
 * answers nothing, the screen is the kindergarten's own staff list and says so
 * by simply not showing ministry columns. If the ministry answers and we hold
 * no account for somebody, that is a row too — the one a director most needs.
 */
export function StaffDirectory({ onInvite }: { onInvite: (prefill?: StaffDirectoryRow) => void }) {
  const { primaryKindergartenId } = useSession();
  const [filters, setFilters] = useState<StaffFilters>(EMPTY_STAFF_FILTERS);
  const [opened, setOpened] = useState<string | null>(null);
  const [linking, setLinking] = useState<string | null>(null);

  const accounts = useQuery({
    queryKey: qk.adminUsers({ q: "", role: "staff-directory", page: "1" }),
    queryFn: () => {
      const params = new URLSearchParams({
        page: "1",
        pageSize: "200",
        roles: STAFF_ROLE_FILTER,
      });
      if (primaryKindergartenId) params.set("kindergartenId", primaryKindergartenId);
      return get(`/users?${params}`, usersSchema);
    },
    enabled: Boolean(primaryKindergartenId),
  });

  /*
   * ★ The groups list, for its teachers. `GET /groups` carries its assignments
   * since 2026-09-23, so "which groups does this person teach" costs one
   * request for the whole directory rather than one per person — which is what
   * §3.4 forbids and what made this column impossible before.
   */
  const groups = useQuery({
    queryKey: qk.adminGroups(),
    queryFn: () => get("/groups?pageSize=100", groupsSchema),
  });

  const esisTeachers = useEsisRows("teachers");
  const esisStaff = useEsisRows("staff");

  const rows = useMemo(
    () =>
      buildStaffDirectory({
        accounts: accounts.data?.items ?? [],
        groups: groups.data?.items ?? [],
        esisTeachers: esisTeachers.rows,
        esisStaff: esisStaff.rows,
      }),
    [accounts.data, groups.data, esisTeachers.rows, esisStaff.rows],
  );

  const visible = useMemo(() => filterStaff(rows, filters), [rows, filters]);
  const summary = staffSummary(rows);
  const openedRow = rows.find((row) => row.key === opened) ?? null;
  const linkingRow = rows.find((row) => row.key === linking) ?? null;

  /*
   * ★ The accounts an ESIS person could be linked to: ours, with no ministry
   * identity yet. Anyone already linked is left out rather than offered and
   * refused with a 409 — and a `personId` may only ever belong to one account,
   * which the server enforces independently.
   */
  const linkCandidates = useMemo(
    () => rows.filter((row) => row.localUserId !== null && row.esisPersonId === null),
    [rows],
  );

  /*
   * ★ The skeleton is gated on our **own** records, not on ESIS.
   *
   * The ministry's two reads are slower and may never answer at all, and a
   * screen that waited for them would show a director an empty staff list
   * because of somebody else's server. The accounts are the spine; ESIS fills
   * columns in when it arrives.
   */
  if (accounts.isPending) return <LoadingState rows={5} />;
  if (accounts.isError) {
    return <ErrorState description={errorMessage(accounts.error)} />;
  }

  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Товч мэдээлэл" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Нийт ажилтан"
          value={summary.total}
          unit="хүн"
          tone="sky"
          art={<UsersRound size={22} aria-hidden />}
        />
        <StatCard
          label="Багш"
          value={summary.teachers}
          unit="хүн"
          tone="cornflower"
          art={<Art name="teacher" size={36} />}
          artSurface={false}
        />
        <StatCard label="Бусад ажилтан" value={summary.others} unit="хүн" tone="teal" />
        {/*
          ★ The one tile that is a to-do rather than a fact, and it is toned as
          one. A teacher with no group assignment reaches no child at all —
          `canAccessChild` resolves access through the groups they are actively
          assigned to — so this number is the count of teachers who cannot yet
          do their job, not a statistic.
        */}
        <StatCard
          label="Бүлэггүй багш"
          value={summary.unassignedTeachers}
          unit="хүн"
          tone={summary.unassignedTeachers > 0 ? "sun" : "mint"}
          href="/admin/groups"
        />
      </section>

      <StaffToolbar
        filters={filters}
        onChange={setFilters}
        groups={groups.data?.items ?? []}
        action={
          <Button size="sm" onClick={() => onInvite()}>
            <UserPlus size={18} />
            Хэрэглэгч нэмэх
          </Button>
        }
      />

      {/*
        ★ A read the ministry refused is reported, in a sentence, once — and it
        does not replace the screen. The kindergarten's own staff are still on
        it; what is missing is the ESIS column. Raw error text never reaches
        here: the panel on the «ЭСИС мэдээлэл» tab is where a code belongs.
      */}
      {esisTeachers.isError || esisStaff.isError ? (
        <p className="rounded-control bg-sun px-3 py-2 text-caption text-sun-ink">
          ЭСИС-ээс мэдээлэл шинэчлэхэд алдаа гарлаа. Доорх жагсаалт энэ системийн бүртгэлээр
          харагдаж байна.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title="Бүртгэлтэй ажилтан алга байна"
          description="«Хэрэглэгч нэмэх»-ээр урих эсвэл ажилтан өөрөө цэцэрлэгийн ЭСИС дугаараар бүртгүүлнэ."
        />
      ) : visible.length === 0 ? (
        /*
          ★ A filter that matches nothing is not an empty kindergarten, and
          must not read as one — the only difference that matters to somebody
          who has just typed a name.
        */
        <EmptyState
          title="Хайлтад тохирох ажилтан олдсонгүй"
          description="Хайлт, шүүлтээ өөрчилж үзнэ үү."
        />
      ) : (
        <StaffTable rows={visible} onOpen={(row) => setOpened(row.key)} />
      )}

      {openedRow ? (
        <StaffDetailDrawer
          row={openedRow}
          kindergartenId={primaryKindergartenId}
          onClose={() => setOpened(null)}
          onInvite={(row) => {
            setOpened(null);
            onInvite(row);
          }}
          onLink={
            linkCandidates.length > 0
              ? (row) => {
                  setOpened(null);
                  setLinking(row.key);
                }
              : undefined
          }
        />
      ) : null}

      {linkingRow && primaryKindergartenId ? (
        <StaffLinkDialog
          row={linkingRow}
          kindergartenId={primaryKindergartenId}
          candidates={linkCandidates}
          onClose={() => setLinking(null)}
        />
      ) : null}
    </div>
  );
}
