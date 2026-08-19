import { Global, Module } from "@nestjs/common";
import { AuditRepository } from "./audit.repository";

/**
 * Global: nearly every module writes audit entries, and threading an import
 * through all of them would be noise.
 */
@Global()
@Module({
  providers: [AuditRepository],
  exports: [AuditRepository],
})
export class AuditModule {}
