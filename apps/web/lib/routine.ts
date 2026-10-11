import { z } from "zod";

/**
 * Өдрийн дэглэм · Судлагдахуун · Дугуйлан — 2026-10-09, the client, from
 * their prototype: a group's daily routine (the same every day), its plan for
 * the seven learning areas, and its clubs, which a family asks to join and the
 * teacher approves. In the words of the 2026 preschool curriculum (СӨБ).
 *
 * Decisions the client made, so nobody re-asks them:
 *   1. one routine per group;
 *   2. the same every weekday — "бараг өөрчлөгддөггүй";
 *   3. clubs per group;
 *   4. the teacher approves a request; the accountant may bill it later
 *      (an invoice already has a «Дугуйлан» line type);
 *   5. the teacher adds and removes clubs freely.
 *
 * ★ The contract the backend is asked for — nothing answers it yet. Kept in
 * the web app until it lands in `@kinder/contracts`, as `lib/feedback.ts` was:
 *
 *   GET    /groups/:groupId/routine                → routineSchema   (TEACHER of the group, ADMIN)
 *   PUT    /groups/:groupId/routine/items          ← { items }       (TEACHER)
 *   PUT    /groups/:groupId/routine/plan           ← { plan }        (TEACHER)
 *   POST   /groups/:groupId/clubs                  ← clubInputSchema (TEACHER)
 *   PUT    /groups/:groupId/clubs/:clubId          ← clubInputSchema (TEACHER)
 *   DELETE /groups/:groupId/clubs/:clubId                            (TEACHER)
 *   POST   /groups/:groupId/club-requests/:id/approve | /reject      (TEACHER)
 *   GET    /children/:childId/routine              → routineSchema with only this child's requests (PARENT)
 *   POST   /children/:childId/club-requests        ← { clubId }      (PARENT)
 *
 * ★★ Learning areas are named, not referenced by id: they are the seven
 * `DevelopmentDomain` rows every kindergarten carries under these names, and
 * a name survives an import where an id would not. The backend maps them.
 */

export const LEARNING_AREAS = [
  "Нийгэм-сэтгэл хөдлөл",
  "Хөдөлгөөн, эрүүл мэнд",
  "Хэл яриа",
  "Байгаль, нийгмийн орчин",
  "Математик",
  "Зураг, урлал",
  "Хөгжим",
] as const;
export type LearningArea = (typeof LEARNING_AREAS)[number];

/** Each area's 3D picture — the client's set, 2026-10-09. */
export const AREA_IMAGE: Record<string, string> = {
  "Нийгэм-сэтгэл хөдлөл": "/icons/area-social.png",
  "Хөдөлгөөн, эрүүл мэнд": "/icons/area-health.png",
  "Хэл яриа": "/icons/area-language.png",
  "Байгаль, нийгмийн орчин": "/icons/area-nature.png",
  Математик: "/icons/area-math.png",
  "Зураг, урлал": "/icons/area-art.png",
  Хөгжим: "/icons/area-music.png",
};

const time = z.string().regex(/^\d{2}:\d{2}$/);

export const routineItemSchema = z.object({
  start: time,
  end: time,
  name: z.string().min(1).max(80),
  description: z.string().max(160).nullish(),
  areas: z.array(z.string()).default([]),
});
export type RoutineItem = z.infer<typeof routineItemSchema>;

export const areaPlanSchema = z.object({
  /** The standard name — the key routine rows and clubs refer to. */
  area: z.string(),
  /**
   * The group's own name for it, when the teacher renamed it — 2026-10-09, the
   * client: "сургалтын чиглэлийн нэршил бас засаж болдог байх". Shown in its
   * place; `area` stays the key, so a rename breaks no link.
   */
  label: z.string().max(60).nullish(),
  /** Хүүхдэд эзэмшүүлэх зорилго. */
  goal: z.string().max(600).default(""),
  /** Агуулга — what the group does towards it. */
  content: z.string().max(1200).default(""),
});
export type AreaPlan = z.infer<typeof areaPlanSchema>;

/** Monday 1 … Friday 5. */
export const WEEKDAYS = [
  { day: 1, short: "Да", name: "Даваа" },
  { day: 2, short: "Мя", name: "Мягмар" },
  { day: 3, short: "Лх", name: "Лхагва" },
  { day: 4, short: "Пү", name: "Пүрэв" },
  { day: 5, short: "Ба", name: "Баасан" },
] as const;

export const clubInputSchema = z.object({
  name: z.string().min(1).max(60),
  teacherName: z.string().min(1).max(60),
  room: z.string().max(50).nullish(),
  days: z.array(z.number().int().min(1).max(5)).min(1),
  start: time,
  end: time,
  areas: z.array(z.string()).min(1),
  goal: z.string().max(450).nullish(),
});
export type ClubInput = z.infer<typeof clubInputSchema>;

export const clubSchema = clubInputSchema.extend({ id: z.string() });
export type Club = z.infer<typeof clubSchema>;

export const CLUB_REQUEST_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type ClubRequestStatus = (typeof CLUB_REQUEST_STATUSES)[number];
export const CLUB_REQUEST_LABEL: Record<ClubRequestStatus, string> = {
  PENDING: "Хүлээгдэж буй",
  APPROVED: "Батлагдсан",
  REJECTED: "Татгалзсан",
};

export const clubRequestSchema = z.object({
  id: z.string(),
  clubId: z.string(),
  childId: z.string(),
  childName: z.string(),
  status: z.enum(CLUB_REQUEST_STATUSES),
  createdAt: z.string(),
});
export type ClubRequest = z.infer<typeof clubRequestSchema>;

export const routineSchema = z.object({
  group: z.object({ id: z.string(), name: z.string() }),
  items: z.array(routineItemSchema),
  plan: z.array(areaPlanSchema),
  clubs: z.array(clubSchema),
  requests: z.array(clubRequestSchema).default([]),
  updatedAt: z.string().nullish(),
});
export type Routine = z.infer<typeof routineSchema>;

export const ROUTINE_NOT_READY =
  "Өдрийн дэглэмийн сервер хараахан бэлэн болоогүй тул өөрчлөлт хадгалагдсангүй.";

/**
 * ★ The general template «манайхаас өгнө» — the 2026 curriculum's daily
 * activities (the same fourteen names the assessment screens count, see
 * `DAILY_ACTIVITIES`) at a typical full day's times. A teacher starts from
 * it and edits; it is a starting point, never the group's record.
 */
export const ROUTINE_TEMPLATE: RoutineItem[] = [
  {
    start: "08:00",
    end: "08:40",
    name: "Өглөөний хүлээн авалт",
    description: "Мэндчилгээ, эрүүл мэндийн үзлэг, чөлөөт тоглоом",
    areas: ["Нийгэм-сэтгэл хөдлөл"],
  },
  {
    start: "08:40",
    end: "08:55",
    name: "Өглөөний дасгал",
    description: "Хөдөлгөөнт дасгал, тоглоом",
    areas: ["Хөдөлгөөн, эрүүл мэнд"],
  },
  {
    start: "08:55",
    end: "09:10",
    name: "Тойргийн цаг",
    description: "Өдрийн төлөвлөгөө, ярилцлага",
    areas: ["Хэл яриа", "Нийгэм-сэтгэл хөдлөл"],
  },
  {
    start: "09:10",
    end: "09:30",
    name: "Цай",
    description: "Эрүүл хооллох дадал",
    areas: ["Хөдөлгөөн, эрүүл мэнд"],
  },
  {
    start: "09:30",
    end: "10:30",
    name: "Чиглүүлэгтэй тоглоом, үйл ажиллагаа",
    description: "Сургалтын чиглэлийн зорилгот үйл ажиллагаа",
    areas: ["Хэл яриа", "Математик", "Байгаль, нийгмийн орчин"],
  },
  {
    start: "10:30",
    end: "11:00",
    name: "Төвийн цаг",
    description: "Сонголтот төвүүдэд бие даан суралцах",
    areas: ["Зураг, урлал", "Математик"],
  },
  {
    start: "11:00",
    end: "12:00",
    name: "Зугаалгын цаг",
    description: "Гадаа ажиглалт, хөдөлгөөнт тоглоом",
    areas: ["Байгаль, нийгмийн орчин", "Хөдөлгөөн, эрүүл мэнд"],
  },
  {
    start: "12:00",
    end: "12:40",
    name: "Хооллолт",
    description: "Гар угаах, өөртөө үйлчлэх",
    areas: ["Хөдөлгөөн, эрүүл мэнд"],
  },
  { start: "12:40", end: "15:00", name: "Унталтын цаг", description: "Тайван амралт", areas: [] },
  {
    start: "15:00",
    end: "15:20",
    name: "Цай",
    description: "Үдээс хойших цай",
    areas: ["Хөдөлгөөн, эрүүл мэнд"],
  },
  {
    start: "15:20",
    end: "15:50",
    name: "Номын цаг",
    description: "Үлгэр сонсох, ном үзэх",
    areas: ["Хэл яриа"],
  },
  {
    start: "15:50",
    end: "16:30",
    name: "Хөгжөөн баясах ажил",
    description: "Дуу, бүжиг, хөгжим",
    areas: ["Хөгжим", "Зураг, урлал"],
  },
  {
    start: "16:30",
    end: "17:00",
    name: "Ганцаарчилсан үйл ажиллагаа",
    description: "Хүүхэд бүрийн хэрэгцээнд тулгуурласан",
    areas: [],
  },
  {
    start: "17:00",
    end: "18:00",
    name: "Чөлөөт тоглоом",
    description: "Хүүхдийг гэр бүлд хүлээлгэн өгөх",
    areas: ["Нийгэм-сэтгэл хөдлөл"],
  },
];

/**
 * The seven areas' general goals «манайхаас» — from the client's prototype,
 * condensed for a teacher's daily use. ★ Check against the officially
 * approved 2026 programme before calling them its wording; the teacher edits
 * them per group either way.
 */
export const PLAN_TEMPLATE: AreaPlan[] = [
  {
    area: "Нийгэм-сэтгэл хөдлөл",
    goal: "Сэтгэл хөдлөлөө таньж удирдах, бусадтай эерэгээр харилцах, хамтран ажиллах, бусдыг хүндэтгэх чадвар, хандлагыг хөгжүүлэх.",
    content: "",
  },
  {
    area: "Хөдөлгөөн, эрүүл мэнд",
    goal: "Идэвхтэй хөдөлгөөнөөр биеийн чадварыг хөгжүүлж, эрүүл ахуй, аюулгүй байдлын дадалтай болох.",
    content: "",
  },
  {
    area: "Хэл яриа",
    goal: "Эх хэлээрээ ойлгон сонсох, санаа бодлоо илэрхийлэх, ярилцах, унших бичихэд сонирхолтой болох.",
    content: "",
  },
  {
    area: "Байгаль, нийгмийн орчин",
    goal: "Байгаль, хүрээлэн буй орчин, хүмүүсийн амьдралыг танин мэдэж, хамгаалж хайрлах хандлагатай болох.",
    content: "",
  },
  {
    area: "Математик",
    goal: "Тоо, хэмжээ, дүрс, хугацаа, орон зайн ойлголтыг өдөр тутамд хэрэглэж, учир шалтгааныг тайлбарлах.",
    content: "",
  },
  {
    area: "Зураг, урлал",
    goal: "Мэдрэмж, төсөөллөө зурж урлан илэрхийлэх, материалыг бүтээлчээр ашиглах, бусдын бүтээлийг хүндэтгэх.",
    content: "",
  },
  {
    area: "Хөгжим",
    goal: "Хөгжим сонсох, дуулах, хөгжимдөх, хөдөлгөөнөөр мэдрэмжээ илэрхийлж, өв соёлыг хүндэтгэх.",
    content: "",
  },
];

/** A routine sorted by start time, as every screen draws it. */
export function sortRoutine(items: RoutineItem[]): RoutineItem[] {
  return [...items].sort((a, b) => a.start.localeCompare(b.start));
}

// ─── Excel: the CSV every «Excel» button in the product writes ───────────────

const COLUMNS = ["Эхлэх", "Дуусах", "Үйл ажиллагаа", "Тайлбар", "Сургалтын чиглэл"];

/** The routine as a spreadsheet Excel opens with its Cyrillic intact. */
export function routineToCsv(items: RoutineItem[]): string {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return [
    COLUMNS,
    ...sortRoutine(items).map((item) => [
      item.start,
      item.end,
      item.name,
      item.description ?? "",
      item.areas.join("; "),
    ]),
  ]
    .map((row) => row.map(quote).join(","))
    .join("\r\n");
}

function splitRow(line: string, separator: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === separator) {
      cells.push(cell);
      cell = "";
    } else cell += ch;
  }
  cells.push(cell);
  return cells.map((c) => c.trim());
}

/**
 * Rows read back from a CSV file or from cells pasted out of Excel (which
 * arrive tab-separated). A header row, blank lines and rows without a valid
 * time and a name are skipped; `skipped` counts the last kind so the teacher
 * is told rather than left to wonder.
 */
export function parseRoutineTable(text: string): { items: RoutineItem[]; skipped: number } {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim());
  const separator = lines.some((l) => l.includes("\t"))
    ? "\t"
    : lines[0]?.includes(";") && !lines[0]?.includes(",")
      ? ";"
      : ",";
  const items: RoutineItem[] = [];
  let skipped = 0;
  for (const line of lines) {
    const [start = "", end = "", name = "", description = "", areas = ""] = splitRow(
      line,
      separator,
    );
    if (start === COLUMNS[0]) continue;
    const pad = (t: string) => (/^\d:\d{2}$/.test(t) ? `0${t}` : t);
    const parsed = routineItemSchema.safeParse({
      start: pad(start),
      end: pad(end),
      name,
      description: description || null,
      areas: areas
        .split(/[;,]/)
        .map((a) => a.trim())
        .filter((a) => (LEARNING_AREAS as readonly string[]).includes(a)),
    });
    if (parsed.success) items.push(parsed.data);
    else skipped++;
  }
  return { items: sortRoutine(items), skipped };
}

/** Sample clubs and requests for the screens while the endpoint is missing. */
export function demoRoutine(group: { id: string; name: string }): Routine {
  return {
    group,
    items: ROUTINE_TEMPLATE,
    plan: PLAN_TEMPLATE,
    clubs: [
      {
        id: "demo-club-1",
        name: "Бяцхан хөгжимчин",
        teacherName: "Д.Энхжаргал",
        room: "Хөгжмийн өрөө",
        days: [1, 3],
        start: "15:00",
        end: "15:35",
        areas: ["Хөгжим"],
        goal: "Хэмнэлд тохируулан хөдөлж, дуу аялж сурах.",
      },
      {
        id: "demo-club-2",
        name: "Хөдөлгөөнтэй хүүхдүүд",
        teacherName: "С.Бат",
        room: "Спорт заал",
        days: [3, 5],
        start: "16:10",
        end: "16:40",
        areas: ["Хөдөлгөөн, эрүүл мэнд"],
        goal: "Тэнцвэр, эв дүй, багаар ажиллах чадвараа хөгжүүлэх.",
      },
    ],
    requests: [],
    updatedAt: null,
  };
}
