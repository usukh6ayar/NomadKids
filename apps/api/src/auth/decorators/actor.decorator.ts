import { createParamDecorator, ExecutionContext, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import type { Actor } from "../../authz/actor";

/**
 * Injects the authenticated Actor into a handler.
 *
 * Throws rather than returning undefined when absent: reaching a handler
 * without an Actor means the global AuthGuard was bypassed, which is a bug
 * worth failing loudly instead of a `null` that flows into an authorization
 * check and quietly returns false.
 */
export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => {
  const request = ctx.switchToHttp().getRequest<Request & { actor?: Actor }>();
  if (!request.actor) throw new UnauthorizedException();
  return request.actor;
});

/** The Actor if present, otherwise null — for endpoints that work either way. */
export const OptionalActor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Actor | null => {
    const request = ctx.switchToHttp().getRequest<Request & { actor?: Actor }>();
    return request.actor ?? null;
  },
);
