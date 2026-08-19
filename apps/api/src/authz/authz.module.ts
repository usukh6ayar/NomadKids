import { Global, Module } from "@nestjs/common";
import { AuthzRepository } from "./authz.repository";
import { ChildAccessService } from "./child-access.service";
import { TenantAccessService } from "./tenant-access.service";

/**
 * Global, because every module that touches child or kindergarten data needs
 * these services, and threading the import through all of them would be noise
 * around the one thing that must never be skipped.
 */
@Global()
@Module({
  providers: [AuthzRepository, ChildAccessService, TenantAccessService],
  exports: [AuthzRepository, ChildAccessService, TenantAccessService],
})
export class AuthzModule {}
