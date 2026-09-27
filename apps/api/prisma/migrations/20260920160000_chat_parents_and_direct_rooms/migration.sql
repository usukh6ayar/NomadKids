-- Two more kinds of chat room, at the client's request on 2026-09-20:
-- PARENTS ("багшгүй дан эцэг эхийн чат") and DIRECT ("эцэг эх багш руу
-- хувиараа бичих").
--
-- Additive only. No existing row changes kind, no column is added or dropped:
-- a DIRECT room's two participants live in its `roomKey`, which is already a
-- text column wide enough for `direct:<uuid>:<uuid>`.
ALTER TYPE "ChatRoomKind" ADD VALUE 'PARENTS';
ALTER TYPE "ChatRoomKind" ADD VALUE 'DIRECT';
