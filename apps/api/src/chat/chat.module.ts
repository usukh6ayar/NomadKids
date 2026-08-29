import { Module } from "@nestjs/common";
import { ChatController } from "./chat.controller";
import { ChatRepository } from "./chat.repository";
import { ChatService } from "./chat.service";

/**
 * Chat — RFP Phase IV, in scope from 2026-08-29 (CLAUDE.md §7).
 *
 * `ChatAccessService` is not provided here: it lives in `AuthzModule`, which is
 * `@Global`, so every module that touches child or room data gets it without
 * threading an import through — the one thing that must never be skipped is the
 * one thing not left to an import list.
 */
@Module({
  controllers: [ChatController],
  providers: [ChatService, ChatRepository],
  exports: [ChatService],
})
export class ChatModule {}
