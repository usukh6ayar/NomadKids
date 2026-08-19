import { CanActivate, ExecutionContext, Injectable, NotFoundException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { Actor } from "../../authz/actor";
import type { Role } from "../../domain/enums";
import { REQUIRED_ROLES } from "../decorators/roles.decorator";

/**
 * Enforces `@Roles(...)`.
 *
 * ★ Returns **404**, not 403.
 *
 * The instinct is that a role gate should be 403 — the actor is authenticated,
 * they simply lack the role, and nothing is being hidden about whether an admin
 * section exists. That reasoning is defensible in isolation and it is not what
 * this system does, for two reasons:
 *
 *  1. **The reference implementation is uniformly 404**, including for wrong
 *     role on an admin screen (`test_a_teacher_cannot_reach_the_admin_screens`
 *     asserts 404, not 403). Those tests are the acceptance criteria, and D2
 *     settled that authorization semantics do not change during the stack
 *     migration.
 *
 *  2. **One rule is safer than two.** The moment 403 and 404 both appear,
 *     every new endpoint is a judgement call about which applies — and the
 *     difference between them is exactly the signal an attacker probes for. A
 *     single answer everywhere cannot be got wrong endpoint by endpoint.
 *
 * docs/SECURITY.md §5.4 · CLAUDE.md §1.7.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request & { actor?: Actor }>();
    const actor = request.actor;
    if (!actor) throw new NotFoundException();

    const held = new Set(actor.memberships.map((m) => m.role));
    if (!required.some((role) => held.has(role))) throw new NotFoundException();

    return true;
  }
}
