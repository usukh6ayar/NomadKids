import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import type { Problem } from "@kinder/contracts";

/**
 * Turns every error into an RFC 7807 problem+json document.
 *
 * The important behaviour is what it does NOT send: an unexpected exception
 * becomes a generic 500 with a request id, and the message and stack stay in
 * the server log. Leaking a Prisma error to the browser discloses table and
 * column names; leaking a stack discloses paths. docs/SECURITY.md §11.
 */
@Catch()
export class ProblemExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const requestId = (request.headers["x-request-id"] as string | undefined) ?? randomUUID();

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const problem: Problem = {
      type: "about:blank",
      title: titleFor(status),
      status,
      requestId,
    };

    if (exception instanceof HttpException) {
      const body = exception.getResponse();

      // A deliberately thrown HttpException carries a message written for the
      // user, in Mongolian — "Хэт олон удаа буруу оролдлоо", "CSRF шалгалт
      // амжилтгүй боллоо". Dropping it would leave every error reading as a
      // generic title and make the product feel broken rather than informative.
      //
      // Only *thrown* messages reach this branch. An unexpected exception falls
      // through to the else and sends nothing, so a Prisma error still cannot
      // leak table names.
      if (typeof body === "string") {
        problem.detail = body;
      } else if (typeof body === "object" && body !== null && "message" in body) {
        const message = (body as { message: unknown }).message;
        if (Array.isArray(message)) {
          problem.errors = { _: message.map(String) };
          problem.detail = message.map(String).join(". ");
        } else if (
          typeof message === "string" &&
          message !== problem.title &&
          !isNestDefaultMessage(message, status)
        ) {
          problem.detail = message;
        }
        /*
         * ★ A machine-readable reason, forwarded only when the thrown body
         * names one as a string. Nothing else about the document changes, so
         * every error body that existed before this stays byte-identical —
         * `code` appears exactly on the throws that ask for it.
         *
         * ★★ And only when it *looks* like one of ours. `HttpException`
         * accepts an arbitrary object and `createBody` keeps it verbatim, so
         * `new BadRequestException(caughtPrismaError)` — a shape nobody has
         * written yet and everybody is one hurried catch block away from —
         * would put `code: "P2002"` in a browser, which is a database detail
         * this filter exists to keep out. `CODE_SHAPE` rejects it, and rejects
         * it specifically **because Prisma's codes carry digits**: that is the
         * whole discriminator, so the pattern must stay digit-free to work.
         * A future code that genuinely needs a digit is a deliberate widening
         * of this line, not an accident — every code thrown today
         * (`SCOPE_DENIED`, `TIMEOUT`, `NETWORK`) passes unchanged.
         */
        const code = "code" in body ? (body as { code: unknown }).code : undefined;
        if (typeof code === "string" && CODE_SHAPE.test(code)) {
          problem.code = code;
        }
        if ("errors" in body) {
          const errors = (body as { errors: unknown }).errors;
          if (errors && typeof errors === "object") {
            problem.errors = errors as Record<string, string[]>;
          }
        }
      }
    } else {
      // Unexpected. Log everything, send nothing.
      this.logger.error(
        `Unhandled exception [${requestId}] ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).type("application/problem+json").json(problem);
  }
}

/**
 * What a `code` this API wrote looks like: SCREAMING_SNAKE, nothing else.
 * Digit-free on purpose — see the note at the forwarding site.
 */
const CODE_SHAPE = /^[A-Z_]{3,40}$/;

/**
 * User-facing, so Mongolian. Note that 404 says only "not found" — it must read
 * identically whether the record is absent or the actor may not see it.
 * CLAUDE.md §1.7.
 */
/**
 * Nest's own English reason phrase for a status, which is **not** a message
 * anybody wrote.
 *
 * ★ `new NotFoundException()` with no argument produces
 * `{ statusCode: 404, message: "Not Found" }`. The branch above forwards that
 * into `detail`, `apps/web/lib/api/errors.ts` prefers `detail` over its own
 * Mongolian status map, and a director looking for a deleted school year read
 * **"Not Found"** — in a product whose every other sentence is Mongolian.
 * Found on 2026-09-20 by asking the running API: `detail":"Unauthorized"`.
 *
 * The `message !== problem.title` guard above did not catch it, and could not:
 * it compares against the Mongolian title, and "Not Found" differs from
 * «Олдсонгүй» exactly as a real thrown message would.
 *
 * ★★ Matched against this list rather than translated. A translation here
 * would be a second status→sentence map competing with `titleFor` below and
 * with the web's `STATUS_MESSAGES`; dropping the detail instead lets the one
 * that already exists answer, which is what both were written to do.
 *
 * ★★★ Status-scoped on purpose. A service that deliberately throws
 * `new ConflictException("Not Found")` — absurd, but expressible — keeps its
 * message, because only the phrase Nest itself would have generated for
 * *this* status is discarded.
 */
const NEST_DEFAULT_MESSAGE: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: "Bad Request",
  [HttpStatus.UNAUTHORIZED]: "Unauthorized",
  [HttpStatus.PAYMENT_REQUIRED]: "Payment Required",
  [HttpStatus.FORBIDDEN]: "Forbidden",
  [HttpStatus.NOT_FOUND]: "Not Found",
  [HttpStatus.CONFLICT]: "Conflict",
  [HttpStatus.PAYLOAD_TOO_LARGE]: "Payload Too Large",
  [HttpStatus.UNPROCESSABLE_ENTITY]: "Unprocessable Entity",
  [HttpStatus.TOO_MANY_REQUESTS]: "Too Many Requests",
  [HttpStatus.INTERNAL_SERVER_ERROR]: "Internal Server Error",
  [HttpStatus.SERVICE_UNAVAILABLE]: "Service Unavailable",
};

function isNestDefaultMessage(message: string, status: number): boolean {
  return NEST_DEFAULT_MESSAGE[status] === message;
}

function titleFor(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return "Мэдээлэл буруу байна";
    case HttpStatus.UNAUTHORIZED:
      return "Нэвтрэх шаардлагатай";
    case HttpStatus.FORBIDDEN:
      return "Хандах эрхгүй";
    case HttpStatus.NOT_FOUND:
      return "Олдсонгүй";
    case HttpStatus.CONFLICT:
      return "Зөрчил үүслээ";
    case HttpStatus.PAYLOAD_TOO_LARGE:
      return "Файл хэт том байна";
    case HttpStatus.TOO_MANY_REQUESTS:
      return "Хэт олон хүсэлт илгээлээ";
    /*
      ★ Added 2026-09-06 with `StorageService.put`'s 503.

      "Алдаа гарлаа" is the right title for a 500 — something broke and nobody
      knows what. A 503 is a different statement: the request was fine and the
      thing it needs is temporarily away, so trying again is the correct next
      move. Without a case here the two read identically, which is most of what
      made an object-store outage look like a bug in the upload form.
    */
    case HttpStatus.SERVICE_UNAVAILABLE:
      return "Түр ашиглах боломжгүй байна";
    /*
      ★ Added 2026-09-19 with the ESIS institution lookup's 502, and for the
      same argument as the 503 above. Without a case here an upstream
      non-answer reads "Алдаа гарлаа" — identical to a 500, which says
      something broke here and nobody knows what. A 502 says the request was
      fine and the other system did not answer, so retrying is the correct
      next move.

      ★★ Deliberately not the same sentence as the thrown `detail` («ESIS
      хариу өгсөнгүй.»): a message equal to the title is dropped by the branch
      above, and the operator would lose the more specific half.

      ★★★ **This is not only the institution lookup's status.** A `case` here
      is retroactive: every 502 this API has ever answered gets the new title,
      and there are eleven existing throws —
      `attendance.service.ts` (lines 78, 834, 956, 959, 961, 1022, 1025, 1027)
      and `esis-admin.service.ts` (1398, 1401, 1403). `ApiError.message` on the
      web side is `problem.title` (`apps/web/lib/api/client.ts`), so their
      message changes with it, from "Алдаа гарлаа" to this.

      That is the intent — all eleven are "ESIS did not answer", which is
      exactly what the new title says, and all eleven supply a `detail` that
      the web layer prefers anyway. But it is a wider change than the one case
      that prompted it, and the next reader should not have to grep to discover
      that. Verified against `test/attendance-register.test.ts` and
      `test/esis-admin.test.ts` on 2026-09-19: nothing asserts the old title.
    */
    case HttpStatus.BAD_GATEWAY:
      return "Гадаад системээс хариу ирсэнгүй";
    default:
      return "Алдаа гарлаа";
  }
}
