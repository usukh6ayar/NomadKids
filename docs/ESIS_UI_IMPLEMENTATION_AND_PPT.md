# ESIS UI implementation and presentation content

**Date:** 2026-09-08
**Status:** Internal self-assessment; not a ministry certification

## 1. Implemented in this change

- A platform-admin-only tenant mapping links each kindergarten to one ESIS
  `institutionId`.
- The ADMIN route `/admin/integrations/esis` shows C1-C5 readiness, the 17
  selected endpoints, blockers, dry-run controls, and recent run history.
- A read-only dry-run calls up to four GET services at a time. It changes no
  local records and returns counts plus up to five rows, **field by field**.
- ★ **Completed 2026-09-08, at the client's request** ("гаралтын утгуудыг бүгдийг нь
  дэлгэцэнд харуулах"): every service now publishes its full output field list —
  the name, a Mongolian label, and whether NomadKids keeps the value. Refused
  fields stay on the list with the document that refused them, so the screen
  shows a decision rather than a gap. All 17 services were checked against the
  developer portal on 2026-09-08: 256 outputs and 8 attendance-write inputs.
- ★ An **"ESIS-ээс татах"** control now sits on every screen ESIS data lands on
  — children import, groups, users, kindergarten details, school years, kitchen
  ingredients and recipes, the daily attendance sheet, and each service on the
  integration screen. It opens a read-only dialog: the field contract always,
  the live values once a token exists. It never writes a local record.
- `EsisSyncRun` records status and counts. A database constraint prevents two
  concurrent runs for the same kindergarten, stale locks recover after 15
  minutes, and `AuditLog` records the actor.
- `/children/import` now provides an `Excel / ESIS` source selector.
- TEST/PRODUCTION is visible. The token remains server-only; the UI receives
  presence only, never its value or length.

### 1.1 UI/UX structure

- Sidebar-д endpoint бүрийг тусдаа цэс болгохгүй. ADMIN-ийн **"Багш ба
  байгууллага"** хэсэгт нэг **"ESIS мэдээллийн төв"** байна; 17 сервисийн эрх,
  бүх талбар, demo/live утга, dry-run, түүх энд төвлөрнө.
- Өдөр тутмын ажил дээр context action хэрэглэнэ: цэцэрлэгийн мэдээлэл,
  хичээлийн жил, бүлэг, хэрэглэгч, хүүхэд импорт, ирц, орц, технологийн картын
  header дээр **"ESIS-ээс татах"** байрлана.
- Нэг бичлэгийг label/value detail, олон бичлэгийг scroll-той хүснэгтээр
  харуулна. Live хариу амжилттай ирмэгц demo мөр бүрэн алга болно.
- ESIS төв нээгдэхэд `Сервис ба талбар` tab анхдагчаар харагдаж, 17 сервисийн
  demo бичлэг ба бүх input/output талбар collapse-гүй шууд харагдана. Demo
  харахын тулд `ESIS-ээс татах` дарах шаардлагагүй; уг товч зөвхөн бодит
  read-only хариугаар шинэчилнэ.
- ★ **Сервис бүр demo бичлэгийн бүрэн багцтай** (нийт 74 мөр): 10 суралцагч,
  2 бүлэг, 2 багш, 3 ажилтан, 6 ирцийн мөр, хоолны лавлахын 8 материал/8
  бүтээгдэхүүн гэх мэт. `personId`, `studentGroupId`, `instructorId` нь
  сервисүүдийн хооронд тохирдог тул нэг цэцэрлэгийн зураг болж уншигдана —
  `apps/api/src/integrations/esis/esis.samples.ts`. Утга нь бичлэгийн харагдацад
  байх бөгөөд талбарын жагсаалт нь зөвхөн нэр, төлөв, авахгүй шалтгааныг
  харуулна: нэг утгыг хоёр газар давхардуулбал ижил зохиомол өгөгдөл хоёр
  эх сурвалж мэт харагдана.
- `ESIS_DEMO_MODE=true` үед UI нь **ESIS integration demo / Mock data**,
  **жинхэнэ ESIS холболт хийгдээгүй** гэж тогтмол харуулна. C3-C5 live үе шат
  хүлээгдсэн хэвээр, mock dry-run болон түүх `DEMO_SUCCESS · MOCK` төлөвтэй
  байна. Энэ горимд production request огт илгээгдэхгүй.
- Багшийн `/settings` дээр token байхгүй үед demo, token байгаа үед
  `teacher/list` эсвэл `school/staff`-ийн бодит гаралтын бүх зөвшөөрөгдсөн
  талбар автоматаар харагдана. Ирц дээр API-000269 payload хүүхэд бүрээр
  бэлтгэгдэж, live үед ESIS POST амжилттай болсны дараа local төлөв хадгалагдана.
- `/children/new` нь `students` сервисийн 33 гаралтын талбарыг backend
  contract-оос авч collapse-гүй харуулна. Овог, нэр, хүйс, төрсөн огноо,
  бүлгийг ESIS demo мөрөөс автоматаар бөглөж, регистр болон provider credential
  зэрэг татахгүй талбарыг нэр ба шалтгаантай нь `Авахгүй` гэж ялгана.

### Endpoint evidence дэлгэц

`Удирдлага → ESIS мэдээллийн төв → Сервис ба талбар` нь endpoint сонголттой
бөгөөд endpoint бүр дээр дараах нотолгоог нэг дэлгэцэд үзүүлнэ:

- API нэр, method, URL, direction, request parameter/body;
- `DEMO` эсвэл `LIVE` mode, HTTP status, sync status, сүүлийн ажилласан цаг;
- safe response envelope болон бүх зөвшөөрөгдсөн output field/value;
- field бүрийн NomadKids target, `DIRECT`, `MATCH`, `TRANSFORM`, `REQUEST`,
  `DISPLAY_ONLY`, `NOT_STORED`, `REJECTED` mapping status;
- sync log-ийн `DEMO_SUCCESS`, `SUCCESS`, `FAILED`, `PENDING` төлөв.

Prisma-д үнэхээр байхгүй external ID-г хадгалдаг мэт харуулахгүй. Жишээлбэл
`studentGroupId`, `personId`, programme/stage/plan ID одоогоор `NOT_STORED`;
import хийхийн өмнө тусгай external mapping schema шаардлагатай. Харин
`institutionId → Kindergarten.esisInstitutionId` нь `DIRECT` mapping.

Role хүрээ: удирдлага raw endpoint evidence харна; багш ажлын бүлэг, хүүхэд,
ирцийн safe мэдээлэл ба attendance payload харна; эцэг эх зөвхөн өөрийн
хүүхдийн local sync үр дүнг харна. Food service access болон ESIS finance API
баталгаажаагүй тул тогооч, нягтлангийн дэлгэц `NOT ENABLED`; fake endpoint
үүсгээгүй.

- Бүлгийн ирц `Засах → Хадгалах → ESIS рүү илгээх` гэсэн гурван тусдаа
  үйлдэлтэй. Хадгалсан өдөр бүрэн болмогц API-000269-ийн 8 input болон
  `attendanceList`-ийн хүүхэд бүрийн мөр харагдана; илгээсний дараа `api-22`
  output-ийн 6 талбараар буцаан шалгах харагдац байна.
- Field catalog нь `Гаралт` / `Оролт`, `Авна` / `Авахгүй` / `Илгээнэ` төлөвийг
  ялгаж, авахгүй нууц болон бүртгэлийн талбар бүрийн шалтгааныг харуулна.
- `studentGroupId`, `productId`, `dayDate`, `beginDate` шаарддаг сервисүүд dialog
  дотроо утгаа авна. Дотоод UUID-г ESIS ID гэж таахгүй.

| Ажлын дэлгэц         | ESIS мэдээлэл                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| Цэцэрлэгийн мэдээлэл | Байгууллагын 16 гаралт                                                                                  |
| Хичээлийн жил        | Жилийн төлөвийн 5 гаралт                                                                                |
| Бүлэг                | Бүлгийн 24 гаралт                                                                                       |
| Хүүхэд импорт        | Суралцагчийн 33 гаралт; 4 нууц/бүртгэлийн талбар авахгүй                                                |
| Хэрэглэгч ба эрх     | Багшийн 28, ажилтны 31 гаралт                                                                           |
| Өдөр тутмын ирц      | Ирцийн 6 гаралт; сонголтоор API-000269-ийн 8 оролттой demo payload-ийг хүүхэд бүрээр урьдчилан харуулна |
| Орц                  | Түүхий эдийн 12 гаралт                                                                                  |
| Технологийн карт     | Бүтээгдэхүүний 13 гаралт                                                                                |
| ESIS мэдээллийн төв  | Дээрх болон бүлгийн хүүхэд, шилжилт, хоолны бүх 17 сервис                                               |

## 2. Overall requirement result

Order A/261 has 94 checks: 51 mandatory and 43 recommended.

| Category    | Complete | Partial | Not met | N/A | Total |
| ----------- | -------: | ------: | ------: | --: | ----: |
| Mandatory   |       35 |      14 |       1 |   1 |    51 |
| Recommended |       14 |      11 |      15 |   3 |    43 |

- **69%** of mandatory requirements are fully met.
- **96%** of mandatory requirements are complete or partially implemented.
- The one unmet mandatory requirement is Treasury-system integration.
- ESIS-related checks remain partial until contract, token scope, test, and
  production synchronization evidence exist.

## 3. ESIS requirement traceability

| Source                   | Requirement                                | Status                     | Evidence and implementation                                                                                            |
| ------------------------ | ------------------------------------------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| A/261 general #29        | Two-way education database exchange        | Partial                    | 17 v2 adapters, GET and attendance POST schemas, tenant mapping, operator UI, dry-run, audit; production queue remains |
| A/261 general #30        | API input/output documentation             | Complete                   | `docs/API.md`, `ESIS_API_READINESS.md`, API ID matrix                                                                  |
| A/261 general #31        | Integration capability                     | Complete                   | Isolated NestJS boundary, schema validation, timeout, redaction                                                        |
| A/261 preschool #3       | Receive/send organization and learner data | Partial                    | Organization, year, group, student and movement endpoints; approved import/write remains                               |
| A/261 preschool #37      | Pull the unified food catalog              | Partial                    | APIs 111, 112 and 123-127 plus food preview; local ingredient/recipe mapping remains                                   |
| A/261 preschool #51      | Receive/send teacher and staff data        | Partial                    | Teacher/staff schemas, sensitive-field stripping and preview; account mapping/write remains                            |
| A/465 section 3.4.3      | Name every inbound/outbound service        | Ready                      | 17 endpoints recorded with API ID, slug, method, and product use                                                       |
| A/465 sections 3.7 and 4 | Token and least-privilege API access       | Partial                    | Server-only token and scope matrix; BMTT has not granted scope                                                         |
| A/465 section 3.9        | Privacy and cybersecurity                  | Complete for current scope | RBAC, tenant mapping, token redaction, password/registration-number stripping, audit                                   |
| A/465 section 3.17       | Deliver primary records                    | Partial                    | Attendance v3 live POST ready; official token acceptance and post-write reconcile remain                               |
| A/465 section 3.18       | Advance planning and test environment      | Partial                    | Rollout plan, TEST UI and dry-run; official test token/acceptance remains                                              |
| A/465 section 5          | Correction and history                     | Partial                    | Sync-run/audit history started; field conflicts and three-day SLA cases remain                                         |
| A/465 section 7.3        | Daily attendance and movement              | Partial externally         | Local attendance and token-driven ESIS delivery work; official production acceptance remains                           |

## 4. PPT-ready ten-slide outline

### Slide 1 - NomadKids and ESIS integration

- Preschool operations, child development, attendance, food, and reporting
- Compliance work for Order A/261 and Procedure A/465
- Reporting date: 2026-09-08

### Slide 2 - Legal basis

- 2024 Order A/261: 94 software requirements
- 2025 Procedure A/465: data exchange, token, access, correction, and timing
- Goal: controlled, auditable two-way exchange with the education database

### Slide 3 - Current compliance result

- Mandatory: 35 complete, 14 partial, 1 not met, 1 not applicable
- 69% fully complete; 96% complete or partially implemented
- Unmet mandatory item: Treasury-system integration
- This is an internal assessment, not an external certification

### Slide 4 - ESIS endpoint scope

- Organization and academic year: 2 APIs
- Children, groups, teachers and staff: 6 APIs
- Attendance: 2 APIs, including 1 POST
- Unified food catalog: 7 APIs
- Total: 17 selected endpoints

### Slide 5 - Technical architecture

- Browser -> NomadKids API -> ESIS Hub; the browser never calls ESIS directly
- Bearer token stays in server secret storage
- Zod validation strips unknown and unnecessary sensitive fields
- Timeout, categorized errors, token redaction, and audit logging

### Slide 6 - New operator UI

- C1-C5 readiness cards
- Seventeen-row API access matrix, with output/input counts per service
- Every output field of every service, named, labelled, and marked kept or
  refused — visible before any token exists
- "ESIS-ээс татах" on each screen the data lands on
- TEST/PRODUCTION, institution mapping, and actionable blockers
- Read-only dry-run and recent activity history
- Demo route: `/admin/integrations/esis`

### Slide 7 - Safe import flow

- Platform admin approves the tenant institution mapping
- Kindergarten ADMIN runs up to four read-only datasets
- Counts and limited previews are shown; local data is unchanged
- Next phase: match -> field conflict -> approve -> background import

### Slide 8 - Access and data protection

- A tenant ID mismatch blocks the ESIS request at the API
- Teachers and parents do not see ESIS administration controls
- Platform admin maps institutions without reading kindergarten payloads
- ESIS passwords, registration numbers, and unused identifiers are stripped

### Slide 9 - Ready now and remaining work

**Ready:** 17 contracts, schemas, tenant mapping, readiness UI, dry-run,
history, audit, and Excel/ESIS source UX.

**Remaining:** contract, ACCESS_TOKEN, API scope, test acceptance, external-ID
matching, conflict approval, BullMQ retry/dead-letter, attendance reconciliation,
and approved local food import.

### Slide 10 - Rollout sequence

- T-12 weeks: contract, board decision, API scope
- T-8: token, institution mapping, access review
- T-4: test GET dry-run and contract verification
- T-2: one-group read-only pilot
- T-1: attendance POST/GET reconciliation pilot
- T: one-kindergarten production rollout
- KPI: sync >=99%, attendance reconciliation 100%, critical conflicts 0

## 5. Screenshots to include

1. `/admin/integrations/esis` - C1-C5 overview.
2. `Сервис ба талбар` tab - endpoint matrix and all field values.
3. `Туршилтын таталт` tab - selection and dry-run result.
4. `Түүх` tab - actor, time, and status.
5. `/platform/[id]` - tenant institution mapping.
6. `/children/import` - Excel/ESIS source selection.

## 6. Accurate presentation wording

Use: **"Contracts and safe read-only dry-run for 17 ESIS endpoints are ready.
Production access opens after contract, token scope, and test acceptance."**

Do not claim: **"ESIS is fully connected", "A/261 is 100% complete", or
"production data is synchronizing".** C3-C5 evidence does not yet exist.
