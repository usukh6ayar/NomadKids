import { AlertTriangle, Inbox } from "lucide-react";
import { Card } from "@/components/ui/card";

/**
 * What went wrong, in words rather than in a code.
 *
 * ★ One copy. This table was written out twice — identically — in
 * `esis-pull-button.tsx` and `esis-data-panel.tsx`, which is two places to
 * forget when ESIS grows an error the adapter can raise. The two screens show
 * the same failures and now say the same sentences about them.
 *
 * ★★ `UNKNOWN` is the fallback the callers pass, and a code with no entry here
 * is rendered as itself rather than swallowed: an unlabelled `SCOPE_EXPIRED`
 * reads badly, but it reads, and "Тодорхойгүй алдаа" for a code the server
 * clearly named would be a worse answer.
 */
export const ESIS_ERROR_LABEL: Record<string, string> = {
  UNAUTHORIZED: "Token хүчингүй эсвэл хугацаа нь дууссан байна.",
  SCOPE_DENIED: "Энэ API-д манай token-д эрх олгоогүй байна.",
  TIMEOUT: "ESIS хугацаанд хариу өгсөнгүй.",
  NETWORK: "ESIS сервертэй холбогдож чадсангүй.",
  INVALID_RESPONSE: "ESIS-ийн хариу гэрээнд тохирохгүй байна.",
  NOT_CONFIGURED: "Server дээр ESIS тохиргоо алга байна.",
  HTTP: "ESIS алдаатай хариу буцаалаа.",
  UNKNOWN: "Тодорхойгүй алдаа гарлаа.",
  /*
   * ★ Added 2026-09-17, plan `2026-09-16-esis-sync-tiers.md` Task 7. A
   * reference resource (cook/*, screening questions, buildings, rooms, …) is
   * read from the copy tier 1's monthly sweep keeps, never from ESIS
   * directly — an empty copy means "nobody has synced it yet", not "the
   * connection failed", and there is deliberately no live fallback that would
   * quietly hide the difference. The sentence names the fix rather than just
   * the fact, per CLAUDE.md §5.
   */
  NOT_SYNCED:
    "ESIS лавлах мэдээлэл хараахан синк хийгдээгүй байна. Платформын оператороос синк хийлгэнэ үү.",
};

/**
 * What a reader sees where a table would have been.
 *
 * ★★★★ **The endpoint is no longer drawn on a product screen — 2026-09-20**,
 * and this reverses an instruction from six days earlier, so both belong on
 * the record.
 *
 * On 2026-09-14 the client asked for it: "esis-ээс мэдээлэл ирээгүйнүүд дээр
 * endpoint-ийг бичээд хариу ирсэнгүй гэсэн алдааны message өгөөрэй." The
 * reasoning was sound — with twenty-nine services in the catalogue, the path
 * is the only thing that identifies one unambiguously, and it is what a person
 * quotes when they open a ticket with БМТТ.
 *
 * On 2026-09-20 they saw the result on a director's screen — a heading, then
 * `GET /svc/api/hub/v2/group/next/academicYear`, then a sentence about a
 * service returning an empty list — and said: "хэрэглэгчдэд ийм зүйлс
 * харагдах хэрэггүй."
 *
 * Both are right, about different readers. The path is diagnostic and belongs
 * where somebody is diagnosing; a director looking at their own kindergarten
 * is not. So it is behind `technical`, off by default, and the sentences
 * beside it now describe the kindergarten rather than the transport: "одоогоор
 * бүртгэгдсэн мэдээлэл алга" rather than "энэ сервис хоосон жагсаалт буцаалаа".
 *
 * ★ Two kinds of silence, one component. A call that *failed* and a call that
 * *succeeded and returned nothing* are different facts and the heading still
 * says which — an empty roster is ordinary, an unreachable ministry is not.
 *
 * ★★ Not an error boundary and not a toast. It sits where the table would have
 * been, because the absence of the table is the thing being explained.
 */
/**
 * Reasons a product reader can act on, and therefore sees.
 *
 * ★ A blanket hide was wrong. Most of `ESIS_ERROR_LABEL` describes a transport
 * — "token хүчингүй", "гэрээнд тохирохгүй" — and means nothing to a director.
 * Two of them do not: an unsynced reference table and a deployment with no
 * ESIS configured both tell the reader **who to ask**, which is the one thing
 * a person staring at an empty panel actually wants. `NOT_SYNCED`'s sentence
 * was written for exactly that (plan `2026-09-16-esis-sync-tiers.md` Task 7)
 * and hiding it would have thrown the guidance away with the noise.
 */
const ACTIONABLE = new Set(["NOT_SYNCED", "NOT_CONFIGURED"]);

export function EsisNoAnswer({
  endpoint,
  errorCode,
  variant,
  technical = false,
}: {
  /**
   * ★ `name` is deliberately **not** rendered. Every surface that draws this
   * card already has the service's Mongolian name as its own heading directly
   * above, and repeating it made the name ambiguous rather than clearer.
   *
   * The path is drawn only when `technical` is set — see the docblock.
   */
  endpoint: { method: string; path: string } | undefined;
  /** `null` when the call succeeded and simply carried no rows. */
  errorCode: string | null;
  variant: "FAILED" | "EMPTY";
  /**
   * Show the method and path, and the transport-level reason.
   *
   * For a screen whose reader is diagnosing the integration. Off everywhere a
   * director, teacher, cook or guardian can reach.
   */
  technical?: boolean;
}) {
  const failed = variant === "FAILED";

  return (
    <Card
      pad="roomy"
      tone={failed ? "peach" : undefined}
      className={failed ? "" : "bg-canvas shadow-none"}
    >
      <div className="flex items-start gap-3">
        <span
          className={
            failed
              ? "flex size-10 shrink-0 items-center justify-center rounded-control bg-danger-soft text-danger"
              : "flex size-10 shrink-0 items-center justify-center rounded-control bg-sky text-sky-ink"
          }
        >
          {failed ? <AlertTriangle size={19} aria-hidden /> : <Inbox size={19} aria-hidden />}
        </span>
        <div className="min-w-0">
          <p className="text-lead font-semibold text-ink">
            {failed ? "Мэдээллийг татаж чадсангүй" : "Мэдээлэл алга байна"}
          </p>

          <p className="mt-1 text-caption leading-relaxed text-muted">
            {!failed
              ? "Энэ хэсэгт одоогоор бүртгэгдсэн мэдээлэл алга байна."
              : errorCode && ACTIONABLE.has(errorCode)
                ? ESIS_ERROR_LABEL[errorCode]
                : "Түр хүлээгээд дахин оролдоно уу. Давтагдвал цэцэрлэгийн удирдлагадаа хэлнэ үү."}
          </p>

          {/*
            ★ `break-all`, because a path is one unbroken token and a phone is
            360 pixels wide. Without it the line pushes the card's own width
            out and hands the horizontal scroll back to the page.
          */}
          {technical ? (
            <>
              {endpoint ? (
                <p className="mt-2 break-all font-mono text-caption text-faint">
                  {endpoint.method} {endpoint.path}
                </p>
              ) : null}
              {failed && !(errorCode && ACTIONABLE.has(errorCode)) ? (
                <p className="mt-1 text-caption text-muted">
                  {ESIS_ERROR_LABEL[errorCode ?? "UNKNOWN"] ?? errorCode}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
