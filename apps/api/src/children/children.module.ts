import { Module } from "@nestjs/common";
import { ChildrenController } from "./children.controller";
import { ChildrenRepository } from "./children.repository";
import { ChildrenService } from "./children.service";

@Module({
  controllers: [ChildrenController],
  providers: [ChildrenService, ChildrenRepository],
  exports: [ChildrenService, ChildrenRepository],
})
export class ChildrenModule {}
