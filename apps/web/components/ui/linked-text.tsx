import { Fragment } from "react";

/**
 * `https://…`, `http://…` and `www.…` — up to whitespace or a character no
 * address carries unescaped.
 */
const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"'«»]+/giu;

/** Punctuation that ends a sentence, not the address it follows. */
const TRAILING = /[.,!?:;)\]]+$/u;

/** The addresses in a text, as written. */
export function urlsIn(text: string): string[] {
  return [...text.matchAll(URL_PATTERN)].map((match) => match[0].replace(TRAILING, ""));
}

/**
 * Text with its web addresses as links — 2026-10-17, the client: a link put
 * in a post's text "болохгүй байна" — it was printed as plain text and could
 * not be opened.
 *
 * ★ React elements, never `dangerouslySetInnerHTML`: the text is whatever a
 * teacher or a family typed, and only `http(s)` and `www.` become an `href`,
 * so `javascript:` cannot. Opens in a new tab with no opener and no referrer.
 *
 * ★★ `complete` — for an excerpt. A cut-off address ("https://nomadkids.mn/m/12…")
 * is not one; only the addresses whole in the full text are linked, and a
 * truncated one stays text.
 */
export function LinkedText({ text, complete }: { text: string; complete?: string[] }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = match[0].replace(TRAILING, "");
    const start = match.index;
    if (complete && !complete.includes(url)) continue;
    parts.push(text.slice(last, start));
    parts.push(
      <a
        key={start}
        href={url.startsWith("www.") ? `https://${url}` : url}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all text-primary underline underline-offset-2 hover:text-primary-hover"
      >
        {url}
      </a>,
    );
    last = start + url.length;
  }
  parts.push(text.slice(last));
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>{part}</Fragment>
      ))}
    </>
  );
}
