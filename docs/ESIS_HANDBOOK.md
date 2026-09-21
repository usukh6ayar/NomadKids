# ESIS — who can do what, and how

Two audiences in one file, deliberately. Part I is for the people using the
product: what each role can reach and what to do when it refuses. Part II is
for whoever maintains the integration next.

They are together because the interesting answers are the same either way — "a
director may send a group to the ministry, and here is why nobody else can" is
one fact, not two.

**Status, 2026-09-18.** Institution 42778 only. One month. No test environment:
every `POST` reaches the ministry's production register.

---

# Part I — Using it

## 1. Who can do what

| Role                  | ESIS surface                                                                   |
| --------------------- | ------------------------------------------------------------------------------ |
| **Director** (ADMIN)  | Everything below, plus the sync panel, the write queue and the ministry report |
| **Teacher**           | Read a child's ESIS record; send the three child-record forms                  |
| **Cook**              | Read the food catalogue (products, materials, kits)                            |
| **Accountant**        | Read the two food-income statements and the meal-discount list                 |
| **Parent**            | Nothing. No ESIS surface reaches a family                                      |
| **Platform operator** | Token state, granted scope, the institution mapping — no kindergarten data     |

Two rules decide every row of that table:

- **The role list is re-read on every request**, never stored in a login token.
  Removing somebody's assignment takes effect immediately, not when their
  session expires.
- **A service you may not reach answers 404, not 403.** A 403 would confirm the
  record exists. This is the same rule the whole product follows for child data.

## 2. What a director can do

### Pull the ministry's data

`/admin/esis-sync` → **Татах**.

Two buttons, two tiers. Both also run on their own — the reference catalogue
monthly, the staff roster nightly — and the buttons exist for the question no
schedule answers: _is the connection working right now?_

Screens read the **stored copy**, never the live service. An empty database
says "not synced yet" rather than quietly fetching; that is deliberate, so a
slow ministry never becomes a slow screen.

### Send a group to the ministry

The group's own screen → **ЭСИС-д бүртгүүлэх**.

1. Press it. Nothing is sent. The exact JSON that _would_ be sent appears,
   under ESIS's own field names.
2. Read it. What you approve is what goes — there is no second step that
   rebuilds the payload.
3. **Батлах** queues it. **Болих** throws it away.

Three services sit behind those buttons:

| Button            | ESIS | What it does                     |
| ----------------- | ---- | -------------------------------- |
| ЭСИС-д бүртгүүлэх | 150  | Registers the group              |
| Засварыг илгээх   | 152  | Updates a group ESIS already has |
| Багш тохируулах   | 162  | Sets the group's teacher         |

**There is no delete button, and that is not an oversight.** 152 can remove a
group and the ministry offers no undo, so removal is not a control on a working
screen.

### Read the write queue

`/admin/esis-sync` → **Бичих**. Everything prepared, approved, sent or failed,
with the ministry's own answer printed beside it.

"Илгээгдсэн" means **ESIS answered**, not that ESIS agreed. Read their reply.

### Produce the ministry's report

`GET …/esis/coverage` — on screen — or **coverage/export** for the spreadsheet.

One row per granted service: purpose, what triggers it, when it was last
called, how many times, and its state. The summary block at the top carries the
two numbers the ministry asks for, as live formulas — including "granted with
no reason given", which should read **0**.

## 3. When it refuses you

Every refusal below is deliberate. None is a bug.

| Message                                              | What to do                                                     |
| ---------------------------------------------------- | -------------------------------------------------------------- |
| «ЭСИС бүлгийн нэрийг 5 тэмдэгтэд багтаахыг шаарддаг» | Shorten the group's name. The ministry's rule, not ours        |
| «ЭСИС энэ бүлгийг хараахан хараагүй»                 | Send **ЭСИС-д бүртгүүлэх** first; an update needs their id     |
| «Энэ бүлгийн багшид ЭСИС-ийн дугаар алга»            | The teacher must have registered themselves through ESIS       |
| «Энэ насны түвшинд ЭСИС-д бүртгэлтэй бүлэг алга»     | A create copies the programme from a group at the same level   |
| «Энэ сервисийн талбаруудыг ЭСИС баримтжуулаагүй»     | Six services are closed until the ministry documents them (§7) |
| «Энэ илгээлт аль хэдийн шийдэгдсэн байна»            | Somebody approved or cancelled it already                      |
| «Энэ цэцэрлэг ЭСИС-т холбогдоогүй байна»             | The platform operator maps the institution id                  |

---

# Part II — Maintaining it

## 4. The rule that governs everything

> **A green test suite proves nothing about ESIS.**

`apps/api/test/setup.ts` deletes `ESIS_TOKEN`, so every ESIS route under
`vitest` answers from a stub. This branch learned it twice at cost: a
`dateOfBirth` typed as a string when ESIS sends a number, and a `civilId` that
broke all 94 roster rows — both with the suite green.

After any change to a schema, a parser or a reader:

```bash
cd apps/api && set -a && . ../../.env && set +a
ESIS_INSTITUTION_ID=42778 pnpm exec tsx scripts/esis-probe.ts
```

Baseline: **OK 34 · EMPTY 20 · SKIP 1 · PARSE 0**. A new `PARSE` is a schema
you broke.

## 5. The scripts, and which are safe

| Script                         | Touches the ministry | What it does                                |
| ------------------------------ | -------------------- | ------------------------------------------- |
| `esis-probe.ts`                | reads                | One call per reader. The standing check     |
| `esis-groups-snapshot.ts`      | reads                | The ministry's group list, before/after     |
| `esis-portal-reconcile.ts`     | no                   | Our field lists vs the portal's JSON        |
| `esis-write-probe.ts`          | rejected writes      | Asks 13 undocumented writes what they want  |
| `esis-group-write-probe.ts`    | rejected writes      | Same, for 152 and 162                       |
| `esis-group-write-exercise.ts` | **creates a group**  | Needs `--i-mean-it`. Cleans up after itself |

The probes send bodies that **cannot succeed** — `{}`, `{ institutionId }`,
`studentGroupId: 0`. That is the discipline, not caution: a rejected write
teaches the contract and changes nothing, and these services hold children's
medical records.

**150 is never probed.** A rejected update changes nothing; a half-right create
succeeds and leaves a record.

## 6. How to learn a service's contract

The portal documents 24 of our 73 services. For the rest, ask the service:

```bash
# 1. Empty body → what is required at all
{}                        → "institutionId дутуу байна"
# 2. Add it → the next thing it wants
{ institutionId }         → "event утга буруу байна"
# 3. Keep going until it names a field you can supply
{ …, event: "update" }    → "Хичээлийн жил шалгана уу."
```

Three things this method taught that nothing else would have:

- **152 takes a lower-case `event`; 162's stored procedure wants UPPER.** One
  gateway, two layers, two rules.
- **A group's name may be five characters.** Undocumented anywhere. An ordinary
  "Дэлбээ" is six.
- **A refusal ladder tells you what a service rejects, not what it is for.**
  162 got further with `UPDATE` than with `update`, so `UPDATE` looked right —
  and it is the verb for changing a role, not for assigning a teacher. The
  ministry's own page settled it.

### Where field names really come from

**Check the read half first.** Three writes — 86, 71, 101 — carried field names
this product invented, while the read half of each already had the ministry's
real ones. One service, two halves, disagreeing, and only the read had met a
live row.

Before writing a field list, run:

```bash
cd apps/api && pnpm exec tsx scripts/esis-portal-reconcile.ts
```

## 7. What is closed, and why

| Services                       | Why                                                               |
| ------------------------------ | ----------------------------------------------------------------- |
| 72, 73                         | No path in the ministry's export. Household writes go via 86/71   |
| 129, 131                       | File a school's income return; nothing here produces one          |
| 165, 167, 170, 119             | No teacher-qualification module. 119 is 403 despite being granted |
| …776                           | The URL column is empty in the ministry's own spreadsheet         |
| Allergy, prohibited food,      | Field names confirmed by nothing: reads answer `203`, the portal  |
| disability, surgery, incident, | renders none, and the probe cannot reach their validation.        |
| screening (6 writes)           | `ESIS_UNPROVEN_WRITES` refuses them with a 409                    |

Every one of these has a sentence in `ESIS_DISPOSITIONS`, and
`esis-coverage.test.ts` fails if a granted service has neither a wiring nor a
reason. **To close a service, write the sentence there** — not in the report.

## 8. The three guards on a write

ESIS honours no idempotency header. A retried `150` creates a second group
nothing here can remove. Three guards, outermost first:

1. **`idempotencyKey`** — a hash of the payload, unique index. Preparing the
   same write twice returns the first row.
2. **`jobId`** — the request id, so BullMQ refuses a duplicate job.
3. **`sentAt`, re-read inside the worker** — the only one that outlives Redis,
   and the one with its own tests.

Plus `ESIS_GROUP_WRITE_CONTRACT_PROVEN`, which stands at `true` since the live
exercise. It was `false` for a day and earned it: the payload this branch
shipped on the morning of 2026-09-18 was wrong in **structure**, and the gate is
the only reason it never reached the register.

## 9. Things that will waste your day

- **Never run two vitest processes at once**, and never the api and web suites
  together. `beforeEach → resetData` collides and you get
  `sessions_userId_fkey` on login — which looks exactly like an auth bug.
- **`prisma migrate deploy`, never `migrate dev`.** History is divergent;
  `migrate dev` offers a RESET and the local database holds 94 real children.
- **Two databases.** Apply every migration to `DATABASE_URL` _and_
  `TEST_DATABASE_URL`, or you get 41 failures that look like a code defect.
- **Rebuild contracts** after touching `packages/contracts`, or the web silently
  drops fields.
- **Do not run prettier** on `esis.catalog.ts`, `esis.fields.ts`,
  `esis.fields.test.ts`, `esis.service.ts` or `esis-pull-button.tsx`.

## 10. The map

| File                         | What it holds                                    |
| ---------------------------- | ------------------------------------------------ |
| `esis.endpoints.ts`          | Every service's apiId, path and method           |
| `esis.fields.ts`             | Field lists, and how each was established        |
| `esis.requests.ts`           | The grant register, and why anything is unused   |
| `esis.repository.ts`         | Reference rows, roster, sync runs, usage counts  |
| `esis-group-writes.ts`       | Payload builders for 150/152/162                 |
| `esis-write.service.ts`      | prepare → approve → cancel                       |
| `esis-write.sender.ts`       | The one place a write reaches ESIS               |
| `esis-coverage.ts`           | The 84/84 matrix                                 |
| `docs/ESIS_TRIAL_STATE.md`   | **Read this first.** What is proved, what is not |
| `docs/ESIS_API_READINESS.md` | §1.1.x — every live measurement, with dates      |
