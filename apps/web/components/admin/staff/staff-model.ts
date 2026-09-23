import { ROLE_LABEL, type Role } from "@kinder/contracts";

/**
 * One person who works here, assembled from every place this product knows one.
 *
 * ★ **Why a view model rather than three sections.** `/admin/users` used to
 * render the kindergarten's own accounts, then ESIS `teacher/list`, then ESIS
 * `school/staff`, as three tables one after another. A director looking for
 * "Г.Баяр" found him up to three times and had to know which of the ministry's
 * two services carried the field they wanted. Those are implementation facts —
 * that ESIS answers the staff question with two endpoints and that one of them
 * repeats people — and a staff directory should not make anybody learn them.
 *
 * ★★ **The raw panels are not deleted.** They moved to the screen's «ESIS
 * мэдээлэл» tab, where reconciling our records against the ministry's is the
 * actual task. This merges the concepts for daily work; it does not merge the
 * sources.
 */
export interface StaffDirectoryRow {
  /**
   * A stable React key.
   *
   * ★ Derived from whichever identity proved this person exists — the local
   * account if there is one, otherwise the ESIS person. Never the index, and
   * never the name: both change position as filters narrow, which remounts
   * every row and closes the drawer the reader had open.
   */
  key: string;
  localUserId: string | null;
  esisPersonId: string | null;
  lastName: string;
  firstName: string;
  /** Whether this person teaches, decided by identity rather than by job title. */
  kind: StaffKind;
  /** Their roles *in this kindergarten*, from `Membership`. Empty for ESIS-only. */
  roles: Role[];
  /** `false` only for a closed account. An ESIS-only person has no account to close. */
  isActive: boolean;
  source: StaffSource;
  /** Contact details, from our own record. ESIS's official e-mail is separate. */
  contact: { phone: string | null; email: string | null; username: string | null };
  /** `school/staff` — employment: the post, the qualification, the years. */
  employment: StaffEmployment | null;
  /** `teacher/list` — the teaching assignment. */
  teaching: StaffTeaching | null;
  /** Local `GroupTeacher` rows. This, not ESIS, is what NomadKids authorizes on. */
  assignedGroups: StaffGroupAssignment[];
}

/**
 * Багш or Бусад ажилтан.
 *
 * ★ **Decided by identity, never by job title.** Somebody is a teacher if they
 * hold a TEACHER membership here or if ESIS's `teacher/list` carries them —
 * not because their `positionName` contains "багш". The title is free text and
 * "Багшийн туслах" contains the word without being one.
 *
 * ★★ That rule is only safe if the ministry's two staff services nest, and
 * they do: measured live on institution 42778, 2026-09-23
 * (`scripts/esis-staff-overlap-probe.ts`), `teacher/list` held 9 distinct
 * people and `school/staff` 13, with **nobody in the first and not the
 * second**. The four who were only in `school/staff` were two тогооч, a жижүүр
 * and the эрхлэгч — so there is no case where this files a real teacher under
 * "Бусад ажилтан" beside an Албан тушаал that says otherwise.
 */
export type StaffKind = "TEACHER" | "OTHER";

/**
 * Where this person is on record.
 *
 * `BOTH` is the settled case. `LOCAL_ONLY` is somebody invited here that the
 * ministry has not been told about — or simply an account whose `esisPersonId`
 * was never filled, which is every invited account (`createInvitedAccount`
 * does not set one). `ESIS_ONLY` is the actionable one: the ministry lists
 * them, they cannot sign in here yet.
 */
export type StaffSource = "BOTH" | "LOCAL_ONLY" | "ESIS_ONLY";

export interface StaffGroupAssignment {
  groupId: string;
  name: string;
  /** `LEAD` | `ASSISTANT`, as `GroupTeacher.role` stores it. */
  role: string | null;
}

export interface StaffEmployment {
  positionName: string | null;
  jobCode: string | null;
  /** Мэргэшил. */
  minor: string | null;
  yearsOfService: string | null;
  educationSectorYears: string | null;
  /** Үндсэн ажлын байр эсэх. */
  primaryFlag: string | null;
  officialEmail: string | null;
}

export interface StaffTeaching {
  positionName: string | null;
  instructorTypeName: string | null;
  subjectDepartmentName: string | null;
  instructorAvailability: string | null;
  officialEmail: string | null;
}

/**
 * What the Төлөв column says, and what a filter narrows on.
 *
 * ★ Three states, not two, because "needs attention" is the reason this column
 * exists. A directory that only distinguished open accounts from closed ones
 * would answer a question nobody asks; the one a director does ask is which
 * rows are their to-do list.
 */
export type StaffStatus = "ACTIVE" | "ATTENTION" | "CLOSED";

/** The local rows this builder reads — a subset of `adminUserSchema`. */
export interface LocalStaffAccount {
  id: string;
  lastName: string;
  firstName: string;
  username?: string | null;
  phone?: string | null;
  email?: string | null;
  isActive?: boolean | null;
  esisPersonId?: string | null;
  memberships?: { role: Role; isActive?: boolean | null }[];
}

/** The group rows this builder reads — a subset of `groupListItemSchema`. */
export interface GroupWithTeachers {
  id: string;
  name: string;
  teachers?: {
    role?: string | null;
    endedOn?: string | null;
    membership?: { user?: { id: string } | null } | null;
  }[];
}

/** One ESIS record, as `esisRowSchema` delivers it. */
export type EsisRow = Record<string, string | null>;

/**
 * Everything the directory is built from.
 *
 * ★ ESIS's two lists arrive separately and stay separate in here, because they
 * answer different questions and neither is a subset of the other in content:
 * `teacher/list` carries the teaching assignment, `school/staff` carries
 * employment. It is only the *people* that overlap.
 */
export interface StaffDirectoryInput {
  accounts: LocalStaffAccount[];
  groups: GroupWithTeachers[];
  esisTeachers: EsisRow[];
  esisStaff: EsisRow[];
}

const text = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

/**
 * The ministry's id for a row, or null when it did not send one.
 *
 * ★ Null is never treated as a match. Two rows that both lack a `personId` are
 * two different people as far as this function is concerned — the alternative
 * is joining strangers together because neither could be identified, which is
 * worse than showing one person twice.
 */
const personIdOf = (row: EsisRow): string | null => text(row.personId);

/**
 * Deduplicates the ministry's rows by `personId`, keeping the fullest.
 *
 * ★ **`teacher/list` repeats people**, which is recorded rather than
 * discovered here: one live person came back on two rows, because the service
 * is keyed by `assignmentId` and a teacher may hold more than one assignment.
 * Rendering both put the same name on the screen twice under a heading that
 * claimed to be a list of staff.
 *
 * ★★ "Fullest" means most non-empty values, not first or last. The duplicate
 * rows are not identical: one assignment may carry a заах аргын нэгдэл the
 * other leaves blank, and picking by position would silently prefer whichever
 * the ministry happened to order first.
 */
export function dedupeByPerson(rows: EsisRow[]): EsisRow[] {
  const byPerson = new Map<string, EsisRow>();
  const unidentified: EsisRow[] = [];

  for (const row of rows) {
    const personId = personIdOf(row);
    if (!personId) {
      unidentified.push(row);
      continue;
    }
    const seen = byPerson.get(personId);
    if (!seen || filledCount(row) > filledCount(seen)) byPerson.set(personId, row);
  }

  return [...byPerson.values(), ...unidentified];
}

const filledCount = (row: EsisRow): number =>
  Object.values(row).filter((value) => text(value) !== null).length;

/**
 * Builds the one list the screen renders.
 *
 * ★ **Joined on `esisPersonId` and nothing else.** Mongolian kindergartens
 * have several Bat-Erdenes and one register of names is not an identity. The
 * project already carries the key for this — `User.esisPersonId`, added so an
 * ESIS row could find the account it belongs to — and where it is absent the
 * two records stay two rows rather than being guessed together.
 *
 * ★★ Local accounts lead. A person with an account here is a person this
 * product can act on, and ESIS decorates that record rather than replacing it:
 * the name shown is the one in our own database, because that is the name the
 * rest of NomadKids — a group header, an observation, an audit row — will use.
 */
export function buildStaffDirectory(input: StaffDirectoryInput): StaffDirectoryRow[] {
  const teacherRows = dedupeByPerson(input.esisTeachers);
  const staffRows = dedupeByPerson(input.esisStaff);

  const teacherByPerson = indexByPerson(teacherRows);
  const staffByPerson = indexByPerson(staffRows);
  const groupsByUser = groupAssignmentsByUser(input.groups);

  const rows: StaffDirectoryRow[] = [];
  /** Every ESIS person already shown on a local account's row. */
  const claimed = new Set<string>();

  for (const account of input.accounts) {
    const personId = text(account.esisPersonId);
    if (personId) claimed.add(personId);

    const teaching = personId ? teacherByPerson.get(personId) : undefined;
    const employment = personId ? staffByPerson.get(personId) : undefined;
    const roles = activeRoles(account);

    rows.push({
      key: `local:${account.id}`,
      localUserId: account.id,
      esisPersonId: personId,
      lastName: account.lastName,
      firstName: account.firstName,
      kind: roles.includes("TEACHER") || teaching ? "TEACHER" : "OTHER",
      roles,
      isActive: account.isActive !== false,
      source: personId && (teaching || employment) ? "BOTH" : "LOCAL_ONLY",
      contact: {
        phone: text(account.phone),
        email: text(account.email),
        username: text(account.username),
      },
      employment: employment ? readEmployment(employment) : null,
      teaching: teaching ? readTeaching(teaching) : null,
      assignedGroups: groupsByUser.get(account.id) ?? [],
    });
  }

  /*
   * ★ Then everybody ESIS lists who has no account here — the gap the screen
   * exists to surface. They are built from both services at once, so a person
   * who appears in `school/staff` only is one row and not a second entry below
   * the teachers.
   *
   * ★★ `school/staff` is iterated first because it is the superset. Starting
   * from `teacher/list` would file a person under the service that happens to
   * mention them rather than under the one that describes their post.
   */
  for (const row of [...staffRows, ...teacherRows]) {
    const personId = personIdOf(row);
    if (personId && claimed.has(personId)) continue;
    if (personId) claimed.add(personId);

    const teaching = personId ? teacherByPerson.get(personId) : undefined;
    const employment = personId ? staffByPerson.get(personId) : undefined;
    /*
     * A row the ministry sent with no `personId` cannot be matched to anything
     * and cannot be matched *against* anything either, so it stands alone as
     * whichever service produced it.
     */
    const asTeaching = teaching ?? (teacherRows.includes(row) ? row : undefined);
    const asEmployment = employment ?? (staffRows.includes(row) ? row : undefined);

    rows.push({
      key: personId ? `esis:${personId}` : `esis-row:${rows.length}`,
      localUserId: null,
      esisPersonId: personId,
      lastName: text(row.lastName) ?? "",
      firstName: text(row.firstName) ?? text(row.displayName) ?? "",
      kind: asTeaching ? "TEACHER" : "OTHER",
      roles: [],
      isActive: true,
      source: "ESIS_ONLY",
      contact: { phone: null, email: null, username: null },
      employment: asEmployment ? readEmployment(asEmployment) : null,
      teaching: asTeaching ? readTeaching(asTeaching) : null,
      assignedGroups: [],
    });
  }

  return rows.sort((left, right) => displayName(left).localeCompare(displayName(right), "mn-MN"));
}

const indexByPerson = (rows: EsisRow[]): Map<string, EsisRow> => {
  const index = new Map<string, EsisRow>();
  for (const row of rows) {
    const personId = personIdOf(row);
    if (personId) index.set(personId, row);
  }
  return index;
};

const activeRoles = (account: LocalStaffAccount): Role[] => {
  const roles = (account.memberships ?? [])
    .filter((membership) => membership.isActive !== false)
    .map((membership) => membership.role);
  return [...new Set(roles)];
};

/**
 * Which groups each teacher is assigned to, from the groups list itself.
 *
 * ★ Read off `GET /groups`, which carries its assignments — so the whole
 * directory costs one groups request rather than one per person. An ended
 * assignment never arrives (the API filters `endedOn`), and the guard here is
 * belt and braces: a retired assignment shown as current would tell a director
 * a class is covered when it is not.
 */
const groupAssignmentsByUser = (
  groups: GroupWithTeachers[],
): Map<string, StaffGroupAssignment[]> => {
  const byUser = new Map<string, StaffGroupAssignment[]>();
  for (const group of groups) {
    for (const assignment of group.teachers ?? []) {
      if (assignment.endedOn) continue;
      const userId = assignment.membership?.user?.id;
      if (!userId) continue;
      const list = byUser.get(userId) ?? [];
      list.push({ groupId: group.id, name: group.name, role: assignment.role ?? null });
      byUser.set(userId, list);
    }
  }
  return byUser;
};

const readEmployment = (row: EsisRow): StaffEmployment => ({
  positionName: text(row.positionName),
  jobCode: text(row.jobCode),
  minor: text(row.minor),
  yearsOfService: text(row.yearsOfService),
  educationSectorYears: text(row.educationSectorYears),
  primaryFlag: text(row.primaryFlag),
  officialEmail: text(row.allEmail) ?? text(row.microsoftEmail) ?? text(row.googleEmail),
});

const readTeaching = (row: EsisRow): StaffTeaching => ({
  positionName: text(row.positionName),
  instructorTypeName: text(row.instructorTypeName),
  subjectDepartmentName: text(row.subjectDepartmentName),
  instructorAvailability: text(row.instructorAvailability),
  officialEmail: text(row.allEmail) ?? text(row.microsoftEmail) ?? text(row.googleEmail),
});

/** `Г.Баяр` — the surname as an initial, as every other screen writes it. */
export function displayName(row: StaffDirectoryRow): string {
  const last = row.lastName.trim();
  const first = row.firstName.trim();
  if (!first) return last || "—";
  return last ? `${last[0]!.toUpperCase()}.${first}` : first;
}

/** The whole name, for searching. A teacher typing a surname must find it. */
export function searchableName(row: StaffDirectoryRow): string {
  return [row.lastName, row.firstName].filter(Boolean).join(" ");
}

/**
 * The Албан тушаал cell.
 *
 * ★ The ministry's word for the post first, ours second. `positionName` is
 * what the person's own employment record says — "Бүлгийн багш", "Нягтлан
 * бодогч" — and it is more specific than the five role names this product
 * assigns. The roles are the fallback, not the other way round, because a role
 * is what somebody may *do here* rather than what they are employed as.
 */
export function positionLabel(row: StaffDirectoryRow): string | null {
  const fromEsis = row.employment?.positionName ?? row.teaching?.positionName;
  if (fromEsis) return fromEsis;
  const roles = row.roles.map((role) => ROLE_LABEL[role]).filter(Boolean);
  return roles.length > 0 ? roles.join(", ") : null;
}

/**
 * What the Төлөв column says.
 *
 * ★ `ATTENTION` covers two different to-dos, and that is deliberate: both are
 * "this person cannot do their job in NomadKids yet". A teacher with no group
 * reaches no child (`canAccessChild` resolves through assignments), and a
 * person ESIS lists with no account here cannot sign in at all. The drawer
 * names which of the two it is; the column only has to draw the eye.
 */
export function staffStatus(row: StaffDirectoryRow): StaffStatus {
  if (row.source === "ESIS_ONLY") return "ATTENTION";
  if (!row.isActive) return "CLOSED";
  if (row.kind === "TEACHER" && row.assignedGroups.length === 0) return "ATTENTION";
  return "ACTIVE";
}

/**
 * Why a row needs attention, in a sentence, or null when it does not.
 *
 * Kept beside `staffStatus` so the two cannot disagree about what "Анхаарах"
 * means on a row.
 */
export function attentionReason(row: StaffDirectoryRow): string | null {
  if (row.source === "ESIS_ONLY") return "ЭСИС-д бүртгэлтэй ч NomadKids бүртгэлгүй байна.";
  if (!row.isActive) return "Бүртгэл хаагдсан байна.";
  if (row.kind === "TEACHER" && row.assignedGroups.length === 0) {
    return "Бүлэг хуваарилаагүй тул хүүхдийн мэдээлэл харах эрхгүй байна.";
  }
  return null;
}

export const STAFF_STATUS_LABEL: Record<StaffStatus, string> = {
  ACTIVE: "Идэвхтэй",
  ATTENTION: "Анхаарах",
  CLOSED: "Хаагдсан",
};

export const STAFF_KIND_LABEL: Record<StaffKind, string> = {
  TEACHER: "Багш",
  OTHER: "Бусад ажилтан",
};

/** The filter state the toolbar owns and the table reads. */
export interface StaffFilters {
  query: string;
  kind: StaffKind | "";
  /** A local group id, or `"NONE"` for the teachers assigned to none. */
  groupId: string;
  status: StaffStatus | "";
}

export const EMPTY_STAFF_FILTERS: StaffFilters = { query: "", kind: "", groupId: "", status: "" };

/** Applies the toolbar to the directory. Pure, so the screen's test can be too. */
export function filterStaff(rows: StaffDirectoryRow[], filters: StaffFilters): StaffDirectoryRow[] {
  /*
   * ★ `toLocaleLowerCase("mn-MN")`, as the group roster's search does. Cyrillic
   * Ө and Ү case-fold correctly only under the Mongolian locale, so a director
   * typing "өнө" for Өнөбилэг finds nothing without it.
   */
  const needle = filters.query.trim().toLocaleLowerCase("mn-MN");

  return rows.filter((row) => {
    if (filters.kind && row.kind !== filters.kind) return false;
    if (filters.status && staffStatus(row) !== filters.status) return false;

    if (filters.groupId === "NONE") {
      if (row.assignedGroups.length > 0) return false;
    } else if (filters.groupId) {
      if (!row.assignedGroups.some((group) => group.groupId === filters.groupId)) return false;
    }

    if (!needle) return true;
    return searchableName(row).toLocaleLowerCase("mn-MN").includes(needle);
  });
}

/**
 * The four tiles at the head of the screen.
 *
 * ★ **"Нийт ажилтан" counts the rows, which is not the same as counting
 * accounts.** It includes the people ESIS lists that this product holds no
 * account for, because they are on the screen and a total that disagreed with
 * the list under it would be read as a bug. It therefore *rises* when the
 * ministry's reads land, and falls back to our own staff if ESIS says nothing
 * — both of which are the honest answer to "how many people work here" given
 * what is known at that moment. A count of sign-ins is a different question
 * and `/admin/staff-code` is where it is asked.
 *
 * ★★ **"Бүлэггүй багш" counts teachers who have an account here**, and that
 * narrowing is the honest one. An ESIS-only teacher also has no group, but
 * their to-do is "invite them", not "assign them" — and they are already
 * counted as Анхаарах by `staffStatus`. Folding them in would make the tile
 * read as a bigger assignment backlog than exists.
 */
export function staffSummary(rows: StaffDirectoryRow[]) {
  const teachers = rows.filter((row) => row.kind === "TEACHER");
  return {
    total: rows.length,
    teachers: teachers.length,
    others: rows.length - teachers.length,
    unassignedTeachers: teachers.filter(
      (row) => row.localUserId !== null && row.isActive && row.assignedGroups.length === 0,
    ).length,
  };
}
