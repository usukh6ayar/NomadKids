import { Module } from "@nestjs/common";
import { AuthzModule } from "../authz/authz.module";
import { PrismaModule } from "../prisma/prisma.module";
import { GroupReportsController } from "./group-reports.controller";
import { GroupReportsRepository } from "./group-reports.repository";
import { GroupReportsService } from "./group-reports.service";

@Module({
  imports: [PrismaModule, AuthzModule],
  controllers: [GroupReportsController],
  providers: [GroupReportsService, GroupReportsRepository],
})
export class GroupReportsModule {}
