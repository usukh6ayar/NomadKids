# ESIS v2 API бэлэн байдлын матриц

**Шалгасан огноо:** 2026-09-07

**Албан ёсны эх:** <https://developerv2.esis.edu.mn/api/structure>

**Hub:** `https://hubv2.esis.edu.mn`

Developer portal-ийн public catalog-д нийт **198 сервис** байна: 119 `GET`,
79 `POST`. NomadKids бүх сервисийг хүсэхгүй. А/261-ийн мэдээлэл солилцоо болон
СӨБ-ын шаардлагыг хангахад шууд хэрэгтэй **17 сервисийг** хамгийн бага эрхийн
зарчмаар сонгож backend adapter-т оруулсан.

Portal-ийн 2026-03-31-ний мэдэгдэл v1 сервисүүдийг 2026-04-01-нээс хааж эхлэхийг
зарласан. Иймээс энэ матриц зөвхөн `/hub/v2/` зам ашиглана.

## 1. “Бэлэн” гэдэг үгийн утга

| Түвшин         | Утга                                                                     |
| -------------- | ------------------------------------------------------------------------ |
| **C1 Catalog** | ESIS v2 catalog-д API ID, method, URL, талбар, sample байна              |
| **C2 Code**    | Endpoint registry, Zod validation, domain method, unit test бэлэн        |
| **C3 Access**  | Манай `ACCESS_TOKEN`-д тухайн API ID зөвшөөрөгдсөн                       |
| **C4 Test**    | ESIS test орчинд бодит байгууллагын өгөгдлөөр амжилттай шалгасан         |
| **C5 Live**    | Баталгаатай import, external ID, BullMQ retry/idempotency, attendance reconcile ажиллана |

Одоогийн төлөв: сонгосон 17 сервис **C1 + C2**. Tenant mapping, operator UI,
read-only dry-run, `EsisSyncRun` audit history нэмэгдсэн боловч эдгээр нь C4
test-ийг орлохгүй. **C3-C5 хүлээгдэж байна**.
Иймээс adapter код ашиглахад бэлэн боловч ESIS рүү production дуудлага хийхэд
бэлэн гэж ойлгож болохгүй. Гэрээ, token scope, test баталгаажуулалтгүйгээр
production өгөгдөл илгээхгүй.

## 2. Сонгосон endpoint ба ашиглах газар

Бүх замын өмнө `https://hubv2.esis.edu.mn` орно. `institutionId`-г backend
өөрийн `ESIS_INSTITUTION_ID` тохиргооноос нэмнэ.

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

## 3. Кодын бэлэн хэсэг

| Файл                       | Үүрэг                                                               |
| -------------------------- | ------------------------------------------------------------------- |
| `esis.endpoints.ts`        | 17 service-ийн API ID, slug, method, path                           |
| `esis.schemas.ts`          | ESIS envelope validation, field minimization, attendance payload    |
| `esis.service.ts`          | Байгууллага, roster, хүний нөөц, ирц, хоолны domain method          |
| `esis.client.ts`           | Bearer auth, timeout, алдааны ангилал, token redaction              |
| `esis.service.test.ts`     | Endpoint path, envelope, sensitive-field stripping, v3 payload test |
| `GET /v1/health/readiness` | Token-ийг гаргалгүй integration config-ийн төлөв харуулна           |

2026-09-07-нд catalog-ийн тухайн үеийн sample body-гаар 16 `GET` schema-г
автоматаар parse хийхэд бүгд амжилттай. Attendance `POST` sample нь `0` ID,
`"s"` огноотой placeholder байсан тул түүнийг бодит payload гэж зөвшөөрөөгүй;
positive ID, ISO date бүхий contract unit test-т орсон.

Тохиргоо:

```dotenv
ESIS_BASE_URL=https://hubv2.esis.edu.mn
ESIS_TOKEN=<ACCESS_TOKEN>
ESIS_INSTITUTION_ID=<ENTRY_SOURCE_ID>
ESIS_TIMEOUT_MS=15000
```

`developerv2.esis.edu.mn` бол developer portal; API base URL биш. Token-ийг
browser руу өгөхгүй, frontend ESIS Hub-ийг шууд дуудахгүй.

Portal-ийн нүүрний cURL жишээ `hub.esis.edu.mn`, харин service catalog-ийн
endpoint бүр `hubv2.esis.edu.mn` хосттой. Хоёр хост token-гүй хүсэлтэд 401
буцааж reachable байсан ч issued token аль production host-д үйлчлэхийг C4
test-ээр баталгаажуулна. Код catalog-ийн URL болох `hubv2`-г баримталсан.

## 4. Одоогоор зориуд холбоогүй сервисүүд

- Эрүүл мэнд, вакцин, харшил, хөгжлийн бэрхшээл: эмчийн тусгай эрх, зорилгын
  зөвшөөрөл, retention шийдэгдсэний дараа л scope хүснэ.
- РД-аар хүүхэд хайх: catalog-д `API-000144` байгаа ч одоогийн хүсэлт
  `personId`-аар тулгах, РД-г ESIS-ээс автоматаар татахгүй гэсэн хувилбартай.
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
6. External ID + sync run/result хадгалалт, BullMQ retry/dead-letter, operator
   preview/approve UI нэмэх.
7. Production-д эхлээд read-only sync, дараа нь нэг цэцэрлэгийн attendance POST,
   эцэст нь шаталсан rollout хийх.

2026-09-07-ны хэрэгжилтээр 6-р алхмын `sync run/result`, tenant-safe mapping,
operator read-only preview хэсэг хийгдсэн. External ID, field-level conflict,
approve/import, BullMQ retry/dead-letter нь үлдсэн.

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
