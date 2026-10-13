import { z } from "zod";
import type { Role, Session } from "@kinder/contracts";

/**
 * The user agreements a teacher and a guardian accept on their first sign-in
 * (2026-10-12, the user). A kindergarten signs its contract by e-mail, so a
 * director gets none here.
 *
 * ★ TRIAL TEXT. The drafted contracts are coming; when they arrive, replace
 * `sections` below and raise `version` — a new version asks everyone to
 * accept again, which is the point of versioning an agreement.
 *
 * ★★ The backend contract (#215 — the server accepts only `CURRENT_AGREEMENT_VERSIONS`
 * from `@kinder/contracts`, so raising `version` here means raising it there too):
 *
 *   GET  /me/agreements  → { accepted: [{ kind, version, acceptedAt }] }
 *   POST /me/agreements  { kind, version } → 201
 *
 * Who accepted which version, and when, belongs on the server: it is a record
 * someone may have to produce. Until the routes exist the acceptance is kept
 * in this browser only (`agreement-gate.tsx`), so the flow can be tried.
 */
export type AgreementKind = "TEACHER" | "PARENT";

export interface Agreement {
  kind: AgreementKind;
  version: string;
  title: string;
  sections: { heading: string; body: string }[];
}

const TRIAL_NOTE =
  "Энэ бол туршилтын хувилбар. Гэрээний эцсийн эх бичвэр удахгүй орж, дахин зөвшөөрөл авна.";

export const AGREEMENTS: Record<AgreementKind, Agreement> = {
  TEACHER: {
    kind: "TEACHER",
    version: "trial-2026-10-12",
    title: "Багш хэрэглэгчийн гэрээ",
    sections: [
      { heading: "Туршилтын хувилбар", body: TRIAL_NOTE },
      {
        heading: "1. Ерөнхий зүйл",
        body: "Энэхүү гэрээгээр NomadKids системийг багш ашиглахтай холбогдсон харилцааг зохицуулна.",
      },
      {
        heading: "2. Хүүхдийн мэдээллийн нууцлал",
        body: "Багш зөвхөн өөрийн хариуцсан бүлгийн хүүхдийн мэдээлэлд хандаж, түүнийг гуравдагч этгээдэд дамжуулахгүй.",
      },
      {
        heading: "3. Хэрэглэгчийн үүрэг",
        body: "Багш нэвтрэх нэр, нууц үгээ бусдад шилжүүлэхгүй бөгөөд системийг зөвхөн ажлын зорилгоор ашиглана.",
      },
    ],
  },
  PARENT: {
    kind: "PARENT",
    version: "trial-2026-10-12",
    title: "Эцэг эх хэрэглэгчийн гэрээ",
    sections: [
      { heading: "Туршилтын хувилбар", body: TRIAL_NOTE },
      {
        heading: "1. Ерөнхий зүйл",
        body: "Энэхүү гэрээгээр NomadKids системийг эцэг эх, асран хамгаалагч ашиглахтай холбогдсон харилцааг зохицуулна.",
      },
      {
        heading: "2. Хүүхдийн мэдээллийн нууцлал",
        body: "Эцэг эх зөвхөн өөрийн хүүхдийн мэдээллийг харах бөгөөд бусад хүүхдийн зураг, мэдээллийг тараахгүй.",
      },
      {
        heading: "3. Үйлчилгээний эрхийн төлбөр",
        body: "Үйлчилгээний эрхийн төлбөрийг улирлаар эсвэл жилээр төлнө. Хугацаа дуусахад хандалт хаагдана.",
      },
    ],
  },
};

export const acceptedAgreementsSchema = z.object({
  accepted: z.array(
    z.object({
      kind: z.enum(["TEACHER", "PARENT"]),
      version: z.string(),
      acceptedAt: z.string(),
    }),
  ),
});
export type AcceptedAgreement = z.infer<typeof acceptedAgreementsSchema>["accepted"][number];

/**
 * Which agreements this person signs: a teacher's and a guardian's. A
 * director's contract is the kindergarten's, signed by e-mail — except a solo
 * teacher (#202), who holds ADMIN only in a workspace of their own and signs
 * as the teacher they are. Someone who is both a teacher and a parent accepts
 * both.
 */
export function agreementKindsFor(session: Session | null | undefined): AgreementKind[] {
  const memberships = session?.memberships ?? [];
  const solo = new Set(session?.soloKindergartenIds ?? []);
  const has = (role: Role) => memberships.some((m) => m.role === role);
  const directsAContractedKindergarten = memberships.some(
    (m) => m.role === "ADMIN" && !solo.has(m.kindergartenId),
  );

  const kinds: AgreementKind[] = [];
  if (has("TEACHER") && !directsAContractedKindergarten) kinds.push("TEACHER");
  if (has("PARENT")) kinds.push("PARENT");
  return kinds;
}
