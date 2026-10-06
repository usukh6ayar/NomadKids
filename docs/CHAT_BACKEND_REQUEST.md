# Chat — backend request (2026-10-04)

> **Done 2026-10-06**, both items. §1–4: `childScopeFor` in
> `authz/chat-access.ts` narrows a private room's children to the reader's
> groups. §5: `loadDirectPeers` no longer pairs guardians; an old key answers
> 404. The lead-teacher rule from #176 also gained a fallback: a group with no
> active lead pairs its families with whoever teaches it. Tests in
> `apps/api/test/chat.test.ts`, «private rooms name a parent by their child».

Two items. Neither needs a frontend change.

| §   | What                                                                  | Kind             |
| --- | --------------------------------------------------------------------- | ---------------- |
| 1–4 | A direct room labels a guardian with children the reader may not know | Bug (disclosure) |
| 5   | Remove guardian ↔ guardian direct rooms                               | Client change    |

**§1–4, the bug.** In a private (`DIRECT`) chat room, a guardian's messages are
labelled with **every** child they have in the kindergarten. They should show
only the children the reader is entitled to know about. A teacher therefore
sees the name of a child from a group they do not teach.

The web app prints whatever `author.children` the API sends
(`apps/web/components/chat/chat-widget.tsx`, `MessageBubble`).

---

## 1. What happens

A family has two children in the same kindergarten:

| Child   | Group  | Teacher   |
| ------- | ------ | --------- |
| Батбаяр | Дэлбээ | Teacher A |
| Сараа   | Нарс   | Teacher B |

1. Teacher A opens their room list. The private room with this parent is
   named **"Б.Батбаярын ээж"** (since #175). That is correct:
   `AuthzRepository.loadDirectPeers` filters by the teacher's own groups.
2. The parent writes in that room.
3. Teacher A sees the message labelled **"Батбаяр, Сараа — эцэг эх"**, and the
   avatar may be Сараа's.

Teacher A does not teach Сараа and should not learn her name from chat.
`/media/:id` already refuses her photo (`canAccessChild` → 404), so the
avatar falls back to initials. That fallback hides the image but not the
fact that the photo exists.

The same applies between two parents in a direct room (added 2026-09-30).
Parent B sees the names of parent A's children in groups B has nothing to
do with. A parent never gets a photo id (`isStaff` is false), so for them
only the names leak.

## 2. Cause

`apps/api/src/chat/chat.service.ts` → `authorChildren()` (around line 261)
calls:

```ts
this.repo.guardianChildren(authorIds, {
  kindergartenId: room.kindergartenId,
  groupId: room.groupId,
});
```

`apps/api/src/chat/chat.repository.ts` → `guardianChildren()` (around line 50)
only narrows by group when `groupId` is set:

```ts
...(scope.groupId ? { groupId: scope.groupId } : {}),
```

A `DIRECT` room has `groupId: null` by design (`schema.prisma`,
`ChatRoomKind.DIRECT`). The query therefore falls back to "any active
enrolment in the kindergarten". `GROUP` and `PARENTS` rooms are unaffected,
because they carry their `groupId`.

## 3. Requested fix

For a `DIRECT` room, narrow the children to the groups the **reader** shares
with the author. These are the same groups `loadDirectPeers` already uses to
name the room:

| Reader   | Children shown on a guardian's message                                          |
| -------- | ------------------------------------------------------------------------------- |
| Teacher  | Only those enrolled in a group the teacher teaches (`teachingGroups`)           |
| Guardian | Only those enrolled in one of the reader's children's groups (`guardianGroups`) |

A sketch:

- `guardianChildren(authorIds, { kindergartenId, groupIds: string[] | null })`:
  `null` keeps today's behaviour for `STAFF`; an array becomes
  `groupId: { in: groupIds }`. An empty array must return no rows, not
  every row.
- In `authorChildren`, `GROUP` and `PARENTS` rooms pass `[room.groupId]`.
  `DIRECT` passes the reader's `teachingGroups` ∪ `guardianGroups` ids from
  `loadChatAccessFacts(actor)`, the set `ChatAccessService` already loads
  for `assertMember`.

The decision stays in `authz/` (CLAUDE.md §1.1). Only the query belongs in
the repository.

## 4. Tests

Through HTTP against `GET /chat/rooms/:roomKey/messages`, in
`apps/api/test/chat.test.ts` (CLAUDE.md §4.1):

```ts
test("a teacher sees only their own pupil on a parent's direct message");
// Family with Батбаяр (teacher A's group) and Сараа (teacher B's group).
// Parent posts in direct:<A>:<parent>. Teacher A reads it.
// author.children has exactly one entry, Батбаяр — no Сараа, no photo id for her.

test("a parent sees only shared-group children on another parent's direct message");

test("a group room is unchanged"); // still that group's children only
```

---

## 5. Remove guardian ↔ guardian direct rooms

**Client, 2026-10-04:** "эцэг эхэд багш эцэг эхчүүд гэсэн бас багшгүй эцэг
эхчүүд гэсэн хэсэг байна, дангаар эцэг эхтэй хоорондоо харилцахгүй". A
parent has the group room (with the teacher) and the parents' room (without
the teacher), and writes privately **to their child's teacher only**. This
reverses the 2026-09-30 addition.

What to change:

- `apps/api/src/authz/authz.repository.ts` → `loadDirectPeers()`: drop
  `fellowGuardians` (`guardiansIn(guardianGroupIds)`) and its loop. A
  guardian's peers are then only `teachersOfMyChildren`, and a teacher's are
  still `guardiansOfMyPupils`.
- `resolveRoom` derives from the same facts, so an existing
  `direct:<guardian>:<guardian>` key starts answering **404** with no further
  change. Its messages stay in the table (§3.2), unreachable. Say if the
  client wants them shown read-only instead.
- If `CLAUDE.md` §7 or `docs/SECURITY.md` describes parent-to-parent chat, update
  them in the same change.

Tests, through HTTP (§4.1):

```ts
test("a guardian has no direct room with another guardian"); // GET /chat/rooms
test("an old guardian-to-guardian room key answers 404"); // GET …/messages, POST …/messages
test("a guardian still has a direct room with their child's teacher");
```

The frontend shows whatever `GET /chat/rooms` returns, so the rooms disappear
from the parent's list as soon as this ships.
