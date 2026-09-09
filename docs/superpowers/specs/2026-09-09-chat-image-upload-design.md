# Chat — зураг оруулах

**Date:** 2026-09-09
**Status:** approved by the client in conversation, 2026-09-09
**Touches:** `apps/api/prisma/`, `apps/api/src/chat/`, `apps/api/src/media/`,
`apps/api/src/authz/`, `packages/contracts/`, the chat widget

---

## 1. Scope

A message may carry **up to four images**. Nothing else.

★ **Video was asked for and then withdrawn** — "бичлэг ороохыг болиулъя. зураг
оруулдаг байхад болно" (client, 2026-09-09). Recording it because the reasons
were real and will be real again if it is asked for a second time: `MediaFile`'s
whole pipeline is `sharp`, which is what strips EXIF (§1.6) and what a video
cannot go through. Video would need a format policy, a poster frame, a much
larger ceiling, and disk the VPS has 33 GB of. None of that is built, and none
of it is built halfway here either.

★★ Images are **small** — the client's other instruction, "зураг нь гэхдээ бага
хэмжээтэй". §4.

---

## 2. The security boundary this feature is built around

A chat image is **not** a tenant image, and putting it in
`TENANT_IMAGE_PURPOSES` would be a real leak rather than a style mistake.

That set — `KINDERGARTEN_LOGO`, `USER_PHOTO`, `GROUP_PHOTO`, `MENU_DISH` — is
readable by anyone holding a membership in the file's kindergarten, and its
own comment says "adding a purpose here widens who may read it". A chat photo
belongs to **one room**. A guardian whose child is in group A holds a perfectly
good membership in the kindergarten and must not read a photograph posted in
group B's room.

So `CHAT_MESSAGE` gets its own branch in `MediaService.getDownloadUrl`:

```
GET /media/:id → purpose === CHAT_MESSAGE
               → read the owning message's roomKey
               → ChatAccessService.assertMember(actor, roomKey)   ← throws 404
               → 302 to a 5-minute presigned URL
```

The same authority that decides whether the message may be read decides whether
its photograph may be — one answer, one place (§1.1), and 404 rather than 403
(§1.7).

---

## 3. One request, not two

`POST /chat/rooms/:roomKey/messages` accepts **multipart**: the body text and
the files together.

★ The obvious alternative — upload first, then send a message naming the
`mediaFileId` — is how `MENU_DISH` works, and it is wrong here. It creates a
window in which a stored file exists with no room to authorize it against, so
either the upload route needs a second authorization path of its own or the
file is briefly readable on weaker terms than the message it will belong to. A
single request removes the window instead of guarding it: `assertMember` runs
once, and nothing is written until it has.

★★ The route keeps working for JSON. `FilesInterceptor` skips a request that is
not multipart, so every existing caller — the current web composer, and
`chat.test.ts` — is untouched.

**Write order,** deliberately storage-then-database:

1. `assertMember` — before a byte is read
2. validate and re-encode every file (§4)
3. put each object into the private bucket
4. one transaction: `ChatMessage`, then its `MediaFile` rows

A failure after (3) leaves objects in the bucket that no row points at.
`storageKey` is a random UUID, so they are unreachable — harmless. The reverse
order fails the other way: rows pointing at objects that were never written,
which is a broken image in a parent's chat forever.

---

## 4. "Бага хэмжээтэй"

`validateImageUpload` gains an options argument. Every existing caller passes
nothing and behaves exactly as before; chat passes its own numbers.

|                | Album (unchanged) | Chat        |
| -------------- | ----------------- | ----------- |
| Max accepted   | 10 MB             | **5 MB**    |
| Longest edge   | 2000px            | **1280px**  |
| JPEG quality   | 88                | **78**      |
| Typical result | ~800 KB           | **~200 KB** |

Everything else is identical and non-negotiable: the MIME type comes from the
file's **content**, and the re-encode through sharp is the EXIF strip. A
classroom photograph otherwise carries the kindergarten's GPS coordinates —
which matters more in a chat a parent can forward than in an album they cannot.

Four files × 5 MB is the multer ceiling, so a single request can hold 20 MB of
input; the stored result is under a megabyte.

---

## 5. Schema

One nullable column and one relation:

```prisma
model MediaFile {
  chatMessageId String?      @db.Uuid
  chatMessage   ChatMessage? @relation("ChatMessageMedia", fields: [chatMessageId], references: [id], onDelete: Cascade)
  @@index([chatMessageId, order])
}

model ChatMessage {
  media MediaFile[] @relation("ChatMessageMedia")
}
```

`order` already exists on `MediaFile` and carries the position, so four images
come back in the order they were attached rather than in whatever order the
database returns. `kindergartenId` is set from the room (§3.1).

`MediaPurpose.CHAT_MESSAGE` joins the enum.

---

## 6. Contracts

- `sendChatMessageSchema.body` becomes optional — a message may be a photograph
  with nothing typed. A message with **neither** text nor an image is refused;
  that check lives in the service, because only it knows how many files
  arrived.
- `chatMessageSchema.media: { id, width, height }[]`, defaulting to `[]`. The
  dimensions are what let the bubble reserve the right space before the image
  loads, so a room does not jump as photographs arrive.

Both are additive: an existing client sending `{ body }` and reading a message
without `media` keeps working.

---

## 7. Web

- The composer gains an attach button and local previews (object URLs) with a
  remove control. Files are held in state and sent as `FormData` on submit;
  when there are none, the existing JSON path is used unchanged.
- A bubble renders one image full-width (capped), and two to four as a
  two-column grid. `mediaUrl(id)` already exists.
- Every image gets an `alt` (§5). It is the sender's name and the time, not
  "зураг" — a screen-reader user is told whose photograph it is, which is the
  only thing about it that can be known without seeing it.

---

## 8. Tests

Authorization, through HTTP against the real route (§4.1) — the mandatory
three, on the **image**, not only on the message:

- a teacher from another group gets 404 on `/media/:id` for a chat image
- a guardian of another child gets 404
- a user from another kindergarten gets 404
- a member of the room gets a 302

And the upload itself:

- a non-image, renamed `.jpg`, is refused
- a 4000px photograph is stored at 1280px
- EXIF is gone from the stored bytes
- five files are refused; four are accepted
- a message with no text and no image is refused
- a message with an image and no text is accepted

---

## 9. Not in this spec

- Video, per §1.
- Deleting an image from a sent message. `deletedAt` on the message already
  hides its media; removing one photograph from a message that keeps its text
  is a different feature nobody has asked for.
- Any AI over the images. CLAUDE.md §7 records the client saying three times
  that there is none in chat, and an image classifier would be one.
