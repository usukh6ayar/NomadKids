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
        } else if (typeof message === "string" && message !== problem.title) {
          problem.detail = message;
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
 * User-facing, so Mongolian. Note that 404 says only "not found" — it must read
 * identically whether the record is absent or the actor may not see it.
 * CLAUDE.md §1.7.
 */
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
    default:
      return "Алдаа гарлаа";
  }
}
