import type { Role } from "@kinder/contracts";

export interface EsisDemoProfileInput {
  username?: string | null;
  lastName: string;
  firstName: string;
  email?: string | null;
  phone?: string | null;
}

export interface EsisDemoField {
  label: string;
  value: string;
}

export interface EsisDemoProfile {
  resource: "teachers" | "staff";
  resourceLabel: string;
  institutionName: string;
  institutionId: string;
  syncedAt: string;
  summary: EsisDemoField[];
  employment: EsisDemoField[];
  contact: EsisDemoField[];
  profileDefaults: {
    specialization: string;
  };
}

const INSTITUTION_ID = "40305";
const INSTITUTION_NAME = "Бяцхан нүүдэлчид (жишээ)";
const DEMO_ACCOUNT_PREFIXES = ["bagsh1", "bagsh2", "zahiral", "togooch", "nyagtlan"];

const STAFF_POSITION: Partial<Record<Role, { name: string; code: string; jobCode: string }>> = {
  ADMIN: { name: "Эрхлэгч", code: "DIRECTOR", jobCode: "1001" },
  COOK: { name: "Тогооч", code: "COOK", jobCode: "3102" },
  ACCOUNTANT: { name: "Нягтлан бодогч", code: "ACCOUNTANT", jobCode: "2204" },
};

function displayName(input: EsisDemoProfileInput) {
  const initial = input.lastName.trim().slice(0, 1);
  return initial ? `${initial}.${input.firstName}` : input.firstName;
}

function officialEmail(input: EsisDemoProfileInput, domain: string) {
  const local = input.username?.trim().toLowerCase() || "staff";
  return `${local}@${domain}`;
}

/**
 * Builds the populated record shown on role screens while ESIS is in demo mode.
 *
 * Names and ordinary contact details come from the signed-in account. External
 * identifiers are explicitly illustrative and the UI labels them as demo data;
 * civil IDs, registration numbers and credentials are never represented here.
 */
export function buildEsisDemoProfile(
  input: EsisDemoProfileInput,
  roles: ReadonlySet<Role>,
): EsisDemoProfile | null {
  const username = input.username?.trim().toLowerCase() ?? "";
  if (
    !DEMO_ACCOUNT_PREFIXES.some(
      (prefix) => username === prefix || username.startsWith(`${prefix}-`),
    )
  ) {
    return null;
  }

  if (roles.has("TEACHER")) {
    const secondTeacher = username.startsWith("bagsh2");

    return {
      resource: "teachers",
      resourceLabel: "Багшийн бүртгэл",
      institutionName: INSTITUTION_NAME,
      institutionId: INSTITUTION_ID,
      syncedAt: "2026.09.08 09:15",
      summary: [
        { label: "Дэлгэцийн нэр", value: displayName(input) },
        { label: "ESIS хүний дугаар", value: secondTeacher ? "90000000000022" : "90000000000021" },
        { label: "Томилгооны код", value: secondTeacher ? "70012" : "70011" },
        { label: "Багшийн код", value: secondTeacher ? "88013" : "88012" },
      ],
      employment: [
        { label: "Албан тушаал", value: "Багш" },
        { label: "Багшийн төрөл", value: "Үндсэн багш" },
        { label: "Заах аргын нэгдэл", value: "Сургуулийн өмнөх боловсрол" },
        { label: "Ажиллах төлөв", value: "Идэвхтэй" },
      ],
      contact: [
        { label: "Бүртгэлтэй и-мэйл", value: input.email || officialEmail(input, "nomadkids.mn") },
        { label: "Microsoft албан и-мэйл", value: officialEmail(input, "esis.edu.mn") },
        { label: "Google албан и-мэйл", value: officialEmail(input, "moes.edu.mn") },
        { label: "Бүх и-мэйл", value: officialEmail(input, "esis.edu.mn") },
      ],
      profileDefaults: { specialization: "Сургуулийн өмнөх боловсрол" },
    };
  }

  const staffRole = (["ADMIN", "COOK", "ACCOUNTANT"] as const).find((role) => roles.has(role));
  if (!staffRole) return null;

  const position = STAFF_POSITION[staffRole]!;
  const roleOffset = staffRole === "ADMIN" ? "44" : staffRole === "COOK" ? "46" : "47";

  return {
    resource: "staff",
    resourceLabel: "Ажилтны бүртгэл",
    institutionName: INSTITUTION_NAME,
    institutionId: INSTITUTION_ID,
    syncedAt: "2026.09.08 09:15",
    summary: [
      { label: "Дэлгэцийн нэр", value: displayName(input) },
      { label: "ESIS хүний дугаар", value: `900000000000${roleOffset}` },
      { label: "Томилгооны код", value: `700${roleOffset}` },
      { label: "Үндсэн ажлын байр", value: "Тийм" },
    ],
    employment: [
      { label: "Албан тушаал", value: position.name },
      { label: "Албан тушаалын код", value: position.code },
      { label: "Ажлын байрны код", value: position.jobCode },
      { label: "Ажиллах төлөв", value: "Идэвхтэй" },
    ],
    contact: [
      { label: "Бүртгэлтэй и-мэйл", value: input.email || officialEmail(input, "nomadkids.mn") },
      { label: "Microsoft албан и-мэйл", value: officialEmail(input, "esis.edu.mn") },
      { label: "Google албан и-мэйл", value: officialEmail(input, "moes.edu.mn") },
      { label: "Бүх и-мэйл", value: officialEmail(input, "esis.edu.mn") },
    ],
    profileDefaults: {
      specialization:
        staffRole === "ADMIN"
          ? "Багш, арга зүйч"
          : staffRole === "COOK"
            ? "Хоол үйлдвэрлэл"
            : "Нягтлан бодох бүртгэл",
    },
  };
}
