import { AlertTriangle } from "lucide-react";
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
};

/**
 * "ESIS-ээс мэдээлэл ирсэнгүй" — and **which** service did not answer.
 *
 * ★ **The endpoint is named here — 2026-09-14, at the client's instruction:**
 * "esis-ээс мэдээлэл ирээгүйнүүд дээр endpoint-ийг бичээд хариу ирсэнгүй гэсэн
 * алдааны message өгөөрэй."
 *
 * What stood here was "ESIS хариу өгсөнгүй" and a one-line reason, on a screen
 * that can show a dozen services at once. Which of them failed was not in the
 * message, so the sentence was true and unusable: the reader could see that
 * something did not answer and not what. With twenty-nine services in the
 * catalogue, the path is the only thing that identifies one unambiguously —
 * the Mongolian name is friendlier and two services can share a shape, while
 * `GET /svc/api/hub/v2/students/list` is what a person quotes when they open a
 * ticket with БМТТ.
 *
 * ★★ Two kinds of silence, one component. A call that *failed* and a call that
 * *succeeded and returned nothing* are different facts and the heading says
 * which — but both leave the reader looking at an empty space wondering which
 * service produced it, and that is the question the path answers in both
 * cases.
 *
 * ★★★ Not an error boundary and not a toast. It sits where the table would
 * have been, because the absence of the table is the thing being explained.
 */
export function EsisNoAnswer({
  endpoint,
  errorCode,
  variant,
}: {
  /**
   * ★ `name` is deliberately **not** rendered. Every surface that draws this
   * card already has the service's Mongolian name as its own heading directly
   * above, and repeating it made the name ambiguous rather than clearer — a
   * reader seeing "Байгууллагын мэдээлэл" twice has to check whether they are
   * two things. The path is the part that is not already on the screen.
   */
  endpoint: { method: string; path: string } | undefined;
  /** `null` when the call succeeded and simply carried no rows. */
  errorCode: string | null;
  variant: "FAILED" | "EMPTY";
}) {
  const failed = variant === "FAILED";

  return (
    <Card pad="compact" tone={failed ? "peach" : undefined}>
      <div className="flex items-start gap-3">
        {failed ? (
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger" aria-hidden />
        ) : null}
        <div className="min-w-0">
          <p className="text-body font-semibold text-ink">
            {failed ? "ESIS-ээс хариу ирсэнгүй" : "ESIS бичлэг буцаасангүй"}
          </p>

          {/*
            ★ `break-all`, because a path is one unbroken token and a phone is
            360 pixels wide. Without it the line pushes the card's own width out
            and hands the horizontal scroll back to the page — the exact thing
            `TableShell` was changed to stop doing.
          */}
          {/*
            ★ Omitted rather than guessed when the payload did not carry it.
            An invented path is worse than none: it is the value somebody will
            quote to БМТТ.
          */}
          {endpoint ? (
            <p className="mt-1 break-all font-mono text-caption text-muted">
              {endpoint.method} {endpoint.path}
            </p>
          ) : null}

          <p className="mt-2 text-caption text-muted">
            {failed
              ? (ESIS_ERROR_LABEL[errorCode ?? "UNKNOWN"] ?? errorCode)
              : "Хүсэлт амжилттай боловч энэ сервис хоосон жагсаалт буцаалаа."}
          </p>
        </div>
      </div>
    </Card>
  );
}
