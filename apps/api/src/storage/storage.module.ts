import { Global, Module } from "@nestjs/common";
import { StorageService } from "./storage.service";

/**
 * Global: media, reports and the maintenance sweep all need it, and the S3
 * client holds a connection pool worth sharing.
 */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
