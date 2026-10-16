import { Module } from "@nestjs/common";
import {
  ChildA79ProgressController,
  GroupA79SummaryController,
  ObservationA79LinksController,
} from "./a79.controller";
import { A79Repository } from "./a79.repository";
import { A79Service } from "./a79.service";

@Module({
  controllers: [
    ObservationA79LinksController,
    ChildA79ProgressController,
    GroupA79SummaryController,
  ],
  providers: [A79Service, A79Repository],
})
export class A79Module {}
