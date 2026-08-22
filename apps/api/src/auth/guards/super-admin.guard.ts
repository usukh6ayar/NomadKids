import { CanActivate, ExecutionContext, Injectable, NotFoundException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { Actor } from "../../authz/actor";
import { REQUIRE_SUPER_ADMIN } from "../decorators/super-admin.decorator";

/**
 * Enforces `@SuperAdmin()`.
 *
 * Returns **404** for the same reason `RolesGuard` does: one rule everywhere,
 * and the difference between 403 and 404 is exactly what an attacker probes
 * for. docs/SECURITY.md §5.4.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(REQUIRE_SUPER_ADMIN, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest<Request & { actor?: Actor }>();
    if (!request.actor?.isSuperAdmin) throw new NotFoundException();

    return true;
  }
}
