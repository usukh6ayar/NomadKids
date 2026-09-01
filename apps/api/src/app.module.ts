import { Module } from "@nestjs/common";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { AssessmentModule } from "./assessment/assessment.module";
import { AttendanceModule } from "./attendance/attendance.module";
import { GrowthModule } from "./growth/growth.module";
import { HealthRecordsModule } from "./health-records/health-records.module";
import { IncidentsModule } from "./incidents/incidents.module";
import { KitchenModule } from "./kitchen/kitchen.module";
import { ArtworkModule } from "./artwork/artwork.module";
import { DocumentsModule } from "./documents/documents.module";
import { ConsentModule } from "./consent/consent.module";
import { FundingModule } from "./funding/funding.module";
import { InvoicesModule } from "./invoices/invoices.module";
import { EsisModule } from "./integrations/esis/esis.module";
import { QpayModule } from "./integrations/qpay/qpay.module";
import { MilestonesModule } from "./milestones/milestones.module";
import { AuthzModule } from "./authz/authz.module";
import { CatalogModule } from "./catalog/catalog.module";
import { ChildrenModule } from "./children/children.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { HealthModule } from "./health/health.module";
import { MaintenanceModule } from "./maintenance/maintenance.module";
import { MailModule } from "./mail/mail.module";
import { MealsModule } from "./meals/meals.module";
import { MediaModule } from "./media/media.module";
import { ObservationsModule } from "./observations/observations.module";
import { ChatModule } from "./chat/chat.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { PlatformModule } from "./platform/platform.module";
import { PortfolioModule } from "./portfolio/portfolio.module";
import { ReportsModule } from "./reports/reports.module";
import { StorageModule } from "./storage/storage.module";
import { SurveysModule } from "./surveys/surveys.module";
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
    PlatformModule,
    UsersModule,
    ChildrenModule,
    PortfolioModule,
    ObservationsModule,
    StorageModule,
    MediaModule,
    AssessmentModule,
    AttendanceModule,
    GrowthModule,
    MilestonesModule,
    HealthRecordsModule,
    IncidentsModule,
    ArtworkModule,
    DocumentsModule,
    ConsentModule,
    FundingModule,
    InvoicesModule,
    EsisModule,
    QpayModule,
    KitchenModule,
    MealsModule,
    CatalogModule,
    ChatModule,
    NotificationsModule,
    DashboardModule,
    ReportsModule,
    SurveysModule,
  ],
})
export class AppModule {}
