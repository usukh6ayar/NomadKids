import { useSyncExternalStore } from "react";

export type SchoolMonthKey = "09" | "10" | "11" | "12" | "01" | "02" | "03" | "04" | "05";

export type SchoolMonth = {
  key: SchoolMonthKey;
  label: string;
  subtitle: string;
  cover: string;
  spine: string;
  ink: string;
};

export const SCHOOL_MONTHS: readonly SchoolMonth[] = [
  {
    key: "09",
    label: "9-р сар",
    subtitle: "Намрын эхлэл",
    cover: "from-amber-100 to-orange-100",
    spine: "bg-orange-300",
    ink: "text-orange-900",
  },
  {
    key: "10",
    label: "10-р сар",
    subtitle: "Алтан намар",
    cover: "from-rose-100 to-pink-100",
    spine: "bg-rose-300",
    ink: "text-rose-900",
  },
  {
    key: "11",
    label: "11-р сар",
    subtitle: "Өвлийн угтал",
    cover: "from-sky-100 to-cyan-100",
    spine: "bg-sky-300",
    ink: "text-sky-900",
  },
  {
    key: "12",
    label: "12-р сар",
    subtitle: "Шинэ жилийн аялгуу",
    cover: "from-indigo-100 to-violet-100",
    spine: "bg-indigo-300",
    ink: "text-indigo-900",
  },
  {
    key: "01",
    label: "1-р сар",
    subtitle: "Цасан үлгэр",
    cover: "from-blue-100 to-sky-100",
    spine: "bg-blue-300",
    ink: "text-blue-900",
  },
  {
    key: "02",
    label: "2-р сар",
    subtitle: "Нөхөрлөлийн сар",
    cover: "from-fuchsia-100 to-purple-100",
    spine: "bg-fuchsia-300",
    ink: "text-fuchsia-900",
  },
  {
    key: "03",
    label: "3-р сар",
    subtitle: "Хаврын мэнд",
    cover: "from-emerald-100 to-green-100",
    spine: "bg-emerald-300",
    ink: "text-emerald-900",
  },
  {
    key: "04",
    label: "4-р сар",
    subtitle: "Байгаль сэрлээ",
    cover: "from-lime-100 to-yellow-100",
    spine: "bg-lime-300",
    ink: "text-lime-900",
  },
  {
    key: "05",
    label: "5-р сар",
    subtitle: "Төгсөлтийн дурсамж",
    cover: "from-yellow-100 to-amber-100",
    spine: "bg-yellow-300",
    ink: "text-amber-900",
  },
] as const;

export type SongPoemType = "song" | "poem" | "folklore" | "fairy_tale";

export type SongPoemResource = {
  id: string;
  month: SchoolMonthKey;
  type: SongPoemType;
  title: string;
  description: string;
  coverUrl?: string;
  coverFileName?: string;
  fileUrl?: string;
  fileName?: string;
  fileType?: string;
  updatedAt: string;
};

export type SongPoemDraft = Omit<SongPoemResource, "id" | "updatedAt">;

const DEMO_RESOURCES: SongPoemResource[] = [
  {
    id: "demo-morning-greeting",
    month: "09",
    type: "song",
    title: "Өглөөний мэнд",
    description: "Өглөөний тойргоор хамтран дуулж, найзуудтайгаа мэндчилнэ.",
    coverUrl: "/icons/area-music.png",
    updatedAt: "2026.09.12",
  },
  {
    id: "demo-my-family",
    month: "09",
    type: "poem",
    title: "Миний гэр бүл",
    description: "Гэр бүлийнхээ тухай энгийн өгүүлбэрээр ярьж, шүлгийг хөдөлгөөнтэй уншина.",
    updatedAt: "2026.09.24",
  },
  {
    id: "demo-golden-autumn",
    month: "10",
    type: "song",
    title: "Алтан намар",
    description: "Навчны өнгө, намрын салхийг хөдөлгөөнөөр дүрслэн дуулна.",
    coverUrl: "/icons/area-music.png",
    updatedAt: "2026.10.08",
  },
  {
    id: "demo-snow",
    month: "12",
    type: "poem",
    title: "Анхны цас",
    description: "Цасны ширхэг, өвлийн байгалийг дүрсэлсэн богино шүлэг.",
    updatedAt: "2026.12.03",
  },
  {
    id: "demo-spring",
    month: "03",
    type: "song",
    title: "Хавар ирлээ",
    description: "Шувууд, ургамал, дулаан нарыг хэмнэлтэй хөдөлгөөнөөр илэрхийлнэ.",
    coverUrl: "/icons/area-music.png",
    updatedAt: "2027.03.11",
  },
  {
    id: "demo-graduation",
    month: "05",
    type: "poem",
    title: "Баяртай, цэцэрлэг минь",
    description: "Цэцэрлэгийн дурсамж, багш найзууддаа зориулсан төгсөлтийн шүлэг.",
    updatedAt: "2027.05.18",
  },
];

let schoolMonths: SchoolMonth[] = SCHOOL_MONTHS.map((item) => ({ ...item }));
let resources: SongPoemResource[] = DEMO_RESOURCES.map((item) => ({ ...item }));
const monthListeners = new Set<() => void>();
const listeners = new Set<() => void>();

function emitMonths() {
  for (const listener of monthListeners) listener();
}

function subscribeMonths(listener: () => void) {
  monthListeners.add(listener);
  return () => {
    monthListeners.delete(listener);
  };
}

function monthSnapshot() {
  return schoolMonths;
}

export function useSchoolMonths() {
  return useSyncExternalStore(subscribeMonths, monthSnapshot, monthSnapshot);
}

export function updateSchoolMonth(
  key: SchoolMonthKey,
  values: Pick<SchoolMonth, "label" | "subtitle">,
) {
  schoolMonths = schoolMonths.map((month) =>
    month.key === key ? { ...month, label: values.label, subtitle: values.subtitle } : month,
  );
  emitMonths();
}

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot() {
  return resources;
}

export function useSongPoemResources() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function createSongPoemResource(draft: SongPoemDraft) {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `song-poem-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  resources = [
    ...resources,
    { ...draft, id, updatedAt: new Date().toISOString().slice(0, 10).replaceAll("-", ".") },
  ];
  emit();
}

export function updateSongPoemResource(id: string, draft: SongPoemDraft) {
  resources = resources.map((item) =>
    item.id === id
      ? { ...item, ...draft, updatedAt: new Date().toISOString().slice(0, 10).replaceAll("-", ".") }
      : item,
  );
  emit();
}

export function removeSongPoemResource(id: string) {
  resources = resources.filter((item) => item.id !== id);
  emit();
}

/** Restores deterministic fixtures for isolated component tests. */
export function resetSongPoemResources() {
  schoolMonths = SCHOOL_MONTHS.map((item) => ({ ...item }));
  resources = DEMO_RESOURCES.map((item) => ({ ...item }));
  emitMonths();
  emit();
}
