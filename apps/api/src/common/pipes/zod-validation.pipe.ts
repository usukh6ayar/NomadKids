import { BadRequestException, PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";

/**
 * Validates a request body, query or param against a Zod schema.
 *
 * Nest's built-in ValidationPipe is class-validator based, which would mean two
 * validation systems in one codebase: decorated DTO classes on the server and
 * Zod schemas in packages/contracts for the web app. They would drift, and the
 * drift would show up as a form that accepts input the API rejects. One system,
 * defined once, shared by both sides.
 *
 * Usage, once feature controllers exist:
 *
 *   @Post()
 *   create(@Body(new ZodValidationPipe(createChildSchema)) body: CreateChild) { … }
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);

    if (result.success) {
      return result.data;
    }

    // Grouped by field so the web app can attach messages to inputs. Values are
    // never echoed back — a rejected password must not reappear in a response.
    const errors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.length > 0 ? issue.path.join(".") : "_";
      (errors[key] ??= []).push(issue.message);
    }

    throw new BadRequestException({ message: Object.values(errors).flat(), errors });
  }
}
