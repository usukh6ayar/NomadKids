import { ESIS_ENDPOINTS } from "./esis.endpoints";
import { ESIS_FIELDS } from "./esis.fields";

/**
 * The demo ESIS response for every service — **invented, never from ESIS**.
 *
 * ★ Why more than one row. `esis.fields.ts` gives each field one illustrative
 * value, which is enough to answer "what comes back?" but not "what does a
 * synced kindergarten look like?". A roster service that renders a single
 * child reads as a specification sheet; the operator asking to see the
 * integration before a token exists is asking for the second question. So
 * every list service carries a list, and the screen renders all of it through
 * the same component a live response uses.
 *
 * ★★ Every rule from `esis.fields.ts` still holds, unchanged:
 *
 *   1. Samples appear **only** while no live read has succeeded. One real row
 *      replaces the whole set — the UI never mixes invented and returned rows.
 *   2. Every surface that renders them labels them `Demo ESIS` in the same view.
 *   3. **Refused fields get no value in any row.** A row is built from the
 *      ingested field set only, so there is no key to accidentally fill: a
 *      fabricated register number cannot appear here even by typo.
 *
 * ★★★ Rows are written as *overrides* over the field catalog's own sample
 * rather than as free-standing objects. A row therefore cannot omit a field or
 * invent a key the service does not return, and adding a field to
 * `ESIS_FIELDS` fills it in across every row instead of leaving holes in all
 * but the first. The overrides carry only what actually differs between
 * records — identity, group, dates — which is also what makes the set read as
 * one kindergarten rather than as N unrelated fixtures.
 */
export type EsisEndpointKey = keyof typeof ESIS_ENDPOINTS;

/** One demo record: ingested field name → value. */
export type EsisSampleRow = Record<string, string | null>;

type Override = Record<string, string>;

/**
 * The base record — every ingested field of the service at its catalog sample.
 *
 * Both directions are included: sixteen services describe a response, and
 * `saveAttendanceV3` describes the request body NomadKids sends. The screen
 * shows whichever the service has, so the write service demonstrates its
 * payload rather than an empty table.
 */
function baseRow(key: EsisEndpointKey): EsisSampleRow {
  return Object.fromEntries(
    ESIS_FIELDS[key]
      .filter((field) => field.ingested)
      .map((field) => [field.name, field.sample ?? null]),
  );
}

/* ---------------------------------------------------------------------------
 * The demo tenant: institution 40305, two groups, ten children, five staff.
 *
 * The ids tie the services together — a child's `studentGroupId` is a row of
 * `groups`, a group's `instructorId` is a row of `teachers`, an attendance row
 * names a child of the group it belongs to. A demonstration where those do not
 * line up is the thing that makes a reviewer stop believing the screen.
 * ------------------------------------------------------------------------- */

const NARAN = { studentGroupId: "10001", studentGroupName: "Наран бүлэг" };
const TENGER = { studentGroupId: "10002", studentGroupName: "Тэнгэр бүлэг" };

const MIDDLE = { academicLevel: "2", academicLevelName: "Дунд бүлэг" };
const SENIOR = { academicLevel: "3", academicLevelName: "Ахлах бүлэг" };

const SARAA = { instructorId: "88012", instructorName: "Д.Сараа" };
const ARIUNAA = { instructorId: "88013", instructorName: "Б.Ариунаа" };

const MALE = { genderCode: "M", genderName: "Эрэгтэй" };
const FEMALE = { genderCode: "F", genderName: "Эмэгтэй" };

/** One child, in the shape both roster services return. */
function student(person: {
  personId: string;
  familyName: string;
  lastName: string;
  firstName: string;
  dateOfBirth: string;
  email: string;
  gender: typeof MALE;
  group: typeof NARAN;
  level: typeof MIDDLE;
  teacher: typeof SARAA;
}): Override {
  return {
    personId: person.personId,
    familyName: person.familyName,
    lastName: person.lastName,
    firstName: person.firstName,
    familyNameMgl: person.familyName,
    lastNameMgl: person.lastName,
    firstNameMgl: person.firstName,
    dateOfBirth: person.dateOfBirth,
    microsoftEmail: `${person.email}@esis.edu.mn`,
    googleEmail: `${person.email}@moes.edu.mn`,
    ...person.gender,
    ...person.group,
    ...person.level,
    ...person.teacher,
  };
}

/**
 * The ten children, oldest group first.
 *
 * The first row is the catalog's own sample, so the field table and the roster
 * agree on which child they are describing.
 */
const STUDENTS: Override[] = [
  student({
    personId: "90000000000001",
    familyName: "Боржигин",
    lastName: "Ганболд",
    firstName: "Батбаяр",
    dateOfBirth: "2021-04-12",
    email: "batbayar.g",
    gender: MALE,
    group: NARAN,
    level: MIDDLE,
    teacher: SARAA,
  }),
  student({
    personId: "90000000000002",
    familyName: "Хатагин",
    lastName: "Мөнхбат",
    firstName: "Ануужин",
    dateOfBirth: "2021-02-03",
    email: "anuujin.m",
    gender: FEMALE,
    group: NARAN,
    level: MIDDLE,
    teacher: SARAA,
  }),
  student({
    personId: "90000000000003",
    familyName: "Оронгот",
    lastName: "Тэмүүлэн",
    firstName: "Хулан",
    dateOfBirth: "2021-07-25",
    email: "khulan.t",
    gender: FEMALE,
    group: NARAN,
    level: MIDDLE,
    teacher: SARAA,
  }),
  student({
    personId: "90000000000004",
    familyName: "Боржигин",
    lastName: "Энхбаяр",
    firstName: "Тэмүүжин",
    dateOfBirth: "2021-11-08",
    email: "temuujin.e",
    gender: MALE,
    group: NARAN,
    level: MIDDLE,
    teacher: SARAA,
  }),
  student({
    personId: "90000000000005",
    familyName: "Сартуул",
    lastName: "Батжаргал",
    firstName: "Номин",
    dateOfBirth: "2021-09-30",
    email: "nomin.b",
    gender: FEMALE,
    group: NARAN,
    level: MIDDLE,
    teacher: SARAA,
  }),
  student({
    personId: "90000000000006",
    familyName: "Хэрэйд",
    lastName: "Пүрэвсүрэн",
    firstName: "Мөнх-Оргил",
    dateOfBirth: "2021-01-17",
    email: "munkh-orgil.p",
    gender: MALE,
    group: NARAN,
    level: MIDDLE,
    teacher: SARAA,
  }),
  student({
    personId: "90000000000007",
    familyName: "Жалайр",
    lastName: "Ганзориг",
    firstName: "Сувдаа",
    dateOfBirth: "2020-05-21",
    email: "suvdaa.g",
    gender: FEMALE,
    group: TENGER,
    level: SENIOR,
    teacher: ARIUNAA,
  }),
  student({
    personId: "90000000000008",
    familyName: "Тайчиуд",
    lastName: "Отгонбаяр",
    firstName: "Билгүүн",
    dateOfBirth: "2020-03-14",
    email: "bilguun.o",
    gender: MALE,
    group: TENGER,
    level: SENIOR,
    teacher: ARIUNAA,
  }),
  student({
    personId: "90000000000009",
    familyName: "Уряанхай",
    lastName: "Дэлгэрсайхан",
    firstName: "Ундрам",
    dateOfBirth: "2020-08-02",
    email: "undram.d",
    gender: FEMALE,
    group: TENGER,
    level: SENIOR,
    teacher: ARIUNAA,
  }),
  student({
    personId: "90000000000010",
    familyName: "Мэргэд",
    lastName: "Цэрэндорж",
    firstName: "Амарбаясгалан",
    dateOfBirth: "2020-12-19",
    email: "amarbayasgalan.ts",
    gender: MALE,
    group: TENGER,
    level: SENIOR,
    teacher: ARIUNAA,
  }),
];

/** The Наран бүлэг roster — the subset `groupStudents/:studentGroupId` answers. */
const NARAN_STUDENTS = STUDENTS.filter((row) => row.studentGroupId === NARAN.studentGroupId);

/** `firstName` is enough to read an attendance or movement row as a person. */
const byPersonId = (personId: string) =>
  STUDENTS.find((row) => row.personId === personId) ?? STUDENTS[0]!;

function attendance(personId: string, reason: [string, string], tardyMinutes = "0"): Override {
  const child = byPersonId(personId);
  return {
    personId,
    academicLevel: child.academicLevel!,
    dayDate: "2026-09-07",
    attendanceReasonCode: reason[0],
    attendanceReasonName: reason[1],
    tardyMinutes,
  };
}

/**
 * The part of a child's record `student/movement` repeats.
 *
 * ★ Narrower than the roster row on purpose. The movement service returns no
 * e-mail and no instructor, so spreading a whole student here would name
 * columns the service does not have — `unknownOverrideKeys` treats that as the
 * error it is rather than letting `sampleRows` drop them silently.
 */
const MOVEMENT_PERSON = [
  "personId",
  "familyName",
  "lastName",
  "firstName",
  "dateOfBirth",
  "genderCode",
  "genderName",
  "studentGroupId",
  "studentGroupName",
  "academicLevel",
  "academicLevelName",
] as const;

const movementPerson = (row: Override): Override =>
  Object.fromEntries(MOVEMENT_PERSON.filter((name) => row[name]).map((name) => [name, row[name]!]));

const PRESENT: [string, string] = ["PRESENT", "Ирсэн"];
const SICK: [string, string] = ["SICK", "Өвчтэй"];
const EXCUSED: [string, string] = ["EXCUSED", "Чөлөөтэй"];
const LATE: [string, string] = ["LATE", "Хоцорсон"];

function nutrition(values: [string, string, string, string, string]): Override {
  const [nutritionValue, calories, proteins, fats, carbohydrate] = values;
  return { nutrition: nutritionValue, calories, proteins, fats, carbohydrate };
}

/**
 * What differs between the records of each service.
 *
 * An empty object is a row identical to the catalog sample; a service with a
 * single record — an organisation has exactly one — carries exactly that.
 */
const OVERRIDES: Record<EsisEndpointKey, Override[]> = {
  organization: [{}],

  academicYearStatuses: [
    {},
    {
      academicYear: "2025",
      currentAcademicYearFlag: "N",
      openDate: "2025-09-01",
      closedDate: "2026-06-01",
      academicYearStatus: "CLOSED",
    },
  ],

  groups: [
    { ...NARAN, ...MIDDLE, ...SARAA, academicGroupId: "10001", academicGroupName: "Наран бүлэг" },
    {
      ...TENGER,
      ...SENIOR,
      ...ARIUNAA,
      academicGroupId: "10002",
      academicGroupName: "Тэнгэр бүлэг",
      programStageId: "13",
      programStageName: "Гуравдугаар үе шат",
    },
  ],

  students: STUDENTS,
  /* One child — the register number finds exactly one, or nothing. */
  studentByRegister: [STUDENTS[0]!],
  groupStudents: NARAN_STUDENTS,

  studentMovements: [
    {
      studentProgramId: "45012",
      actionId: "2",
      actionName: "Элсэлт",
      actionDate: "2026-09-01",
      ...movementPerson(STUDENTS[0]!),
    },
    {
      studentProgramId: "45013",
      actionId: "2",
      actionName: "Элсэлт",
      actionDate: "2026-09-01",
      ...movementPerson(STUDENTS[1]!),
    },
    {
      studentProgramId: "45019",
      actionId: "5",
      actionName: "Бүлэг шилжсэн",
      actionDate: "2026-09-03",
      approvalStatusCode: "APPROVED",
      approvalStatusName: "Баталгаажсан",
      ...movementPerson(STUDENTS[6]!),
    },
    {
      studentProgramId: "44870",
      actionId: "9",
      actionName: "Хасалт",
      actionDate: "2026-09-05",
      programStatusCode: "WITHDRAWN",
      programStatusName: "Суралцахаа больсон",
      approvalStatusCode: "PENDING",
      approvalStatusName: "Хүлээгдэж байна",
      personId: "90000000000011",
      familyName: "Барга",
      lastName: "Лхагвасүрэн",
      firstName: "Тэмүүлэн",
      dateOfBirth: "2020-10-11",
      ...MALE,
      ...TENGER,
      ...SENIOR,
    },
  ],

  teachers: [
    {},
    {
      assignmentId: "70012",
      personId: "90000000000022",
      // The teacher service names the instructor by `displayName`; the roster
      // and group services are the ones that carry `instructorName`.
      instructorId: ARIUNAA.instructorId,
      displayName: "Батсүхийн Ариунаа",
      familyName: "Хатагин",
      lastName: "Батсүх",
      firstName: "Ариунаа",
      familyNameMgl: "Хатагин",
      lastNameMgl: "Батсүх",
      firstNameMgl: "Ариунаа",
      dateOfBirth: "1987-02-28",
      instructorTypeId: "1",
      instructorTypeName: "Үндсэн багш",
      microsoftEmail: "ariunaa.b@esis.edu.mn",
      googleEmail: "ariunaa.b@gmail.com",
      allEmail: "ariunaa.b@esis.edu.mn",
    },
  ],

  staff: [
    {},
    {
      assignmentId: "70045",
      personId: "90000000000046",
      familyName: "Боржигин",
      lastName: "Цэрэндорж",
      firstName: "Наранцэцэг",
      familyNameMgl: "Боржигин",
      lastNameMgl: "Цэрэндорж",
      firstNameMgl: "Наранцэцэг",
      dateOfBirth: "1991-07-04",
      positionName: "Их эмч",
      positionCode: "NURSE",
      jobCode: "2201",
      minor: "Бага насны хүүхдийн эмч",
      educationSectorYears: "7",
      yearsOfService: "11",
      microsoftEmail: "narantsetseg.ts@esis.edu.mn",
      googleEmail: "narantsetseg.ts@gmail.com",
      allEmail: "narantsetseg.ts@esis.edu.mn",
    },
    {
      assignmentId: "70046",
      personId: "90000000000047",
      familyName: "Сартуул",
      lastName: "Дамдин",
      firstName: "Отгонбаяр",
      familyNameMgl: "Сартуул",
      lastNameMgl: "Дамдин",
      firstNameMgl: "Отгонбаяр",
      dateOfBirth: "1979-09-16",
      ...MALE,
      positionName: "Ахлах тогооч",
      positionCode: "COOK",
      jobCode: "5120",
      minor: "Хүнс, үйлчилгээ",
      educationSectorYears: "12",
      yearsOfService: "24",
      microsoftEmail: "otgonbayar.d@esis.edu.mn",
      googleEmail: "otgonbayar.d@gmail.com",
      allEmail: "otgonbayar.d@esis.edu.mn",
    },
  ],

  /* One school day of Наран бүлэг, the group `studentGroupId` above names. */
  groupAttendance: [
    attendance("90000000000001", PRESENT),
    attendance("90000000000002", PRESENT),
    attendance("90000000000003", LATE, "15"),
    attendance("90000000000004", SICK),
    attendance("90000000000005", PRESENT),
    attendance("90000000000006", EXCUSED),
  ],

  /* The write service: one request body, not a response. */
  saveAttendanceV3: [{ attendanceList: "6 мөр" }],

  foodProductTypes: [
    {},
    { productType: "MAIN", productTypeName: "2-р хоол" },
    { productType: "DRINK", productTypeName: "Ундаа" },
    { productType: "SNACK", productTypeName: "Зууш" },
  ],

  foodMaterialGroups: [
    {},
    { groupId: "15", groupCode: "СҮҮ", groupName: "Сүү, сүүн бүтээгдэхүүн", parentGroupId: "2" },
    {
      groupId: "16",
      groupCode: "ГУР",
      groupName: "Гурил, гурилан бүтээгдэхүүн",
      parentGroupId: "3",
    },
    { groupId: "17", groupCode: "ХҮН", groupName: "Хүнсний ногоо", parentGroupId: "3" },
    { groupId: "18", groupCode: "ЖИМ", groupName: "Жимс, жимсгэнэ", parentGroupId: "3" },
    { groupId: "19", groupCode: "ӨӨХ", groupName: "Өөх тос", parentGroupId: "4" },
  ],

  foodMaterials: [
    {},
    {
      materialId: "3022",
      groupId: "14",
      materialCode: "M-3022",
      materialName: "Хонины мах (цул)",
      sequence: "28",
      ...nutrition(["16.4", "203", "16.4", "15.3", "0"]),
    },
    {
      materialId: "3105",
      groupId: "15",
      materialCode: "M-3105",
      materialName: "Сүү (3.2%)",
      measureCode: "ml",
      sequence: "4",
      ...nutrition(["2.9", "60", "2.9", "3.2", "4.7"]),
    },
    {
      materialId: "3112",
      groupId: "15",
      materialCode: "M-3112",
      materialName: "Цөцгийн тос",
      sequence: "9",
      ...nutrition(["0.8", "748", "0.8", "82.5", "0.9"]),
    },
    {
      materialId: "3204",
      groupId: "16",
      materialCode: "M-3204",
      materialName: "Гурил (дээд зэрэг)",
      sequence: "1",
      ...nutrition(["10.3", "334", "10.3", "1.1", "70.6"]),
    },
    {
      materialId: "3301",
      groupId: "17",
      materialCode: "M-3301",
      materialName: "Төмс",
      sequence: "2",
      ...nutrition(["2.0", "77", "2.0", "0.4", "16.3"]),
    },
    {
      materialId: "3305",
      groupId: "17",
      materialCode: "M-3305",
      materialName: "Лууван",
      sequence: "6",
      ...nutrition(["1.3", "35", "1.3", "0.1", "6.9"]),
    },
    {
      materialId: "3410",
      groupId: "18",
      materialCode: "M-3410",
      materialName: "Алим",
      sequence: "3",
      supplierType: "N",
      ...nutrition(["0.4", "47", "0.4", "0.4", "9.8"]),
    },
  ],

  foodProducts: [
    {},
    {
      productId: "5108",
      productCode: "P-5108",
      productName: "Ногоотой шөл",
      productType: "SOUP",
      sequence: "18",
      ...nutrition(["6.4", "168", "6.4", "5.1", "22.9"]),
    },
    {
      productId: "5201",
      productCode: "P-5201",
      productName: "Цуйван",
      productType: "MAIN",
      sequence: "3",
      ...nutrition(["14.2", "412", "14.2", "16.8", "48.1"]),
    },
    {
      productId: "5202",
      productCode: "P-5202",
      productName: "Хуушуур",
      productType: "MAIN",
      measureCode: "ш",
      sequence: "7",
      ...nutrition(["11.6", "365", "11.6", "20.4", "31.2"]),
    },
    {
      productId: "5203",
      productCode: "P-5203",
      productName: "Будаатай хуурга",
      productType: "MAIN",
      sequence: "11",
      ...nutrition(["13.1", "388", "13.1", "13.9", "50.4"]),
    },
    {
      productId: "5241",
      productCode: "P-5241",
      productName: "Сүүтэй цай",
      productType: "DRINK",
      measureCode: "мл",
      hasRecipeFlag: "Y",
      sequence: "1",
      ...nutrition(["3.2", "96", "3.2", "3.5", "12.8"]),
    },
    {
      productId: "5242",
      productCode: "P-5242",
      productName: "Жимсний компот",
      productType: "DRINK",
      measureCode: "мл",
      sequence: "5",
      ...nutrition(["0.3", "72", "0.3", "0.1", "17.6"]),
    },
    {
      productId: "5301",
      productCode: "P-5301",
      productName: "Алим",
      productType: "SNACK",
      measureCode: "ш",
      hasRecipeFlag: "N",
      sequence: "2",
      ...nutrition(["0.4", "47", "0.4", "0.4", "9.8"]),
    },
  ],

  /* The technology card of `Гурилтай шөл` (product 5107) — six ingredients. */
  foodProductMaterials: [
    {},
    {
      productMaterialId: "88013",
      materialId: "3204",
      groupId: "16",
      grossWeight: "30.0",
      netWeight: "30.0",
      sequence: "2",
    },
    {
      productMaterialId: "88014",
      materialId: "3301",
      groupId: "17",
      grossWeight: "80.0",
      netWeight: "60.0",
      sequence: "3",
    },
    {
      productMaterialId: "88015",
      materialId: "3305",
      groupId: "17",
      grossWeight: "25.0",
      netWeight: "20.0",
      sequence: "4",
    },
    {
      productMaterialId: "88016",
      materialId: "3112",
      groupId: "15",
      grossWeight: "5.0",
      netWeight: "5.0",
      sequence: "5",
    },
    {
      productMaterialId: "88017",
      materialId: "3105",
      groupId: "15",
      measureCode: "мл",
      grossWeight: "200.0",
      netWeight: "200.0",
      sequence: "6",
    },
  ],

  foodKit: [
    {},
    {
      productId: "5245",
      productType: "SNACK",
      ...nutrition(["6.9", "184", "6.9", "5.8", "26.1"]),
    },
  ],

  foodKitProducts: [
    {},
    {
      productCode: "P-5108",
      productName: "Ногоотой шөл",
      productType: "SOUP",
      ...nutrition(["6.4", "168", "6.4", "5.1", "22.9"]),
    },
    {
      productCode: "P-5301",
      productName: "Алим",
      productType: "SNACK",
      ...nutrition(["0.4", "47", "0.4", "0.4", "9.8"]),
    },
  ],
};

/**
 * Every demo record of one service.
 *
 * ★ Shaped exactly like `EsisAdminService.read` rows, so the screen renders the
 * demonstration through the same component as a live result and the two cannot
 * drift into looking different by accident. Labelling it is the caller's job —
 * this function has no way to.
 */
export function sampleRows(key: EsisEndpointKey): EsisSampleRow[] {
  const base = baseRow(key);
  const columns = Object.keys(base);
  return OVERRIDES[key].map((override) =>
    Object.fromEntries(columns.map((name) => [name, override[name] ?? base[name] ?? null])),
  );
}

/**
 * Override keys that name no field of their service.
 *
 * ★ `sampleRows` builds a row from the field catalog's own key set, so a
 * mistyped or stale override is dropped rather than rendered — which is the
 * right behaviour on screen and the wrong one in a source file, because the
 * row then quietly shows the catalog sample where the author meant something
 * else. `esis.fields.test.ts` fails on anything this returns.
 */
export function unknownOverrideKeys(): { key: EsisEndpointKey; name: string }[] {
  return (Object.keys(OVERRIDES) as EsisEndpointKey[]).flatMap((key) => {
    const columns = new Set(Object.keys(baseRow(key)));
    return OVERRIDES[key].flatMap((override) =>
      Object.keys(override)
        .filter((name) => !columns.has(name))
        .map((name) => ({ key, name })),
    );
  });
}
