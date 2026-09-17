/**
 * The deployment's ESIS request register — what the ministry has granted.
 *
 * Source: the ESIS developer portal's own "Хүсэлт" list for this deployment's
 * account, read 2026-09-14. One row per request the operator filed, carrying
 * the portal's id, its own name for the service, the subsystem that issues it
 * and where the request stands.
 *
 * ★ **Why a file and not a table.** CLAUDE.md §2.3 puts anything an
 * administrator can edit in a table. Nobody edits this: it is a snapshot of a
 * register kept *in the portal*, and the portal stays the authority. What the
 * product needs it for is the two questions an operator asks before wiring
 * anything — "is this service granted?" and "how many of the grants are we
 * actually using?" — and both are answered by joining `apiId` against
 * `ESIS_ENDPOINTS`. A table would add an editing surface for a fact our side
 * cannot change, and the first edit would make it disagree with the portal.
 *
 * ★★ **This register is the id authority, and it corrected one.** Before
 * 2026-09-14 `studentInfo` carried `apiId: 147`, derived from its slug
 * `API-000147`. In this register 147 is "Сүү хөтөлбөрийн гүйцэтгэл хадгалах"
 * and is *pending*; "Сурагчийн ерөнхий мэдээлэл" — `studentInfo`'s own catalog
 * name, verbatim — is **48**, approved. The slug and the id are separate
 * numbers and the other entries prove it (45/API-000144, 59/API-000158), so
 * deriving one from the other was the mistake. Every other carried id appears
 * here as Зөвшөөрөгдсөн, which is what makes the join trustworthy.
 *
 * ★★★ **Checked against the ministry's own export, 2026-09-14** —
 * `apis-granted.xlsx`, one row per approved service with its `API_ID`, HTTP
 * method and full URL. The register below survived it exactly: all **84**
 * approved ids are present and approved here, and the 13 extra rows are the
 * PENDING and CANCELLED ones the export does not list (Мэргэшлийн зэрэг ×9,
 * Сүү хөтөлбөр ×4). Nothing had to change.
 *
 * ★★★★ The export carries something this file does not — the **path** — and it
 * confirmed all 40 wired endpoints, method and path, with no mismatches. The
 * paths are deliberately **not** copied in here: they already live in
 * `esis.endpoints.ts`, and a second copy of a fact is the copy that goes stale.
 * This file answers "is it granted?"; that one answers "where is it?".
 *
 * ★★★★★ What the export could not confirm is what a service *returns*. Nine
 * wired services were checked against live responses the same day and every one
 * of them had an invented field list — see `esis.fields.ts`. A grant, a path
 * and an output contract are three separate facts, and this register is only
 * ever evidence of the first.
 */

/** Where a service stands in the portal, `NOT_REQUESTED` when it is absent. */
export type EsisGrantStatus = "APPROVED" | "PENDING" | "CANCELLED" | "NOT_REQUESTED";

/** The portal's "Бүлэг" column — the subsystem that serves the request. */
export type EsisRequestGroup = "EBS" | "OPEN" | "ZEREG" | "OTHER";

export interface EsisPortalRequest {
  apiId: number;
  /** The portal's own name for the service. Matched against catalog names. */
  name: string;
  group: EsisRequestGroup;
  status: Exclude<EsisGrantStatus, "NOT_REQUESTED">;
  /** The date the portal shows against the request, as it shows it. */
  requestedAt: string;
}

/** The day the register below was read off the portal. */
export const ESIS_REQUESTS_REVIEWED_AT = "2026-09-14";

const FIRST = "2026-09-11";
const SECOND = "2026-09-12";

/**
 * Every request on the portal, in the order the portal lists them.
 *
 * The five dated 2026-09-12 were approved by name (Ж.Дашням, Б.Мягмарсүрэн,
 * Г.Чойжилжав); the rest came back from `esisnoreply` the day before. Who
 * approved it is not carried — it is not a fact any screen here needs, and a
 * reviewer's name is personal data this product has no reason to keep.
 */
export const ESIS_PORTAL_REQUESTS: readonly EsisPortalRequest[] = [
  {
    apiId: 162,
    name: "Анги бүлгийн багш тохируулах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: SECOND,
  },
  {
    apiId: 100004874669812,
    name: "Багшийн жагсаалт",
    group: "EBS",
    status: "APPROVED",
    requestedAt: SECOND,
  },
  {
    apiId: 100004874669800,
    name: "Багшийн ерөнхий мэдээлэл",
    group: "EBS",
    status: "APPROVED",
    requestedAt: SECOND,
  },
  {
    apiId: 150,
    name: "Анги бүлгийн мэдээлэл нэмэх",
    group: "EBS",
    status: "APPROVED",
    requestedAt: SECOND,
  },
  {
    apiId: 152,
    name: "Анги бүлгийн мэдээлэл засах, устгах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: SECOND,
  },
  {
    apiId: 49,
    name: "Ажилтны ерөнхий мэдээлэл",
    group: "OTHER",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  { apiId: 92, name: "Амьдрах орчин", group: "EBS", status: "APPROVED", requestedAt: FIRST },
  {
    apiId: 71,
    name: "Амьдрах орчин хадгалах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 100004874669804,
    name: "Багшийн заах аргын нэгдэл",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 55,
    name: "Байгууллагын ажилчдын жагсаалт",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 100004874669781,
    name: "Байгууллагын багш эсэх шалгах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 100004874669782,
    name: "Байгууллагын багшийн шилжилт хөдөлгөөн",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 186,
    name: "Байгууллагын барилга байгууламж",
    group: "OPEN",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 100004874669798,
    name: "Байгууллагын барилга байгууламжын жагсаалт",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 100004874669799,
    name: "Байгууллагын барилга байгууламжын өрөөний жагсаалт",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 14,
    name: "Байгууллагын бүлгийн жагсаалт лавлах /Шинэ хичээлийн жилээр/",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 100004874669811,
    name: "Байгууллагын бүлгийн мэдээлэл",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 59,
    name: "Байгууллагын ерөнхий мэдээлэл",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 100004874669796,
    name: "Байгууллагын заах аргын нэгдэл",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 124,
    name: "Бэлэн бүтээгдэхүүн харах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 100004874669783,
    name: "Бүлгийн суралцагчийн жагсаалт",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  { apiId: 62, name: "Вакциний мэдээлэл", group: "EBS", status: "APPROVED", requestedAt: FIRST },
  {
    apiId: 102,
    name: "Гэр бүлийн мэдээлэл лавлах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 101,
    name: "Гэр бүлийн мэдээлэл хадгалах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 127,
    name: "Иж бүрдлийн бүрэлдэхүүн харах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  { apiId: 126, name: "Иж бүрдэл харах", group: "EBS", status: "APPROVED", requestedAt: FIRST },
  {
    apiId: 169,
    name: "Мэргэшлийн зэргийн системийн файл хадгалах",
    group: "EBS",
    status: "CANCELLED",
    requestedAt: FIRST,
  },
  {
    apiId: 119,
    name: "Мэргэшлийн зэргийн хүсэлтийн дугаар авах",
    group: "ZEREG",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 170,
    name: "Мэргэшлийн зэргийн хүсэлтийн түүх харуулах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 167,
    name: "Мэргэшлийн зэргийн хүсэлтийн шийдвэрлэлт харуулах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 165,
    name: "Мэргэшлийн зэргийн хүсэлтийн үндсэн мэдээлэл хадгалах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 168,
    name: "Мэргэшлийн зэрэг файлын жагсаалт харуулах",
    group: "EBS",
    status: "PENDING",
    requestedAt: FIRST,
  },
  {
    apiId: 115,
    name: "Мэргэшлийн хүсэлтийн ерөнхий мэдээлэл харах",
    group: "ZEREG",
    status: "PENDING",
    requestedAt: FIRST,
  },
  {
    apiId: 120,
    name: "Мэргэшлийн хүсэлтийн түүх харах",
    group: "ZEREG",
    status: "PENDING",
    requestedAt: FIRST,
  },
  {
    apiId: 117,
    name: "Мэргэшлийн хүсэлтийн файлын ерөнхий мэдээлэл",
    group: "ZEREG",
    status: "PENDING",
    requestedAt: FIRST,
  },
  {
    apiId: 122,
    name: "Мэргэшлийн хүсэлтийн файлын төрөл харах",
    group: "ZEREG",
    status: "PENDING",
    requestedAt: FIRST,
  },
  {
    apiId: 121,
    name: "Мэргэшлийн хүсэлтийн шийдвэрлэлтийн явц харах",
    group: "ZEREG",
    status: "PENDING",
    requestedAt: FIRST,
  },
  {
    apiId: 118,
    name: "Мэргэшүүлэх хүсэлтийн ерөнхий мэдээлэл хадгалах",
    group: "ZEREG",
    status: "PENDING",
    requestedAt: FIRST,
  },
  {
    apiId: 116,
    name: "Мэргэшүүлэх хүсэлтийн файлийн мэдээлэл хадгалах",
    group: "ZEREG",
    status: "PENDING",
    requestedAt: FIRST,
  },
  {
    apiId: 100004874669797,
    name: "Судлагдахууны жагсаалт",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 48,
    name: "Сурагчийн ерөнхий мэдээлэл",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 77,
    name: "Сурагчийн харшлын мэдээлэл хадгалах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 97,
    name: "Сурагчийн харшлын мэдээлэл харах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 100004874669785,
    name: "Суралцагчийн бүртгэлтэй эсэх шалгах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 100004874669777,
    name: "Суралцагчийн жагсаалт",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 45,
    name: "Суралцагчийн мэдээллийг РД-аар хайх",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 100004874669784,
    name: "Суралцагчийн мэдээлэл хайх /УБЕГ -аас татаж шинэчлэх/",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 73,
    name: "Суралцагчийн нэмэлт үндсэн мэдээлэл хадгалах сервис",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 109,
    name: "Суралцагчийн хэмжилтийн мэдээлэл лавлах сервис /Бүлгээр/",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 108,
    name: "Суралцагчийн хэмжилтийн мэдээлэл хадгалах сервис /Бүлгээр/",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 100004874669778,
    name: "Суралцагчийн шилжилт хөдөлгөөний жагсаалт /Шинэчилсэн/",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 100004874669776,
    name: "Суралцагчийн шилжилт хөдөлгөөний мэдээлэл",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 195,
    name: "Суралцагчийн эрт илрүүлгийн асуулгын жагсаалт лавлах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 194,
    name: "Суралцагчийн эрт илрүүлгийн мэдээлэл /цэцэрлэг дунд бүлэг, 1-р анги, 6-р анги, 10-р анги/",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 100004874669814,
    name: "Сургалтын хөтөлбөр түвшингийн жагсаалт",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 100004874669813,
    name: "Сургалтын хөтөлбөрийн жагсаалт",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 100004874669773,
    name: "Сургалтын хөтөлбөрийн төлөвлөгөөний жагсаалт",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 100004874669815,
    name: "Сургалтын хөтөлбөрийн хичээлийн жагсаалт",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 144,
    name: "Сүү нийлүүлэгчийн мэдээлэл бүлгээр лавлах",
    group: "EBS",
    status: "PENDING",
    requestedAt: FIRST,
  },
  {
    apiId: 145,
    name: "Сүү нийлүүлэгчийн мэдээлэл бүлгээр хадгалах",
    group: "EBS",
    status: "PENDING",
    requestedAt: FIRST,
  },
  {
    apiId: 147,
    name: "Сүү хөтөлбөрийн гүйцэтгэл хадгалах",
    group: "EBS",
    status: "PENDING",
    requestedAt: FIRST,
  },
  {
    apiId: 143,
    name: "Сүүний асуумж хадгалах",
    group: "EBS",
    status: "PENDING",
    requestedAt: FIRST,
  },
  {
    apiId: 125,
    name: "Технологийн карт харах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 64,
    name: "Товлолт вакциний мэдээлэл",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  { apiId: 123, name: "Түүхий эд харах", group: "EBS", status: "APPROVED", requestedAt: FIRST },
  {
    apiId: 63,
    name: "Хийлгэсэн вакциний мэдээлэл",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 61,
    name: "Хичээлийн жилийн хаалт нээлт лавлах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 111,
    name: "Хоолны ангилал харах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 128,
    name: "Хоолны хөнгөлөлтөд хамрагдах хүүхдийн мэдээлэл харах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  { apiId: 112, name: "Хүнсний бүлэг харах", group: "EBS", status: "APPROVED", requestedAt: FIRST },
  {
    apiId: 11,
    name: "Хүүхдийн ирц бүртгэлийн мэдээлэл харах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 129,
    name: "Хүүхдийн хоолны төвлөрүүлэх орлого - Маягт 1 хадгалах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 130,
    name: "Хүүхдийн хоолны төвлөрүүлэх орлого - Маягт 1 харах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 131,
    name: "Хүүхдийн хоолны төвлөрүүлэх орлого - Маягт 2 хадгалах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 132,
    name: "Хүүхдийн хоолны төвлөрүүлэх орлого - Маягт 2 харах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 100004874669793,
    name: "Хүүхэд өдрийн ирц хадгалах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  /*
   * ★ Added 2026-09-14, from the portal's "Ашиглах боломжтой сервисүүд" list.
   *
   * It was the one grant this register was missing — 83 of the portal's 84
   * approvals were here and this was not. Nothing reads it: `saveAttendanceV3`
   * is the version the adapter calls, deliberately (`esis.endpoints.ts` — v3
   * is the one that carries an attendance reason). It is recorded because the
   * register's job is to mirror the portal, and a register that quietly omits
   * a row is one nobody can check the portal against.
   */
  {
    apiId: 105,
    name: "Хүүхэд өдрийн ирц хадгалах /Хувилбар 2.0/",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 171,
    name: "Хүүхэд өдрийн ирц хадгалах /Хувилбар 3.0/ - Ирцийн нэмэлт шалтгаантай",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 100004874669792,
    name: "Хүүхэд өдрийн ирц харах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 85,
    name: "Цол, шагнал, зэргийн мэдээлэл лавлах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 72,
    name: "Цол, шагнал, зэргийн мэдээлэл хадгалах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 190,
    name: "Эрт илрүүлэг(Цэцэрлэг дунд бүлэг)",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 76,
    name: "Эрүүл мэндийн мэдээлэл хориотой хүнс хадгалах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 98,
    name: "Эрүүл мэндийн мэдээлэл хориотой хүнсний мэдээлэл харах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 78,
    name: "Эрүүл мэндийн мэдээлэл хөгжлийн бэрхшээл хадгалах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 96,
    name: "Эрүүл мэндийн мэдээлэл хөгжлийн бэрхшээлтэй сурагчийн мэдээлэл харах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 79,
    name: "Эрүүл мэндийн мэдээлэл үзлэг шинжилгээ хадгалах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 95,
    name: "Эрүүл мэндийн мэдээлэл үзлэг шинжилгээний мэдээлэл харах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 75,
    name: "Эрүүл мэндийн мэдээлэл өсөлт, хөгжлийн мэдээлэл хадгалах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 99,
    name: "Эрүүл мэндийн мэдээлэл өсөлт, хөгжлийн мэдээлэл харах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 81,
    name: "Эрүүл мэндийн мэс заслын мэдээлэл хадгалах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 94,
    name: "Эрүүл мэндийн мэс заслын мэдээлэл харах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 82,
    name: "Эрүүл мэндийн осол гэмтэл хадгалах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 93,
    name: "Эрүүл мэндийн осол гэмтэл харах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 84,
    name: "Эрүүл мэндийн үзлэг, шинжилгээ хавсралт файл",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 87,
    name: "Өрхийн мэдээлэл лавлах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
  {
    apiId: 86,
    name: "Өрхийн мэдээлэл хадгалах",
    group: "EBS",
    status: "APPROVED",
    requestedAt: FIRST,
  },
];

/**
 * Granted services this product deliberately does not call, and why.
 *
 * ★ Added 2026-09-17, plan `2026-09-16-esis-sync-tiers.md` Task 9. An
 * approved-but-unwired row in `ESIS_REQUEST_REGISTER` says only that nothing
 * calls it — which reads the same whether the grant was declined on purpose
 * or simply not reached yet. Spec №4's 84/84 matrix needs to tell those apart,
 * or an unwired-but-defensible row becomes indistinguishable from a silent
 * gap. This is what a matrix generator joins by `apiId`, the same way
 * `WIRED_API_IDS` is — a reason, not a second copy of the grant itself.
 *
 * 167 and 170 are the degree-request decisions and history reads: this
 * product has no teacher-qualification module, so there is no screen either
 * would feed. 119 is the one live-probed and still refused — see
 * `buildingByRegisterNumber`'s sibling note in `esis.endpoints.ts` for what
 * 186 needed instead, and the reasoning below for why 119 came out differently.
 */
export const ESIS_DISPOSITIONS: Readonly<Record<number, string>> = {
  167:
    "Багшийн мэргэшлийн зэргийн модуль энэ бүтээгдэхүүнд байхгүй — хүсэлтийн " +
    "шийдвэрлэлтийг харуулах дэлгэц алга.",
  170:
    "Багшийн мэргэшлийн зэргийн модуль энэ бүтээгдэхүүнд байхгүй — хүсэлтийн " +
    "түүхийг харуулах дэлгэц алга.",
  /*
   * ★ Live-probed 2026-09-17, plan Task 9 Step 2. The export's own stated root
   * (`/svc/api/zereg/get/request/:registerNum`) answers `404 Зам олдсонгүй` —
   * the same shape a nonsense path returns, so that root does not exist on
   * this host. The standard `/svc/api/hub/v2/` root, with the same final
   * path segment, answers `403 Энэ API-д хандах эрх байхгүй` — the shape a
   * *real, recognised* route gives an unauthorised token (proven by
   * disambiguation: every neighbouring path under that segment, and the same
   * path over POST, all answer the 404 instead). So a route is registered at
   * `/svc/api/hub/v2/zereg/get/request/:registerNum` and this token is
   * refused it, despite the portal listing 119 as APPROVED — a discrepancy
   * between the grant register and the live gateway, not a grammar this
   * client cannot express. Nothing was guessed into `esisPath` to work around
   * a 403; the standard grammar already reaches a real route and still fails
   * on access.
   */
  119:
    "Стандарт /svc/api/hub/v2/zereg/get/request/:registerNum замаар " +
    "амьд шалгахад тухайн зам БОДИТ хэмээн танигдсан ч токен 403 « Энэ API-д " +
    "хандах эрх байхгүй» гэж буцаав — экспортод бичсэн /svc/api/zereg/ язгуур " +
    "нь 404 (Зам олдсонгүй) буцаадаг тул зам биш. Портал дээр 119 " +
    "APPROVED ч, live gateway дээрх эрх нээгдээгүй тул холбосонгүй.",
};

const BY_API_ID = new Map(ESIS_PORTAL_REQUESTS.map((request) => [request.apiId, request]));

/** The portal's row for a service id, or `null` when it was never requested. */
export function esisPortalRequest(apiId: number | null): EsisPortalRequest | null {
  if (apiId === null) return null;
  return BY_API_ID.get(apiId) ?? null;
}

/** Where a carried service stands in the portal. */
export function esisGrant(apiId: number | null): EsisGrantStatus {
  return esisPortalRequest(apiId)?.status ?? "NOT_REQUESTED";
}

export interface EsisRequestRegister {
  reviewedAt: string;
  counts: {
    total: number;
    approved: number;
    pending: number;
    cancelled: number;
    /** Approved services a screen in this product actually calls. */
    wired: number;
    /** Approved and unused — granted scope the product does not draw on. */
    approvedUnwired: number;
  };
  items: (EsisPortalRequest & {
    /** The catalog key that calls this service, or `null` when none does. */
    serviceKey: string | null;
    /**
     * Why an approved-and-unwired grant is deliberately uncalled, or `null`
     * for a grant nobody has decided against yet. See `ESIS_DISPOSITIONS`.
     */
    dispositionReason: string | null;
  })[];
}

/**
 * The register, joined against the services this product carries.
 *
 * ★ `wiredApiIds` is a map from the caller rather than an import, so this file
 * depends on nothing and `esis.catalog.ts` stays the one place that knows which
 * key owns which id.
 */
export function esisRequestRegister(wiredApiIds: ReadonlyMap<number, string>): EsisRequestRegister {
  const items = ESIS_PORTAL_REQUESTS.map((request) => ({
    ...request,
    serviceKey: wiredApiIds.get(request.apiId) ?? null,
    dispositionReason: ESIS_DISPOSITIONS[request.apiId] ?? null,
  }));

  const approved = items.filter((item) => item.status === "APPROVED");

  return {
    reviewedAt: ESIS_REQUESTS_REVIEWED_AT,
    counts: {
      total: items.length,
      approved: approved.length,
      pending: items.filter((item) => item.status === "PENDING").length,
      cancelled: items.filter((item) => item.status === "CANCELLED").length,
      wired: approved.filter((item) => item.serviceKey !== null).length,
      approvedUnwired: approved.filter((item) => item.serviceKey === null).length,
    },
    items,
  };
}
