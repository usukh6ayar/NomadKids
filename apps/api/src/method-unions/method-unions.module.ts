import { Module } from "@nestjs/common";
import {
  KindergartenMethodUnionsController,
  MethodUnionMembersController,
  MethodUnionsController,
} from "./method-unions.controller";
import { MethodUnionsRepository } from "./method-unions.repository";
import { MethodUnionsService } from "./method-unions.service";

@Module({
  controllers: [
    KindergartenMethodUnionsController,
    MethodUnionsController,
    MethodUnionMembersController,
  ],
  providers: [MethodUnionsService, MethodUnionsRepository],
})
export class MethodUnionsModule {}
