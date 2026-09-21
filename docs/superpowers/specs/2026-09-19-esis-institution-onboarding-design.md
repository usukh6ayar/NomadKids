# Registering a kindergarten by its ESIS institution id

**2026-09-19 · design**

## Why

A kindergarten is created today by typing its name, address and first
administrator into `POST /platform/kindergartens`, and its ESIS mapping is set
afterwards on a separate card. That leaves a window in which a tenant exists
with no mapping, or with the wrong one, and nothing detects either.

The ministry already holds the name, the address and the staff list, keyed on
one number the operator has in hand after signing the contract. Entering that
number first removes the typing, removes the window, and — the part that
matters more — **proves the paperwork is done before a tenant exists**. An
institution the ministry has not attached to this company account answers `403`
(measured 2026-09-14 against `40284` and `42779`), so a successful lookup is
evidence of the grant, not a convenience.

**Client context, 2026-09-19.** The ministry has granted exactly one
institution, `42778`, with the instruction to trial on it and be ready to
register the organisations that follow. So this work has no user today; its
whole value is readiness.

## Scope

In: the creation flow, a platform-level lookup of an institution and its staff,
choosing the first Захирал/Эрхлэгч from the ministry's own staff list, and
renaming the `ADMIN` label.

Out: the onboarding application path (`POST /applications/:id/approve`) keeps
its current form. It asks for contract terms the ministry knows nothing about,
and adding a second id-driven path there would re-open the "two definitions of
a kindergarten exists" problem that `approveApplicationSchema` records having
just been closed.

## What the operator sees

```
1. ESIS institution ID [ 42778 ]   → «ESIS-ээс татах»

   ✓ Дэгдээхий үрс цэцэрлэг · Цэцэрлэг · Хувийн
     Улаанбаатар, Баянзүрх, 16-р хороо, Гудамж-52, Байр-8

   Name and address fill in, both editable.

2. The staff list arrives with it:

     ○ Батсайхан Оюунаа     эрхлэгч (1341)
     ○ Дорж Сарнай          багш (2342)
     ○ Цэрэн Болд           тогооч (5120)

   The operator picks the Захирал/Эрхлэгч.

3. Save. The kindergarten is created already mapped, the staff roster is
   stored, the chosen person holds ADMIN, and a registration code is issued.

4. Staff register themselves against that roster with their РД, and
   `roleForJobCode` decides each role.
```

Steps 3 and 4 are built. The roster, the registration code, the self-service
form and the job-code mapping all shipped in #106.

### When it goes wrong

| Condition                                             | What the screen says                                                         |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| Ministry has not granted the institution (ESIS `403`) | «Яам энэ институцид эрх олгоогүй байна. Гэрээний дараа яамнаас нэмүүлнэ үү.» |
| No such institution (empty `RESULT`)                  | «Ийм institutionId олдсонгүй.»                                               |
| Already registered (`esisInstitutionId` is `@unique`) | «Энэ институц аль хэдийн бүртгэлтэй: Дэгдээхий үрс цэцэрлэг»                 |
| Not a kindergarten                                    | «Энэ байгууллага цэцэрлэг биш (Ерөнхий боловсролын сургууль).»               |
| ESIS unreachable or slow                              | «ESIS хариу өгсөнгүй.» — the id may be left blank and mapped later           |

The id stays **optional**. A deployment can still create a kindergarten with no
ESIS presence, and today's behaviour is unchanged for anyone who leaves the
field empty.

## Shape

### The lookup

```
GET /v1/platform/esis/institutions/:institutionId          @SuperAdmin()
```

Platform-level rather than under `platform/kindergartens/:id/esis`, because at
this moment no kindergarten exists to scope it to. `@SuperAdmin()` throws
`NotFoundException`, so anyone else gets **404** — §1.7 holds.

The `/v1` prefix is this API's own (`main.ts` sets it globally) and has nothing
to do with ESIS's `/v2`. The call to the ministry goes through the catalogue
entry `organization` (apiId 59, `/svc/api/hub/v2/organization/info`) and
`staff`, never a hand-written URL: the catalogue is what carries the grant
matrix, the field lists, the logging and the `SCOPE_DENIED` / `TIMEOUT` /
`NETWORK` classification that every other reader shares.

Response, as a new `esisInstitutionLookupSchema` in `@kinder/contracts`:

```ts
{
  institutionId: string,
  name: string,               // institutionName
  longName: string,
  address: string | null,     // institutionAddress
  classification: string | null,   // "Цэцэрлэг"
  propertyType: string | null,     // "Хувийн"
  isKindergarten: boolean,
  alreadyUsed: boolean,
  staff: Array<{
    personId: string,
    registerNumber: string,   // personRegNumber, upper-cased
    lastName: string,
    firstName: string,
    positionName: string | null,
    jobCode: string | null,
    suggestedRole: Role | null,   // roleForJobCode(jobCode)
  }>,
}
```

Two things about that array that an implementer will otherwise get wrong.

**`suggestedRole: null` does not hide the row.** The эрхлэгч (`1341`) and the
жижүүр (`5153`) both map to `null`, and the эрхлэгч is the person this screen
exists to pick. `suggestedRole` describes what self-registration would grant
this person unattended; it is not a filter on who may be chosen.

**`personId` and `registerNumber` cross the boundary as strings, and
`personId` arrives as a `number`.** The live payload types are `personId`
number (13 digits), `civilId` number (12), `assignmentId` number (15),
`personRegNumber` string (10). `Child.esisPersonId` and the roster store text,
and the last time a numeric ESIS id was declared to be a string the roster died
on it — so the conversion belongs in the parser, once, not at each call site.

ESIS `403` surfaces as **409 `SCOPE_DENIED`**, not 403: the refusal is a fact
about the ministry's grant, not about this actor's authorisation, and passing it
through as 403 would put a second meaning on the one status §1.7 reserves.

**`staff` must be read through the existing reader.** The live payload carries
`microsoftEmailPass` and `googleEmailPass` — real credentials — and
`ESIS_DESTROYED_FIELDS` removes them unconditionally. A fresh `fetch` in a new
service would bypass that and put passwords on an operator's screen and into
audit metadata. This is the single hardest constraint in this document.

Two further properties of the staff list are already handled and must not be
re-derived: `school/staff` is the superset (`teacher/list` repeats a person),
and it sends register numbers in **lower case**, which the roster upper-cases
with a test pinning it.

### Creation

`createKindergartenSchema` gains two optional fields:

```ts
esisInstitutionId?: string          // "42778"
adminEsisPersonId?: string          // which staff row becomes ADMIN
```

`PlatformService.create` **re-runs the lookup server-side before writing**. The
client's prefilled name is just a name — editable, and nobody's authorisation
depends on it — but the id decides a mapping, so it is verified where it is
stored, not where it was typed. A hand-made request cannot save an ungranted
id.

On success, inside the existing transaction: the kindergarten row carries
`esisInstitutionId`, `esisEnvironment` and `esisMappedAt`; the staff roster is
stored; the chosen person gets the `ADMIN` membership; an `EsisMapping` audit
row is appended beside the existing creation audit.

If `adminEsisPersonId` is given, the admin's names come from the roster row and
only the login name is typed — a login name has to be something a person can
type and remember, and Mongolian names have no one obvious latin form, which is
the reason `approveApplicationSchema` already asks for it rather than deriving
it.

### `esisEnvironment`

There is **no deployment-level TEST/PRODUCTION setting**. `EsisConfig` has no
environment notion, no `ESIS_ENVIRONMENT` variable exists, and
`mappingMatchesDeployment` is literally `mapped`. The value is derived from
`ESIS_BASE_URL`: the official hub (`hubv2.esis.edu.mn`) is `PRODUCTION`,
anything else is `TEST`. That gives the column a meaning it does not currently
have and removes a choice an operator can only get wrong.

### The role label

`ROLE_LABEL.ADMIN` changes from `"Админ"` to `"Захирал/Эрхлэгч"`. One line, one
map, every screen — which is what that map exists for. The client's own term is
эрхлэгч, and `esis.roster.ts` already calls jobCode `1341` by that name.

### The rule this touches, and why it is not weakened

`roleForJobCode` deliberately returns `null` for `1341` (child-care services
managers — the эрхлэгч) and the comment gives the reason:

> this flow has no approval step: a job title in somebody else's database must
> not decide who administers a kindergarten

The objection is to the **absence of an approval step**, not to an эрхлэгч
holding `ADMIN`. Creation has one: a superadmin is present and picks the person
from the list. So `roleForJobCode` is left exactly as it is — self-registration
still refuses to mint an administrator — and the operator's explicit choice is
what grants `ADMIN`, in a flow that records an audit row naming who chose.

`ACCOUNTANT` stays invitation-only, unchanged.

## Testing

- The lookup answers **404** for a teacher, an admin and an accountant, through
  HTTP against the real route (§4.1).
- ESIS `403` becomes `409 SCOPE_DENIED`; a timeout becomes `502`; an empty
  `RESULT` becomes `404`.
- `microsoftEmailPass` and `googleEmailPass` never appear in the lookup
  response — asserted on the serialised body, not on an intermediate object.
- Creating with an id the stub refuses does not write a kindergarten.
- Creating with a valid id writes the mapping, the roster and the ADMIN
  membership in one transaction, and rolls back together.
- `esisInstitutionId` uniqueness surfaces as the "already registered" message
  rather than a 500.
- A created kindergarten's `esisEnvironment` follows `ESIS_BASE_URL`.

The ESIS reader is stubbed in the api suite — a green suite proves nothing
about the live service, so the happy path is additionally exercised by hand
against `42778`, whose lookup succeeds and whose creation correctly stops at
"already registered". **The full success path cannot be proven live until the
ministry grants a second institution.** That is a property of the trial, not a
gap in the tests, and it is the first thing to re-check when the second grant
arrives.
