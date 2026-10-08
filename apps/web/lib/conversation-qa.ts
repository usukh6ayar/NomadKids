/**
 * «Ярилцлага» as question-and-answer pairs — 2026-10-08, the client: a
 * conversation note is the teacher's question and the child's answer, «＋» for
 * the next one.
 *
 * ★ Written into the note's own text (`situation`), the title first and one
 * pair to a paragraph:
 *
 *   Гарчиг: Алим тоолох
 *
 *   Асуулт: Энэ юу вэ?
 *   Хариулт: Алим.
 *
 * The API has no question/answer fields and its schema is `.strict()`, and
 * every place that already shows a note — the list, the enlarged view, the
 * PDF — shows this text as it is. A plain format a person can read is the one
 * that survives all of them.
 */

export interface QaPair {
  q: string;
  a: string;
}

/** A conversation: its title — 2026-10-08, the client — and its pairs. */
export interface Conversation {
  title: string;
  pairs: QaPair[];
}

const T = "Гарчиг:";
const Q = "Асуулт:";
const A = "Хариулт:";

/** The note text for a conversation; a pair with neither half is left out. */
export function conversationToText({ title, pairs }: Conversation): string {
  const head = title.trim() ? `${T} ${title.trim()}` : "";
  return [head, qaToText(pairs)].filter(Boolean).join("\n\n");
}

/** The conversation a note's text holds — see `textToQa` for the pairs. */
export function textToConversation(text: string): Conversation {
  const trimmed = text.trim();
  if (!trimmed.startsWith(T)) return { title: "", pairs: textToQa(trimmed) };
  const [first, ...rest] = trimmed.split("\n");
  return { title: first!.slice(T.length).trim(), pairs: textToQa(rest.join("\n")) };
}

/** The pairs as note text; a pair with neither half is left out. */
export function qaToText(pairs: QaPair[]): string {
  return pairs
    .map((pair) => ({ q: pair.q.trim(), a: pair.a.trim() }))
    .filter((pair) => pair.q || pair.a)
    .map((pair) => [pair.q ? `${Q} ${pair.q}` : "", pair.a ? `${A} ${pair.a}` : ""])
    .map((lines) => lines.filter(Boolean).join("\n"))
    .join("\n\n");
}

/**
 * The pairs a note's text holds. Text not written in this format comes back
 * as one answer, so nothing a teacher wrote before is lost.
 */
export function textToQa(text: string): QaPair[] {
  const trimmed = text.trim();
  if (!trimmed) return [{ q: "", a: "" }];
  if (!trimmed.startsWith(Q) && !trimmed.startsWith(A)) return [{ q: "", a: trimmed }];
  const pairs: QaPair[] = [];
  for (const line of trimmed.split("\n")) {
    if (line.startsWith(Q)) pairs.push({ q: line.slice(Q.length).trim(), a: "" });
    else if (line.startsWith(A)) {
      const last = pairs.at(-1);
      if (last && !last.a) last.a = line.slice(A.length).trim();
      else pairs.push({ q: "", a: line.slice(A.length).trim() });
    } else if (line.trim() && pairs.length > 0) {
      const last = pairs.at(-1)!;
      if (last.a) last.a += `\n${line}`;
      else last.q += `\n${line}`;
    }
  }
  return pairs.length > 0 ? pairs : [{ q: "", a: "" }];
}

/**
 * The title and the questions — what the А/79 suggestions read on a
 * conversation (client, 2026-10-08: "гарчигаас бас шалгуур хайгдаж болно").
 * Not the answers: what the teacher asked and about what names the skill.
 */
export function qaQuestions(pairs: QaPair[], title = ""): string {
  return [title, ...pairs.map((pair) => pair.q)]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}
