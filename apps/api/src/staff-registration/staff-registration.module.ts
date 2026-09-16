import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { StaffRegistrationController } from "./staff-registration.controller";
import { StaffRegistrationRepository } from "./staff-registration.repository";
import { StaffRegistrationService } from "./staff-registration.service";

/**
 * Staff self-registration against the stored ESIS roster.
 *
 * ★ Its own module rather than a corner of `EsisModule` (CLAUDE.md's plan
 * suggested the latter). The code this issues never calls ESIS, and Task 5's
 * public `POST /v1/staff-registration` — which does read `EsisStaffRoster` —
 * belongs here too when it lands, not in the ESIS integration boundary: that
 * route is about an identity claim during registration, which happens to be
 * checked against an ESIS-derived table, the same way `EsisRepository` is a
 * dependency of this module rather than the other way around.
 *
 * `AuthModule` is imported for `PasswordService` — reused rather than a second
 * hashing path. `AuthzModule` (`TenantAccessService`) and `AuditModule`
 * (`AuditRepository`) are both `@Global()` and need no import.
 */
@Module({
  imports: [AuthModule],
  controllers: [StaffRegistrationController],
  providers: [StaffRegistrationService, StaffRegistrationRepository],
})
export class StaffRegistrationModule {}
