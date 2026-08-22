import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthController } from "./auth.controller";
import { AuthRepository } from "./auth.repository";
import { AuthService } from "./auth.service";
import { PasswordService } from "./password.service";
import { TokenService } from "./token.service";
import { AuthGuard } from "./guards/auth.guard";
import { CsrfGuard } from "./guards/csrf.guard";
import { RolesGuard } from "./guards/roles.guard";
import { SuperAdminGuard } from "./guards/super-admin.guard";

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRepository,
    PasswordService,
    TokenService,

    // Guard order matters and is the order they are registered in:
    //
    //   1. AuthGuard  — attaches the Actor, or 401.
    //   2. CsrfGuard  — needs the request to be authenticated before it can
    //                   compare the CSRF cookie against the header.
    //   3. RolesGuard — needs the Actor to read its memberships.
    //   4. SuperAdminGuard — same, for the platform routes.
    //
    // Registered globally so a new controller is protected by default. Opting
    // out takes an explicit @Public(), which means a forgotten decorator locks
    // an endpoint rather than exposing one.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: SuperAdminGuard },
  ],
  exports: [AuthService, AuthRepository, TokenService, PasswordService],
})
export class AuthModule {}
