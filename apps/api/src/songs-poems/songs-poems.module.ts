import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module";
import {
  ChildSongsPoemsController,
  GroupSongsPoemsController,
  SongPoemObjectsController,
} from "./songs-poems.controller";
import { SongsPoemsRepository } from "./songs-poems.repository";
import { SongsPoemsService } from "./songs-poems.service";

@Module({
  imports: [StorageModule],
  controllers: [GroupSongsPoemsController, ChildSongsPoemsController, SongPoemObjectsController],
  providers: [SongsPoemsService, SongsPoemsRepository],
})
export class SongsPoemsModule {}
