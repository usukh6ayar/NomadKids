import { CONTACT } from "@/lib/contact";

/**
 * «Утсаа алдвал хэнд хандах вэ?» — one rule, said the same way everywhere
 * (2026-10-14, the user): whoever registered you resets your password. A
 * parent asks the teacher or the director, staff their director, and a
 * director or a solo teacher NomadKids. With the phone at hand anyone resets
 * by SMS on «Нууц үгээ мартсан уу?».
 *
 * Shown on that page, after an invitation is accepted, and in the FAQ
 * (`WHO_RESETS_TEXT`).
 */
export const WHO_RESETS = [
  { who: "Эцэг эх", ask: "Хүүхдийнхээ багш эсвэл цэцэрлэгийн эрхлэгчид" },
  { who: "Цэцэрлэгийн багш, ажилтан", ask: "Эрхлэгчдээ" },
  { who: "Эрхлэгч, бие даасан багш", ask: `NomadKids-д: ${CONTACT.phone}` },
] as const;

/** The same rule in one paragraph, for the FAQ. */
export const WHO_RESETS_TEXT = `Утас тань гарт байвал «Нууц үгээ мартсан уу?» холбоосоор бүртгэлтэй дугаараасаа нэг SMS илгээж, шинэ нууц үгээ өөрөө тохируулна. Утсаа алдсан эсвэл дугаараа сольсон бол таныг бүртгэсэн хүн тусална: эцэг эх — хүүхдийнхээ багш эсвэл цэцэрлэгийн эрхлэгч, цэцэрлэгийн багш, ажилтан — эрхлэгч, эрхлэгч болон бие даасан багш — NomadKids (${CONTACT.phone}, ${CONTACT.email}). Тэд хэн болохыг тань шалгаад нууц үг сэргээх нэг удаагийн холбоос өгнө.`;

export function WhoResets({
  title = "Утсаа алдсан эсвэл дугаараа сольсон уу?",
  bare = false,
}: {
  title?: string;
  /** Just the table — where the page's own heading already asks the question. */
  bare?: boolean;
}) {
  return (
    <div aria-label="Хэнд хандах вэ" className="flex flex-col gap-1.5 text-left">
      {bare ? null : <p className="text-caption font-semibold leading-5 text-ink">{title}</p>}
      <table className="w-full border-collapse text-caption leading-5">
        <tbody>
          {WHO_RESETS.map((row) => (
            <tr key={row.who} className="border-t border-border-soft first:border-t-0">
              <th scope="row" className="py-1 pr-3 text-left font-medium text-muted">
                {row.who}
              </th>
              <td className="py-1 text-ink">
                {row.ask.startsWith("NomadKids") ? (
                  <>
                    NomadKids-д:{" "}
                    <a
                      href={CONTACT.phoneHref}
                      className="font-semibold text-primary hover:underline"
                    >
                      {CONTACT.phone}
                    </a>
                  </>
                ) : (
                  row.ask
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {bare ? null : (
        <p className="text-caption leading-5 text-muted">
          Хэн болохыг тань шалгаад нууц үг сэргээх холбоос өгнө.
        </p>
      )}
    </div>
  );
}
