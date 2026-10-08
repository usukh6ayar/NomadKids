import type { Feedback } from "@/lib/feedback";

/**
 * Жишээ санал хүсэлт — shown while `/feedback` answers 404, so the client can
 * see both screens filled before the backend exists (2026-10-08: "саналыг
 * тестээр харуулаад өг").
 *
 * ★ Never sent anywhere and never mixed with real rows: the pages use these
 * only when the endpoint is missing, and say so in a banner. Every name is
 * invented.
 */

const named = (overrides: Partial<Feedback> & Pick<Feedback, "id" | "body">): Feedback => ({
  category: "OTHER",
  anonymous: false,
  author: null,
  childName: null,
  relation: null,
  groupName: null,
  teacherName: null,
  status: "NEW",
  createdAt: "2026-10-08T01:00:00.000Z",
  acknowledgedAt: null,
  reply: null,
  ...overrides,
});

/** What the administration's inbox holds — named and anonymous, every status. */
export const DEMO_INBOX: Feedback[] = [
  named({
    id: "demo-1",
    category: "FOOD",
    body: "Сүүлийн долоо хоногт өдрийн хоол хүйтэн ирж байна гэж хүүхэд маань хэлж байна. Шалгаж өгнө үү.",
    author: { firstName: "Сараа", lastName: "Батболд", phone: "99112233" },
    childName: "Тэмүүлэн",
    relation: "ээж",
    groupName: "Солонго бүлэг",
    teacherName: "Д.Сувдаа",
    createdAt: "2026-10-08T02:10:00.000Z",
  }),
  named({
    id: "demo-2",
    category: "FOOD",
    body: "Хоолны чанар муу байна. Ногоо бага, гурилан хоол их байна.",
    anonymous: true,
    createdAt: "2026-10-07T09:30:00.000Z",
  }),
  named({
    id: "demo-3",
    category: "HYGIENE",
    body: "Бүлгийн угаалгын өрөөнд саван байхгүй байх нь олон удаа давтагдлаа.",
    author: { firstName: "Ганбаатар", lastName: "Мөнх", phone: "88004455" },
    childName: "Номин",
    relation: "аав",
    groupName: "Нарлаг бүлэг",
    teacherName: "Б.Оюунаа",
    status: "ACKNOWLEDGED",
    createdAt: "2026-10-06T04:00:00.000Z",
    acknowledgedAt: "2026-10-06T06:00:00.000Z",
  }),
  named({
    id: "demo-4",
    category: "TEACHING",
    body: "Багш маань хүүхдүүдэд маш анхааралтай ханддаг, баярлалаа.",
    anonymous: true,
    status: "ACKNOWLEDGED",
    createdAt: "2026-10-05T03:00:00.000Z",
    acknowledgedAt: "2026-10-05T05:00:00.000Z",
  }),
  named({
    id: "demo-5",
    category: "FACILITY",
    body: "Тоглоомын талбайн дүүжин эвдэрсэн байна, хүүхэд гэмтэх вий.",
    author: { firstName: "Энхжин", lastName: "Төмөр", phone: "95556677" },
    childName: "Анужин",
    relation: "ээж",
    groupName: "Солонго бүлэг",
    teacherName: "Д.Сувдаа",
    status: "ANSWERED",
    createdAt: "2026-10-02T01:00:00.000Z",
    acknowledgedAt: "2026-10-02T02:00:00.000Z",
    reply: {
      body: "Таны мэдэгдэлд баярлалаа. Дүүжинг 10-р сарын 3-нд засварлаж, талбайн бусад тоног төхөөрөмжийг шалгалаа.",
      repliedAt: "2026-10-03T08:00:00.000Z",
    },
  }),
  named({
    id: "demo-6",
    category: "PAYMENT",
    body: "Энэ сарын төлбөрийн нэхэмжлэл хоёр удаа ирсэн. Аль нь зөв бэ?",
    author: { firstName: "Отгонбаяр", lastName: "Ганзориг", phone: "99887766" },
    childName: "Билгүүн",
    relation: "аав",
    groupName: "Од бүлэг",
    teacherName: "Ц.Алтанцэцэг",
    createdAt: "2026-10-07T12:00:00.000Z",
  }),
];

/** A guardian's own notes — what «Миний илгээсэн» looks like with history. */
export const DEMO_MINE: Feedback[] = [
  DEMO_INBOX[0]!,
  { ...DEMO_INBOX[1]!, id: "demo-mine-2" },
  DEMO_INBOX[4]!,
];
