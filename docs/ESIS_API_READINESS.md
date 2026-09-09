# ESIS v2 API бэлэн байдлын матриц

**Шалгасан огноо:** 2026-09-08

**Албан ёсны эх:** <https://developerv2.esis.edu.mn/api/structure>

**Hub:** `https://hubv2.esis.edu.mn`

Developer portal-ийн public catalog-д нийт **198 сервис** байна: 119 `GET`,
79 `POST`. NomadKids бүх сервисийг хүсэхгүй. А/261-ийн мэдээлэл солилцоо болон
СӨБ-ын шаардлагыг хангахад шууд хэрэгтэй **17 сервисийг** хамгийн бага эрхийн
зарчмаар сонгож backend adapter-т оруулсан.

Portal-ийн 2026-03-31-ний мэдэгдэл v1 сервисүүдийг 2026-04-01-нээс хааж эхлэхийг
зарласан. Иймээс энэ матриц зөвхөн `/hub/v2/` зам ашиглана.

## 1. “Бэлэн” гэдэг үгийн утга

| Түвшин         | Утга                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------- |
| **C1 Catalog** | ESIS v2 catalog-д API ID, method, URL, талбар, sample байна                              |
| **C2 Code**    | Endpoint registry, Zod validation, domain method, unit test бэлэн                        |
| **C3 Access**  | Манай `ACCESS_TOKEN`-д тухайн API ID зөвшөөрөгдсөн                                       |
| **C4 Test**    | ESIS test орчинд бодит байгууллагын өгөгдлөөр амжилттай шалгасан                         |
| **C5 Live**    | Баталгаатай import, external ID, BullMQ retry/idempotency, attendance reconcile ажиллана |

Одоогийн төлөв: сонгосон 17 сервисийн **C1 + C2 код бүрэн холбогдсон**. Tenant
mapping, operator UI, read-only dry-run, `EsisSyncRun` audit history, багш/ажилтны
live profile, хүүхдийн live template, ирцийн live ID тулгалт ба attendance POST
ажиллана. Official Bearer token тавихад live горим автоматаар нээгдэнэ.
**C3-C5 нотолгоо** нь БМТТ-өөс token scope олгох, test/production орчинд
хүлээн авах шалгалт хийх хүртэл хүлээгдэнэ; энэ нь кодын бус гадаад gate юм.

## 2. Сонгосон endpoint ба ашиглах газар

Бүх замын өмнө default-аар `https://hubv2.esis.edu.mn` орно. `institutionId`-г
backend тухайн tenant-ийн `Kindergarten.esisInstitutionId` mapping-аас нэмнэ.
Ингэснээр нэг provider token олон гэрээт цэцэрлэгийг tenant-safe байдлаар
үйлчилнэ.

### Байгууллага, хүүхэд, хүний нөөц

| API                        | Method ба зам                                            | NomadKids-д ашиглах газар                           | Одоо  |
| -------------------------- | -------------------------------------------------------- | --------------------------------------------------- | ----- |
| 59 / `API-000158`          | `GET /svc/api/hub/v2/organization/info`                  | Цэцэрлэгийн нэр, хаяг, ангилал; onboarding/settings | C1+C2 |
| 61 / `API-000160`          | `GET /svc/api/hub/v2/academic/year/statuses`             | Хичээлийн жил; бүлэг, ирц, тайлангийн filter        | C1+C2 |
| 100004874669811 / `api-40` | `GET /svc/api/hub/v2/group/list`                         | `groups`, багшийн бүлэг, ирцийн roster              | C1+C2 |
| 100004874669777 / `api-8`  | `GET /svc/api/hub/v2/students/list`                      | `children` + `enrollments` эхний import             | C1+C2 |
| 100004874669783 / `api-13` | `GET /svc/api/hub/v2/group/student/list/:studentGroupId` | Бүлгийн хүүхдийн тулгалт                            | C1+C2 |
| 100004874669778 / `2`      | `GET /svc/api/hub/v2/student/movement/v2/:beginDate`     | Элсэлт, шилжилт, гаралтын incremental sync          | C1+C2 |
| 100004874669812 / `api-41` | `GET /svc/api/hub/v2/teacher/list`                       | Багшийн membership, group assignment                | C1+C2 |
| 55 / `API-000154`          | `GET /svc/api/hub/v2/school/staff`                       | Эрхлэгч, эмч, тогооч, нягтлангийн membership        | C1+C2 |

Student/staff payload-д ESIS-ийн sample-аар email password, РД, civil-id зэрэг
талбар ирж болно. NomadKids-ийн schema эдгээрийг зориуд strip хийж, зөвхөн
`personId`, нэр, бүлэг/албан тушаалын хэрэгтэй утгыг application layer-т өгнө.

### Ирц

| API                        | Method ба зам                                                        | NomadKids-д ашиглах газар                       | Одоо  |
| -------------------------- | -------------------------------------------------------------------- | ----------------------------------------------- | ----- |
| 100004874669792 / `api-22` | `GET /svc/api/hub/v2/group/list/attendance/:studentGroupId/:dayDate` | Илгээсний дараах тулгалт, зөрүүний хяналт       | C1+C2 |
| 171 / `API-000269`         | `POST /svc/api/hub/v2/group/school/attendance/save/v3`               | `AttendanceSubmission` бүрийн өдрийн ирц илгээх | C1+C2 |

`v3` нь `institutionId`, `studentGroupId`, `dayDate`, мөн хүүхэд бүрийн
`personId`, `attendReasonCode`, `tardyMinutes`, `attendReasonList` авна. Манай
одоогийн attendance status-ыг ESIS-ийн reason code-той тулгах хүснэгт catalog-д
байхгүй тул C5 хийхээс өмнө token-той lookup/test шаардлагатай.

`/attendance/daily` дээр бүрэн бүртгэгдсэн бүлэг-өдрийг сонгоход
`POST /kindergartens/:id/attendance/daily/esis-preview` нь API-000269-ийн
илгээх body-г хүүхэд бүрийн мөрөөр бэлтгэж дэлгэцэд харуулна. Portal-ийн
гаралтын тайлбарт байгаа кодоор demo mapping нь `PRESENT`/`HALF_DAY → PRESENT`,
`EXCUSED → EXCUSED`, `SICK → SICK`, `ABSENT → UNEXCUSED`. Тодорхой ESIS
шалтгаангүй `OTHER`-ийг таамаглахгүй, илгээхийн өмнө засах алдаа болгоно.
Token байхгүй үед preview тодорхой `demo: true` payload үзүүлнэ. Token байгаа
үед API `groups` болон `groupStudents`-ийг бодитоор дуудаж, бүлгийг нэрээр,
хүүхдийг овог нэр + төрсөн огноогоор цорын ганц тохирсон үед ESIS-ийн
`studentGroupId`, `personId`-г payload-д тавина. Олдоогүй эсвэл давхардсан
тохиолдолд буруу ID таахгүй, илгээлтийг зогсооно. `Илгээх` нь API-000269 POST
амжилттай болсны дараа л local `AttendanceSubmission` хадгална.

### Хоолны нэгдсэн лавлах

| API                | Method ба зам                                     | NomadKids-д ашиглах газар            | Одоо  |
| ------------------ | ------------------------------------------------- | ------------------------------------ | ----- |
| 111 / `API-000210` | `GET /svc/api/hub/v2/cook/product/type`           | Хоолны төрөл                         | C1+C2 |
| 112 / `API-000211` | `GET /svc/api/hub/v2/cook/materialGroup`          | Хүнсний бүлэг                        | C1+C2 |
| 123 / `API-000222` | `GET /svc/api/hub/v2/cook/material`               | `Ingredient` master data, шимт бодис | C1+C2 |
| 124 / `API-000223` | `GET /svc/api/hub/v2/cook/product`                | Хоол/бэлэн бүтээгдэхүүний лавлах     | C1+C2 |
| 125 / `API-000224` | `GET /svc/api/hub/v2/cook/productMaterials`       | `RecipeIngredient`, технологийн карт | C1+C2 |
| 126 / `API-000225` | `GET /svc/api/hub/v2/cook/kit/:productId`         | Иж бүрдлийн шимт бодис               | C1+C2 |
| 127 / `API-000226` | `GET /svc/api/hub/v2/cook/kit/product/:productId` | Иж бүрдлийн бүтээгдэхүүн             | C1+C2 |

Энэ бүлэг А/261 Хавсралт 2, СӨБ #37-ийн “хоолны нэгдсэн лавлахыг БСМС-ээс
татах” зайлшгүй шаардлагыг хэрэгжүүлэхэд зориулсан. Local `Ingredient` болон
`Recipe`-г шууд overwrite хийхгүй; external ID mapping, preview, operator
approval бүхий import C5 дээр нэмэгдэнэ.

## 2.1 Гаралтын талбарын каталог (2026-09-08 бүрэн тулгасан)

Сервис бүрийн **бүх гаралтын талбар** `esis.fields.ts`-д нэрээрээ бүртгэлтэй.
Талбар бүр `ingested: true|false` төлөвтэй; авахгүй талбар бүр `omitReason`-той
бөгөөд ямар баримтаар татгалзсаныг нэрлэнэ.

| Эх сурвалж | Сервис             | Утга                                                              |
| ---------- | ------------------ | ----------------------------------------------------------------- |
| `PORTAL`   | Сонгосон 17 сервис | 2026-09-08-нд `/api/structure`-оос нэр, төрөл, `io`-гоор тулгасан |

Нийт **256 гаралтын талбар**, attendance v3 бичих сервисийн **8 оролтын
талбар** байна. UI нь оролт, гаралтыг тусдаа badge-аар ялгана. Demo утга нь
үзүүлэнгийн мэдээлэл бөгөөд бодит ESIS хариу биш гэдгийг бүх дэлгэц дээр
тэмдэглэнэ. Token авсны дараа C4 test орчинд бодит утга, nullable байдал,
өгөгдлийн төрлийг дахин тулгана.

**Зориуд авахгүй талбарууд** (`ESIS_REQUEST.md` §1.1 (b), §1.2):
`civilId`, `personRegNumber`, `microsoftPassword`, `googlePassword`,
`microsoftEmailPass`, `googleEmailPass`, `username`. Эдгээр нь схемд огт
байхгүй — zod parse дээр хасагдана — гэхдээ
каталогид **үлдээсэн**: БМТТ-ийн шалгагч portal-той тулгахдаа "уншаад
татгалзсан" гэдгийг харах ёстой, богино жагсаалт бол алдаа мэт харагдана.

Схем ба каталогийн нийцлийг `esis.fields.test.ts` барина: `ingested` талбарын
нэрсийн олонлог зохих zod схемийн түлхүүрүүдтэй яг тэнцүү байх ёстой.

★ Суралцагчийн **нэмэлт мэдээлэл** (өрхийн байдал, эрүүл мэндийн лавлагаа, РД)
нь `ESIS_REQUEST.md` §1.1 (b) ба §1.3-аар зориуд хүсээгүй хэвээр. Дэлгэц дээр
энэ шийдвэрийг тайлбартай нь харуулна.

## 3. Кодын бэлэн хэсэг

| Файл                                                           | Үүрэг                                                                  |
| -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `esis.endpoints.ts`                                            | 17 service-ийн API ID, slug, method, path                              |
| `esis.fields.ts`                                               | Сервис бүрийн бүх гаралтын талбар, авах/авахгүй шийдэл ба шалтгаан     |
| `esis.schemas.ts`                                              | ESIS envelope validation, field minimization, attendance payload       |
| `esis.service.ts`                                              | `ESIS_READERS` хүснэгт, domain method, түлхүүрээр унших `read()`       |
| `esis.client.ts`                                               | Bearer auth, timeout, safe GET retry, алдааны ангилал, token redaction |
| `esis.service.test.ts`                                         | Endpoint path, envelope, sensitive-field stripping, v3 payload test    |
| `esis.fields.test.ts`                                          | Каталог ба схемийн тэнцэл, татгалзсан талбарын шалтгаан                |
| `GET /v1/kindergartens/:id/esis/resource`                      | Нэг сервисийг read-only татаж, талбар бүрийн утгыг буцаана             |
| `GET /v1/kindergartens/:id/esis/student-registration-template` | Staff хүүхэд бүртгэлд minimized `students` contract өгнө               |
| `GET /v1/groups/:id/attendance/esis-preview`                   | Нэг бүлэг-өдрийн API-000269 payload-ийг үүсгэнэ                        |
| `POST /v1/groups/:id/attendance/submit`                        | Багшийн бүрэн өдрийг API-000269-д илгээж, амжилтыг local хадгална      |
| `GET /v1/kindergartens/:id/esis/my-profile`                    | Нэвтэрсэн багш/ажилтны бүх зөвшөөрөгдсөн live гаралтыг харуулна        |
| `GET /v1/health/readiness`                                     | Token-ийг гаргалгүй integration config-ийн төлөв харуулна              |

`…/esis/resource?resource=<key>&studentGroupId=…&dayDate=…` нь ADMIN эрхтэй,
tenant mapping шалгасны дараа ажиллана. Дотоод бүртгэлд юу ч бичихгүй; ганц
бичих мөр нь `AuditLog`-ийн `VIEW`. Дээд тал нь 25 мөр буцаана. Upstream
алдааг HTTP алдаа болгож биш, `status: "FAILED"` + `errorCode` болгож буцаана —
товчлуурын үүрэг нь "холболт ажиллаж байна уу?"-г хариулах явдал.

2026-09-07-нд catalog-ийн тухайн үеийн sample body-гаар 16 `GET` schema-г
автоматаар parse хийхэд бүгд амжилттай. Attendance `POST` sample нь `0` ID,
`"s"` огноотой placeholder байсан тул түүнийг бодит payload гэж зөвшөөрөөгүй;
positive ID, ISO date бүхий contract unit test-т орсон.

Тохиргоо:

```dotenv
ESIS_DEMO_MODE=true
ESIS_TOKEN=
# optional override; default нь https://hubv2.esis.edu.mn
ESIS_BASE_URL=https://hubv2.esis.edu.mn
ESIS_TIMEOUT_MS=15000
```

`ESIS_DEMO_MODE=true` үед client ямар ч ESIS host руу request илгээхгүй.
Deterministic fixture нь live response-тэй ижил `SUCCESS_CODE`,
`RESPONSE_MESSAGE`, `RESULT` envelope-оор орж, live-тэй ижил schema/parser,
mapping-аар шалгагдана. UI болон sync log үүнийг `MOCK`, `DEMO_SUCCESS` гэж
ил тод тэмдэглэнэ. Live token баталгаажсаны дараа `ESIS_TOKEN`-ийг тохируулж,
`ESIS_DEMO_MODE=false` болгоно.

Core fixture-үүд `apps/api/src/integrations/esis/fixtures/` дотор
`institution`, `group`, `teacher`, `student`, `enrollment`, `attendance`,
`progression` гэж тусдаа хадгалагдана. Бүгд тогтмол зохиомол ID, `.invalid`
и-мэйл ашигладаг; регистрийн дугаар болон бодит хүүхдийн хувийн мэдээлэлгүй.

Admin evidence API нь endpoint бүрт `direction`, `targetModel`, бүх field-ийн
`mappings`, `responseMode`, `httpStatus`, `syncStatus`, `lastSyncAt` буцаана.
Resource read response нь parser-аар цэвэрлэсэн safe мөрүүдийг ESIS-ийн
`SUCCESS_CODE`, `RESPONSE_MESSAGE`, `RESULT` envelope-оор давхар буцаадаг.
Bearer token, provider password, регистр болон raw sensitive payload энэ
дэлгэцийн contract-д орохгүй.

`developerv2.esis.edu.mn` бол developer portal; API base URL биш. Token-ийг
browser руу өгөхгүй, frontend ESIS Hub-ийг шууд дуудахгүй.

Portal-ийн нүүрний cURL жишээ `hub.esis.edu.mn`, харин service catalog-ийн
endpoint бүр `hubv2.esis.edu.mn` хосттой. Хоёр хост token-гүй хүсэлтэд 401
буцааж reachable байсан ч issued token аль production host-д үйлчлэхийг C4
test-ээр баталгаажуулна. Код catalog-ийн URL болох `hubv2`-г баримталсан.

## 4. Одоогоор зориуд холбоогүй сервисүүд

- Эрүүл мэнд, вакцин, харшил, хөгжлийн бэрхшээл: эмчийн тусгай эрх, зорилгын
  зөвшөөрөл, retention шийдэгдсэний дараа л scope хүснэ.
- Дүн, шалгалт, сурах бичиг, дүрэмт хувцас, дотуур байр: СӨБ-ын NomadKids-ийн
  зорилгод хамаарахгүй.
- Төгсөлт, дэвшилт, бүлэг үүсгэх/устгах POST: СӨБ-д ямар service ашиглахыг
  БМТТ баталгаажуулаагүй; буруу өгөгдөл үүсгэх эрсдэлтэй.
- Хоолны санхүүгийн маягт 1/2: бүтээгдэхүүний scope ба батлагдсан маягтын
  mapping хийгдээгүй.

## 5. C3-C5 руу шилжих checklist

1. `ESIS_REQUEST.md`-ийн API ID жагсаалтаар авах/өгөх scope батлуулах.
2. Гэрээ байгуулж `ACCESS_TOKEN`, `ENTRY_SOURCE_ID` авах.
3. Portal-ийн хэрэглэгчийн хуудсаас 17 API-ийн access status-ыг export/screenshot
   хийж change record-д хавсаргах.
4. ESIS test орчинд нэг цэцэрлэгээр GET contract test ажиллуулах.
5. Ирцийн code mapping, POST idempotency/error contract-ыг test response-оор
   батлах.
6. Урт хугацааны import-д external ID + field conflict хадгалалт, BullMQ
   dead-letter, operator approve UI нэмэх. Attendance нь одоогоор live roster-оос
   deterministic тулгалт хийдэг тул token ирмэгц ажиллана.
7. Production-д эхлээд read-only sync, дараа нь нэг цэцэрлэгийн attendance POST,
   эцэст нь шаталсан rollout хийх.

2026-09-08-ны хэрэгжилтээр `sync run/result`, tenant-safe mapping, operator
read-only preview, safe GET retry, live profile/student output, attendance live
resolve + POST хийгдсэн. Bulk import-ийн persisted external ID, field-level
conflict, approve/import, dead-letter queue нь дараагийн operational шатанд үлдсэн.

## 6. Журмын холбоос

- А/465 §3.4.3: хүсэлтэд авах/өгөх service-ийн нэрийг тусгана. API ID-тай матриц
  үүнийг нэг утгатай болгов.
- А/465 §3.7: шаардлага, service батлагдсаны дараа нэг token олгоно. C3 gate.
- А/465 §3.17: анхан шатны бүртгэлийг бодит цагийн горимоор хүргүүлнэ.
  Attendance v3 + queue нь хэрэгжүүлэх зам.
- А/465 §3.18: ашиглалтаас 3 сарын өмнө төлөвлөлт, 1 сарын өмнө test хувилбар.
- А/465 §4: эрхийг service тус бүрээр хамгийн бага хүрээнд авах ёстой.
- А/465 §5: залруулгын түүх, нотлох баримтыг хадгална. Sync audit C5-д заавал.
- А/465 §7.3: өдөр тутмын ирц, шилжилт хөдөлгөөнийг өдөр тутам бүртгэнэ.
- А/261 ерөнхий #29-31: хоёр талын солилцоо, API баримт, интеграцийн чадвар.
- А/261 СӨБ #3, #37, #51: байгууллага/ажилтан өгөгдөл өгөх-авах, хоолны
  нэгдсэн лавлах татах.

Энэ матриц нь техникийн readiness-ийг нотолно. Харин А/261-ийн бүх 94 шалгуур
хангагдсан гэсэн баталгаа биш; бүрэн өөрийн үнэлгээ `ESIS_COMPLIANCE.md`-д бий.
