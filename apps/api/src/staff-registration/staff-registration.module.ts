import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { EsisModule } from "../integrations/esis/esis.module";
import { UsersModule } from "../users/users.module";
import {
  StaffRegistrationController,
  StaffRegistrationPublicController,
} from "./staff-registration.controller";
import { StaffRegistrationRepository } from "./staff-registration.repository";
import { StaffRegistrationService } from "./staff-registration.service";

/**
 * Staff self-registration against the stored ESIS roster.
 *
 * ★ Its own module rather than a corner of `EsisModule` (CLAUDE.md's plan
 * suggested the latter). The code this issues never calls ESIS, and Task 5's
 * public `POST /v1/staff-registration` reads `EsisStaffRoster` through
 * `EsisRepository` rather than owning it — the table is filled by
 * `EsisAdminService.refreshStaffRoster`, and this module only ever reads it.
 * That route is about an identity claim during registration, which happens to
 * be checked against an ESIS-derived table, the same way this module depends
 * on `EsisModule` rather than the other way around.
 *
 * `AuthModule` is imported for `PasswordService` — reused rather than a second
 * hashing path. `UsersModule` supplies `UsersService.createSelfRegisteredAccount`
 * and `UsersRepository`, the same account-creation machinery every invitation
 * uses. `EsisModule` supplies `EsisRepository`'s roster lookup. `AuthzModule`
 * (`TenantAccessService`) and `AuditModule` (`AuditRepository`) are both
 * `@Global()` and need no import.
 */
@Module({
  imports: [AuthModule, EsisModule, UsersModule],
  controllers: [StaffRegistrationController, StaffRegistrationPublicController],
  providers: [StaffRegistrationService, StaffRegistrationRepository],
})
export class StaffRegistrationModule {}
