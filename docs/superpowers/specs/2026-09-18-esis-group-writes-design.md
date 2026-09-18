# ESIS spec №3б — the write half, and the three services that have something to send

**Date:** 2026-09-18 · **Predecessor:** `2026-09-15-esis-full-coverage-design.md` §6.1

Spec №3а built the read side of §6 — three sync tiers, a manual pull, one
`EsisSyncRun` behind all of them. This is the other half: **prepare → show the
exact payload → a human approves → send**, and the record that survives it.

---

## 1. Three, not seven

§6.1 names seven writes: `150, 152, 162, 129, 131, 73, 72`. Four of them are
not built here, and the reason is the same for all four in different words:
**there is nothing in this product to send.**

| Service                      | Why not now                                                                                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **129, 131** cook form 1 / 2 | `esis.endpoints.ts` and `esis.catalog.ts` each already refuse them, in writing: filing a school's food-income return is a decision made against a ledger, and nothing here is the thing that files it. The **read** halves (130, 132) are wired  |
| **73** өрхийн мэдээлэл       | `esis.endpoints.ts` has **no entry for apiId 73** — its path is not known in this codebase. See §1.2: the household writes that _do_ have paths are already built, by a different mechanism, and neither of them is 73                           |
| **72** цол, шагнал           | Also no endpoint entry. And its read half, `studentAwards` (**85**), answered **203** against a real child on institution 42778, so the field names are unknown. A write whose shape is a guess is a write into the ministry's production record |

That is not a gap in coverage. It is four **named states** on the 84/84 matrix
(§7), which is stronger evidence than a silent omission: everything granted is
accounted for, and the four that are not called have a reason a reader can
check.

★ The registry in §3 takes a fourth entry without structural change. When
§1.3 is revisited, or the ministry answers what 72 and 73 actually are, the
work is one entry and one payload builder — not a second harness.

### 1.1 What is built

| apiId   | Path                                             | What                    |
| ------- | ------------------------------------------------ | ----------------------- |
| **150** | `POST /svc/api/hub/v2/student/group/info/create` | бүлэг үүсгэх            |
| **152** | `POST /svc/api/hub/v2/student/group/info/update` | бүлэг засах, устгах     |
| **162** | `POST /svc/api/hub/v2/group/instructor/save`     | бүлгийн багш тохируулах |

All three are the client's own request — the "татах, илгээх" pair on the group
screen, whose read half (`groupsNextYear`, 14) shipped with №3а and has been
waiting for this. And all three send data this product **holds**: `Group`,
its `schoolYearId`, its `ageBand`, and the teacher assigned to it.

### 1.2 There is already a write path, and it is not this one

`POST /kindergartens/:id/esis/write` exists and works:
`EsisAdminService.write()` → a `switch` → `EsisService.saveStudentContacts()`
and its siblings. It covers the child-record saves a teacher fills in,
**including `studentStatisticsSave` (86) and `studentConditionSave` (71)** —
the household and living-condition writes. So "there is nothing to send" is
not true of household writes in general; it is true of **apiId 73**, which is
a different service whose path nobody here has.

That existing path is **pass-through**: the screen shows what ESIS sent, the
family corrects it, and it goes back. Nothing is stored — the catalog says so
(_"No column holds these yet"_), and `ESIS_REQUEST.md` §1.3's exclusion of
"суралцагчийн өрхийн байдал" is why nothing should be. It sends immediately,
with an audit row and no approval step, which is right for a field a teacher
just typed and read back.

★ **The group writes cannot use it.** Pass-through means the caller supplies
the payload; §3 rejects that for these three, because a group write is built
from `Group` rather than echoed, and because the thing being approved has to
be the thing being sent. Two mechanisms, two arguments, and this spec does not
touch the older one.

★★ It also means the plan must not extend `esisWriteSchema`'s
`ESIS_WRITE_RESOURCES`. Adding `groupCreate` there would put an unapproved,
immediate group write behind a route a **teacher** can call.

---

## 2. The harness is the deliverable

Seven endpoints would be a week. The thing that takes the time, and the thing
that has to be right because the trial runs against production, is the record
around them.

### 2.1 `EsisWriteRequest`

```prisma
model EsisWriteRequest {
  id             String @id @default(uuid()) @db.Uuid
  kindergartenId String @db.Uuid               // §3.1, one filter enforces isolation

  /// The registry key — `groupCreate`, `groupUpdate`, `groupDelete`,
  /// `groupInstructor`. Not the apiId: the id is what ESIS calls it, the key
  /// is what decides which builder ran.
  service   String
  apiId     Int

  /// What it is about, on our side.
  ///
  /// ★ Required, including for a create. «Илгээх» pushes a group that already
  /// exists **here** to the ministry — the director makes the group in
  /// NomadKids and then sends it, which is what the read half (14,
  /// `groupsNextYear`) was always the other side of. There is no flow that
  /// creates a group in ESIS which does not exist locally, and a write whose
  /// subject this database cannot name is a write §3's builders could not
  /// have built.
  groupId   String @db.Uuid

  /// The exact body that will be sent, built in §3 and shown to the approver
  /// verbatim. Stored before approval, never rebuilt after it — the human
  /// approved *these bytes*.
  payload   Json

  state     EsisWriteState @default(PREPARED)

  /// Enforced by us, not by a header. See §4.
  idempotencyKey String @unique

  preparedById String    @db.Uuid
  approvedById String?   @db.Uuid
  approvedAt   DateTime?

  /// ESIS's answer, whole. For `groupCreate` this is not audit — it carries
  /// the ministry's own group id, and §5 needs it as an input.
  response  Json?
  sentAt    DateTime?
  failedAt  DateTime?
  errorCode String?

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  kindergarten Kindergarten @relation(fields: [kindergartenId], references: [id], onDelete: Restrict)
  group        Group        @relation(fields: [groupId], references: [id], onDelete: Restrict)
  preparedBy   User         @relation("EsisWritePreparer", fields: [preparedById], references: [id], onDelete: Restrict)
  approvedBy   User?        @relation("EsisWriteApprover", fields: [approvedById], references: [id], onDelete: Restrict)

  @@index([kindergartenId, createdAt])
  @@index([state, createdAt])
  @@map("esis_write_requests")
}

enum EsisWriteState {
  PREPARED
  APPROVED
  SENT
  FAILED
  CANCELLED
}
```

`Restrict` on every relation, and `deletedAt` per §3.2 — a row recording what
was sent to the ministry is exactly the kind of record somebody reads back.

### 2.2 The states, and what `SENT` does not mean

`PREPARED → APPROVED → SENT | FAILED`, plus `CANCELLED` for a prepared row the
director abandons. `CANCELLED` rather than a `deletedAt`: a payload somebody
looked at and decided against is a decision, and §3.2's soft delete is for
records being retired, not for decisions being recorded.

★ **`SENT` means ESIS answered, not that ESIS agreed.** `response` is stored
whole and shown; a 200 with a refusal inside it is `SENT` with the refusal
visible, because inventing a "rejected" state would require this code to
understand the ministry's semantics, which it does not. The screen shows the
answer; the director reads it.

---

## 3. The registry, and where a payload comes from

★★ **Amended 2026-09-18, after the live probe.** This section said the payload
was built from our own `Group` columns. That was wrong, and wrong in a way no
test could have caught — see `ESIS_API_READINESS.md` §1.1.9. What follows is
what the services themselves said.

One closed registry, keyed by service, in the shape `esis.reference.ts` already
uses for the read side. The screen names a key and a subject id; it never
composes JSON.

### 3.1 The payload is copied from the ministry's own rows

A create needs **eight ids this database does not hold and cannot invent** —
`programOfStudyId`, the `programStageId` for that level, `programPlanId`,
`groupTypeCode`, `groupShiftId`, `groupClassificationId`, `groupCategoryCode`,
`academicGroupId`. The only authority is api-40 (`groups`), which returns them
on every row.

So `buildGroupPayload` takes the institution's group rows and copies:

- a **create** from a sibling at the same level, matched on the ministry's own
  `academicLevelName`
- an **update** and a **delete** from the group's **own** row, found by the id a
  successful create stored

`prepare` therefore makes a live read before it can show anyone anything —
unavoidable, because the payload cannot be displayed until those ids are in
hand, and displaying it is the point of the step. Read, never stored: the ids
are the ministry's and change without telling us.

★ This replaced `AgeBand → 1..4`, a guess that was wrong (the levels are Бага
15 · Дунд 16 · Ахлах 17 · Бэлтгэл 18). Hard-coding 15..18 would have been the
same guess one level down, since those numbers belong to _this_ institution's
programme. The only thing still written by hand is what our own enum already
means in Mongolian.

### 3.2 Three things the services insisted on

- **An `event` on every body.** 152 accepts exactly `update` and `delete` —
  which is what "бүлэг засах, устгах" meant — and rejects `create`. 150 takes
  `create`. **152 wants lower case; 162's stored procedure wants UPPER.** One
  gateway, two layers, two rules, pinned by a test so that normalising the case
  "for consistency" fails here rather than at the ministry.
- **`academicYear` and `studentGroupId`** on 152.
- **A group name of five characters or fewer.** Undocumented anywhere;
  discovered by the first live create, which it refused. Nothing else in this
  product limits `Group.name`, so an ordinary "Дэлбээ" is six. Checked at
  prepare, so a director meets it with a sentence naming the limit rather than
  after approving. A **delete is exempt** — it carries no name, and the
  ministry's own groups are all longer than five.

### 3.2b Two things the first live create taught

★ **api-40 does not list a group it has just created.** 150 answered `200` with
a `studentGroupId` and the next read came back with the original four rows. So
a **delete works from the id alone** — requiring a match in the list would make
a freshly created group impossible to remove through this product, which is the
row most likely to need removing. An **update** still requires the row, because
it carries the programme ids and those must be the group's own.

★★ **A delete is not an update with fewer fields.** Both post to 152, so they
shared `sendGroupUpdate` — whose `.strict()` schema demands `studentGroupName`
and the programme ids that a delete does not carry. The boundary parse was
checking the right shape against the wrong contract. `sendGroupDelete` is its
own method.

★★★ **152's delete deactivates rather than deletes**: "Бүлэг амжилттай
идэвхгүй болголоо". The group leaves api-40's list, which is what makes it
invisible to everything downstream.

### 3.3 162 is blocked on the ministry

`group/instructor/save` answers "Багшийн хариуцах үүрэг оруулна уу." and no
vocabulary for that field exists: not in the thirteen swept reference
resources, and not as an example, because all four of institution 42778's
groups carry `instructorId: null`. Our own `TeacherRole` is `LEAD | ASSISTANT`
and there is no reason to think the ministry shares it.

`buildGroupPayload` throws `ESIS_INSTRUCTOR_ROLE_UNKNOWN`, and prepare turns
that into a sentence saying so. Inventing a value would be sending a guess into
the ministry's register and calling it an integration. It is a question to ask,
not a field to fill.

### 3.4 Layering

Controller parses and calls, service builds and audits, and a repository is the
only file importing `PrismaClient`.

★ A **new** `esis-write.repository.ts`, not more methods on `EsisRepository`.
That file already carries three unrelated concerns, and the base filter differs:
a write request is tenant-scoped and soft-deleted, where reference rows are
hard-replaced and may be national (`kindergartenId` NULL). Two different base
filters in one repository is how a forgotten one becomes a leak.

### 3.5 A teacher's ESIS id

162 identifies the teacher by `User.esisPersonId` — the column spec №2's
self-registration fills — and never by anything the request supplies. NULL is
the ordinary case for a teacher an administrator created by hand, and prepare
refuses rather than leaving it to a worker running after the approval.

## 4. Idempotency is ours to enforce

ESIS honours no idempotency header. A retried job that re-posts `150` creates
a **second group** in the ministry's record, and nothing in this system can
take it back.

- `idempotencyKey` is `@unique` and derived from the registry key, the subject
  id and a hash of the payload. Preparing the same write twice returns the
  existing row rather than a second one.
- The worker **re-reads the row inside the job** and refuses to send when
  `sentAt` is set. A BullMQ retry, a duplicate job, a redelivery after a
  worker restart — all three end at that check.
- The job is enqueued **after the transaction commits** (§3.5). The approval
  and the enqueue are not in one transaction, so a crash between them leaves a
  row in `APPROVED` that the `/admin/esis-sync` queue shows as waiting, and
  which the director can re-approve. A lost job is recoverable; a double post
  is not.

---

## 5. 152's delete, and why it needs 150's answer

152 is one path for two operations. **Update runs against real groups. Delete
runs only against a group we created ourselves.**

- The group screen has no delete-from-ESIS button. There is no undo, and a
  director half-way through a rename is not who should discover that.
- Delete is exercised **once**, against a throwaway group created by 150 with
  no children in it, to prove the path and document the response. That is what
  puts 152 on the matrix as _"wired, both operations, exercised live"_ rather
  than as a claim.

★ **This makes 150's response an input, not just a record.** The delete row's
payload has to name the **ministry's** group id, which only comes back in
150's stored `response`. So `groupDelete`'s builder reads the `EsisWriteRequest`
row of the create it is undoing — the one place in this design where a builder
reads another request rather than a domain table, and the reason the `response`
column is not merely audit.

Delete additionally requires the director to type the group's name, the same
confirmation pattern the product already uses for destructive actions (§5 UI
rules).

---

## 6. Where the director does this

The answer is both, decided the way the panel's home was decided in №3а: the
work happens where the work is, the record lives in one place.

- **On the group screen** — «ЭСИС рүү илгээх» opens the prepared payload,
  shown field by field as ESIS's own names, with Батлах and Болих. This is the
  client's instruction on output: «garaltiin utguudiig bugdiig ni haruulna
  nuuj haaj bolohgui».
- **On `/admin/esis-sync`** — a Бичих tab listing every request with its
  state, who prepared it, who approved it, and the ministry's answer. `/admin`
  because the routes are `@Roles("ADMIN")` and a platform operator holds no
  membership — the same finding that moved the sync panel in `ee16625`.

Authorization: ADMIN, membership re-read per request (§1.3), and a group in
another kindergarten answers **404** (§1.7). Roles are not in the token.

---

## 7. What the tests can prove, and what only a live run can

**A green api suite proves nothing about ESIS.** `apps/api/test/setup.ts`
deletes `ESIS_TOKEN`, so every ESIS route in the suite runs against a stub.
This branch has learned that twice at cost, and §2 of `ESIS_TRIAL_STATE.md`
records both.

So the suite is aimed at the harness, which is where it is useful:

- prepare stores the payload the builder produced, and the preview returns it
  byte for byte
- approve enqueues **after** commit, and nothing enqueues inside a transaction
- a second prepare of the same write returns the first row
- a worker run against a row with `sentAt` set sends **nothing**
- `PREPARED` cannot be sent; `SENT` cannot be re-approved
- a teacher with no `esisPersonId` is refused at prepare, naming the roster
- a group in another kindergarten: **404** at prepare, at approve, and in the
  list (§4.1, through HTTP, against the real route)
- no scheduled job can reach a write — the two recurring tiers are reads

And the live exercise, which is the actual evidence, in this order against
institution 42778:

1. **150** — create `ЗЗЗ туршилт` with no children. Response documented.
2. **162** — assign one teacher to it.
3. **152 update** — rename it.
4. **152 delete** — remove it.

One record at a time, each response written into
`docs/ESIS_API_READINESS.md` §1.1.x before the next. Only after step 4 does
152-update open for real groups.

Then `scripts/esis-probe.ts`, because any schema or parser change invalidates
the last run: the current baseline is **OK 34 · EMPTY 20 · SKIP 1 · PARSE 0**.

---

## 8. Deliberately not done

- **No bulk write.** Every request is one subject, prepared and approved on
  its own. A "send all groups" button is a single approval standing in for
  thirty decisions.
- **No two-person approval.** The preparer may approve. A kindergarten with
  one director would otherwise be unable to use any of this, and nothing in
  the RFP or `нэмэлт.md` asks for segregation of duties here.
- **No delete on a real group**, per §5.
- **No `Payment`-style reversal.** ESIS has no compensating service; the
  reversal of a 150 is a 152-delete, which is why it is in scope at all.
- **72, 73, 129, 131** — §1, recorded on the matrix rather than dropped.
