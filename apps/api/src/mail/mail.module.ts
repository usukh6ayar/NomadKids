import { Global, Module } from "@nestjs/common";
import { MailService } from "./mail.service";

/**
 * Global: the auth service sends the only message the MVP has, and the health
 * endpoint probes the transport. Importing this in two places would be noise.
 */
@Global()
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
