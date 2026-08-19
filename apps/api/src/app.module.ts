import { Module } from "@nestjs/common";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { AssessmentModule } from "./assessment/assessment.module";
import { AuthzModule } from "./authz/authz.module";
import { ChildrenModule } from "./children/children.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { HealthModule } from "./health/health.module";
import { MaintenanceModule } from "./maintenance/maintenance.module";
import { MailModule } from "./mail/mail.module";
import { MediaModule } from "./media/media.module";
import { ObservationsModule } from "./observations/observations.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { PortfolioModule } from "./portfolio/portfolio.module";
import { ReportsModule } from "./reports/reports.module";
import { StorageModule } from "./storage/storage.module";
import { RateLimitModule } from "./common/rate-limit/rate-limit.module";
import { PrismaModule } from "./prisma/prisma.module";
import { TenantsModule } from "./tenants/tenants.module";
import { UsersModule } from "./users/users.module";

/**
 * Feature modules are registered here as they land — see
 * docs/ARCHITECTURE.md §4.3.
 *
 * PrismaModule, AuditModule and AuthzModule are @Global: every feature needs
 * them, and importing them into a dozen modules would obscure the one import
 * that actually varies.
 */
@Module({
  imports: [
    PrismaModule,
    AuditModule,
    RateLimitModule,
    MailModule,
    AuthzModule,
    AuthModule,
    HealthModule,
    MaintenanceModule,
    TenantsModule,
    UsersModule,
    ChildrenModule,
    PortfolioModule,
    ObservationsModule,
    StorageModule,
    MediaModule,
    AssessmentModule,
    NotificationsModule,
    DashboardModule,
    ReportsModule,
  ],
})
export class AppModule {}
