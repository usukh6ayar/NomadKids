import { Module } from "@nestjs/common";
import { FeedbackInboxController, OwnFeedbackController } from "./feedback.controller";
import { FeedbackRepository } from "./feedback.repository";
import { FeedbackService } from "./feedback.service";

@Module({
  controllers: [OwnFeedbackController, FeedbackInboxController],
  providers: [FeedbackService, FeedbackRepository],
})
export class FeedbackModule {}
