# NomadKids (Бяцхан нүүдэлчид) — Redesign Brief

A kindergarten child-development digital portfolio system used by Mongolian
kindergartens. Next.js + NestJS + Prisma + PostgreSQL. This document describes
**how the system works** and, in depth, **what a teacher can do**, so that a
designer can propose a new visual and interaction design without inventing
features or breaking constraints that are load-bearing.

Companion file: **`docs/REDESIGN_PROMPTS.md`** — image-generation prompts built
from this brief, for producing mockups of the six screens that carry the
product.

## How to read this document

- Prose is in English. **Every user-facing string is quoted verbatim in
  Mongolian.** All UI text in this product is Mongolian and must stay Mongolian
  — use the exact strings quoted here rather than re-translating them. Code,
  identifiers and route names stay English.
- Screens are described by **job first**, then data, then actions. A redesign
  may change layout freely; it may not change which job a screen does.
- Section 8 lists constraints that must survive the redesign. They are not
  stylistic preferences — each one exists because breaking it caused a real
  failure.

---

## 1. What the product is

A kindergarten records what a child does day to day, assesses their development
each term, and shows the family a portfolio built from that record. Around that
core sit the daily registers (attendance, meals), communication (a class board,
surveys, chat), and the kindergarten's own administration and finance.

The design principle the product was built on, and which should survive:
**one screen = one primary job.**

- No landing pages whose only job is to link elsewhere — navigation already does
  that.
- No dashboard that is a wall of statistics. A dashboard answers *what needs my
  attention today*, or it is not built.
- No screen that exists because a database table exists.

### 1.1 The people who use it

| Role | Mongolian label | What they are |
| --- | --- | --- |
| `TEACHER` | Багш | Teaches one group. The primary audience of this document. |
| `ADMIN` | Админ / Захирал | Runs one kindergarten. Very often *also* a teacher. |
| `PARENT` | Эцэг эх | A guardian of one or more children. |
| `COOK` | Тогооч | The kitchen and the weekly menu. |
| `ACCOUNTANT` | Нягтлан | That kindergarten's own funding, invoices and reconciliation. |
| Platform operator | Платформын удирдлага | Superadmin across every kindergarten. Not a member of any one of them. |

A person can hold more than one role. When the shell has to name one role, it
ranks them: ADMIN → TEACHER → ACCOUNTANT → COOK → PARENT.

### 1.2 One application, not several

There is **one route tree and one shell**. Navigation is derived from the
signed-in person's roles; the handful of screens two audiences share render the
view appropriate to the viewer.

This is not an implementation detail a redesign can trade away:

- A director whose own child attends the kindergarten must get one product, not
  two they sign out of to switch between.
- A link a teacher pastes to a parent (`/children/{id}/general`) must open the
  same URL for both, showing each what they may see. Prefixed parent routes
  (`/my/children/…`) would give one child two URLs and break the link for one of
  them.

**A design proposal that splits this into separate teacher / parent apps is
unusable.**

Data separation is done on the server, not in the browser. A parent's
`/children/:id/observations` response simply does not contain the teacher's
private notes. The difference between the two views is layout and affordances,
never client-side hiding.

---

## 2. The shell (application chrome)

### 2.1 Desktop, from the `lg` breakpoint up

- **Left sidebar, 244px, persistent.** Brand block at the top (logo mark in a
  tinted rounded square, product name "Бяцхан нүүдэлчид", and a second line
  naming which part of the product you are in — "Багшийн хэсэг", "Захирлын
  хэсэг", "Гал тогооны хэсэг", "Санхүүгийн хэсэг", "Эцэг эхийн хэсэг",
  "Платформын удирдлага").
- Below the brand: one top-level link, then **collapsible sections**
  (`<details>`, open by default). The list between the brand and the footer is
  the only part that scrolls; a soft fade at its bottom edge signals more rows
  below.
- **Sidebar footer** — avatar initials, the person's full name (a link to
  `/settings`), and under it their *context*: a teacher with exactly one group
  sees the group's name; everyone else sees their role. A 44px "Гарах" button
  beside it.
- **Sticky desktop header** above the content: the teacher's group as a chip
  (only when they have exactly one group), a notification bell with an unread
  count, and a 40px avatar linking to `/settings`. The header bar is full-bleed;
  its contents align to the same 1400px column as the page below.

### 2.2 Phone, below `lg`

- **Mobile header** — brand mark, product name, the part-of-product line, and
  the notification bell. Nothing else.
- **Fixed bottom tab bar, five tabs**, `min-h-[60px]`, safe-area padded. The
  active tab is marked three ways at once: a tinted rounded well behind the
  icon, blue label text, and a heavier label weight — plus `aria-current`.
- The last tab (**"Цэс"**) does not navigate. It opens a right-side drawer that
  renders **the same sections the desktop sidebar shows** — one menu, two
  frames, so they cannot drift apart.

### 2.3 Everywhere

- A **floating chat button** (`ChatWidget`) sits over every authenticated
  screen, with its own unread badge. It opens a panel in place.
- Content column: `max-width: 1400px`, centred, and it **does not stretch past
  it**. Side padding 16px on a phone, 32px from `lg`, 40px at `2xl`.
- Notification bell panel: five most recent notices, an "Эдгээрийг уншсан
  болгох" action when any of the visible rows is unread, and "Бүх мэдээг харах"
  at the foot.

---

## 3. Teacher navigation, verbatim

### 3.1 Phone bottom bar — five tabs

| Label | Destination |
| --- | --- |
| **Самбар** | `/dashboard` |
| **Мэдээ** | `/notifications` (carries the unread badge) |
| **Явцын үнэлгээ** | the teacher's group assessment sheet |
| **Судалгаа** | `/surveys` |
| **Цэс** | opens the drawer |

"Явцын үнэлгээ" is two words and **wraps to two lines** in a tab. That is why
the bar is 60px tall, not 56.

The assessment tab resolves its destination rather than asking "which group?":

- teacher with one group → `/groups/{groupId}/assessment`
- admin (sees every group, so there is no single sheet) → `/admin/groups`
- teacher with no group → `/children`

No branch is a dead link and none opens a screen whose first act is a question.

### 3.2 Sidebar sections — exact labels

**Хүүхдийн хөгжил ба үнэлгээ**
- Хүүхдүүд → `/children`
- Явцын үнэлгээ → group assessment
- Ажиглалт хянах → `/observations/review`
- Чөлөөний хүсэлт хянах → `/attendance-requests/review`

**Өдөр тутмын бүртгэл**
- Ирц → group attendance
- Хоол ба цэс → group meals

**Харилцаа холбоо**
- Ангийн самбар / Мэдээ → `/notifications`
- Судалгаа → `/surveys`
- Чат → `/chat`

**Санхүү** *(administrators only — a teacher has no financial access at all)*
- Ирц ба тооцоолол → `/admin/funding`
- Ирцийн дэлгэрэнгүй → `/attendance/journal`

**Санхүү ба баримт бичиг**
- Баримт бичгийн сан → `/documents`

**Багш ба байгууллага**
- Багшийн мэдээлэл → `/settings`
- *(administrators only, six more rows)* Цэцэрлэгийн мэдээлэл · Хэрэглэгч ба
  эрх · Хичээлийн жил · Улирал · Үнэлгээний тохиргоо · Аудит

Two rules the menu follows:

1. **Every entry goes somewhere.** There are no greyed-out "удахгүй"
   placeholders. A teacher who opens the menu daily and reads six things they
   cannot do learns that most of the product is broken.
2. **A teacher never sees an administrator's row.** They are dropped entirely,
   not disabled — the server answers 404 on those routes, so a visible row would
   promise something that account will never get.

---

## 4. What a teacher can do — screen by screen

### 4.1 `/dashboard` — "Ангийн самбар"

*Job: know the state of my class this morning.*

Header: title **"Ангийн самбар"**, lede = the group name and today's date
(`Дэлбээ бүлэг · 2026.09.03`). A teacher covering more than one group, or an
admin, gets the active term instead.

The same URL renders **"Удирдлагын самбар"** with lede "Цэцэрлэгийн өнөөдрийн
байдал." for an administrator who does not teach. An admin who *also* teaches
gets the class board — they have a register to take this morning.

Cards, in order:

1. Two side by side from 375px up (they pair on a phone, deliberately):
   **today's attendance** (a dial over a figure such as "30 / 35") and the
   **gender ratio** ring.
2. **The week's attendance**, full width — the only card that needs a horizontal
   axis.
3. Two side by side: **this month's birthdays** and a **survey summary**.
4. **The latest class-board post**, full width; stacked on a phone, text beside
   its photograph from `lg`.
5. **Today's menu** — which is also the only place in the product that shows the
   **allergy cross-check** against today's dishes. It must not be removed.

Loading and error states share the same header so nothing shifts when the query
resolves. Error state offers "Дахин оролдох".

Empty state matters: on a quiet day this screen should say so plainly rather
than show four zeros.

### 4.2 `/children` — "Хүүхдүүд"

*Job: find a child.*

Lede: **"Хариуцсан бүлгийн хүүхдүүд."**

- Search field: placeholder "Нэр эсвэл овгоор хайх", debounced, live. (The
  header's own search field submits into this screen rather than filtering in
  place.)
- Filters: **Бүлэг**, **Хүйс**, **Хамгийн бага нас**, **Хамгийн их нас**.
- Sort (**Эрэмбэ**): "Нэр (А–Я)", "Нэр (Я–А)", "Нас (багаас их)", "Нас (ихээс
  бага)", "Төрсөн огноо (эртнээс)", "Сүүлд шинэчлэгдсэн".
- A small summary strip of counts above the list.
- Card rows: photo, name, group, age. Paginated. Single column on a phone — this
  is the screen a teacher opens while standing up.
- Header actions: an Excel export link, **"/children/import"** (Excel import),
  and the primary **"Хүүхэд бүртгэх"**.
- Empty states: "Хайлтад тохирох хүүхэд олдсонгүй" / "Хүүхэд бүртгэгдээгүй
  байна", each with a next step.

A parent reaching the same route sees their own children with the lede "Таны
бүртгэлтэй хүүхдүүд." and the empty state "Хүүхэд холбогдоогүй байна".

### 4.3 `/children/{id}/general` — the child record

*Job: understand and work on this child.*

An identity header (photo, name, group, age, status badges such as
"Архивласан"), then **four tabs**:

| Tab | Contents |
| --- | --- |
| **Ерөнхий** | Identity, guardians and contacts, enrolment |
| **Өсөлт** | Height/weight measurements and charts |
| **Эрүүл мэнд** | Health notes, allergies, medication, vaccination |
| **Аюулгүй байдал** | Safety incidents |

Header actions: **"Ажиглалт"** (record an observation — a parent viewing their
own child sees "Хуваалцах" instead), the portfolio, and an overflow menu
("Бусад үйлдэл") carrying **"Улирлын тайлан"** (hint: "Улирлын үнэлгээ, багшийн
дүгнэлт.") and **"Мэдээлэл засах"** (hint: "Нэр, төрсөн огноо, бүлгийн
бүртгэл.").

Other routes hanging off a child, reachable from the record: `observations`,
`assessments`, `attendance`, `menu`, `surveys`, `term-report`, `portfolio`,
`overview` (the photo album), `enrollment-archive`, `finance` (staff/guardian,
never a teacher's concern) and `edit`.

There is deliberately **no separate enrolment screen and no guardianship
screen** — both are edited inside the child.

**One designed state a redesign must account for:** a guardian who has not paid
the portal access fee does not get the record at all — they get an access gate
in its place, headed **"Хандалтын төлбөр"**, explaining "Хүүхдийнхээ хөгжлийн
бүртгэл, зураг, тайланг үзэхийн тулд … хандалтын төлбөрөө төлнө үү.", showing
the amount, and offering **"QPay-ээр төлөх"** with the note "Төлбөр төлсний
дараа хандалт шууд нээгдэнэ. Асуудал гарвал цэцэрлэгийн захиргаанд хандана уу."
The same gate applies to the child's surveys and portfolio. It never appears for
staff, and never for a stranger — see constraints 17–18.

### 4.4 `/children/{id}/observations/new` — "Шинэ ажиглалт"

*Job: record one observation.* **This is the screen a teacher spends the most
time in.**

A full page, never a modal — teachers write several paragraphs here. Fields, in
the order and under the headings they appear:

Top block
- **Ажиглалтын төрөл** (required) — the observation type, which is
  administrator-configurable data, not a fixed list
- **Огноо** (required)
- **Үйл ажиллагааны нэр**

**"Юу болсон бэ?"**
- **Нөхцөл байдал** — placeholder "Хаана, хэзээ, ямар нөхцөлд болсон бэ?"
- **Хүүхэд юу хийсэн бэ?**
- **Хүүхэд юу хэлсэн бэ?**

**"Багшийн дүгнэлт"** *(staff only — a parent's version of this form does not
have it)*
- **Тайлбар**
- **Дараагийн алхам**

**"Хэн харах вэ?"** *(staff only)*
- Checkbox **"Эцэг эх харах боломжтой"** — description: "Тэмдэглэхгүй бол
  зөвхөн багш нар харна."
- Checkbox **"Цахим хувийн хавтасны PDF-д оруулах"**

Photos: optional, "Хүсвэл зураг хавсаргана уу."

Save button reads "Хадгалах" / "Хадгалж байна…".

**The form autosaves a draft.** Losing a written observation to a tapped Back
button is the worst failure this screen can have, and any redesign must keep
that guarantee.

A parent opening the same route gets a deliberately smaller form titled **"Гэрийн
мөч хуваалцах"** — date, what happened, an optional photo. It goes to the
teacher's review queue.

### 4.5 `/observations/review` — "Эцэг эхийн ажиглалт — хянах"

*Job: process what families submitted.*

One submission at a time, not a table. Approve — **"Батлаад эцэг эхэд харуулах"**
— or return it with a **"Буцаах шалтгаан"** note. Toasts: "Ажиглалт
баталгаажлаа." / "Ажиглалт буцаагдлаа."

Empty state: "Хянах зүйл алга" — "Эцэг эхээс шинэ ажиглалт ирвэл энд харагдана."

### 4.6 `/groups/{groupId}/assessment` — "Явцын үнэлгээ"

*Job: assess a group.* **The densest screen in the product and the one that must
feel fastest.**

Header lede is the group's name. Two selectors above the grid:

- **Улирал** — which term
- **Хөгжлийн чиглэл**, hint "Нэг удаад нэг чиглэлээр үнэлнэ." — one development
  domain at a time, which is how the work is actually done: pick "Хэл яриа",
  go down the roster, then move on.

Both live in the URL query string, so a sheet can be linked and reloaded.

Then a **roster column**: one row per child, a level picker per row, an optional
comment. Progress is shown as a count of children assessed out of the roster
plus a breakdown by level. Levels are **kindergarten-configurable data, not
code**. The system ships four defaults — **Дэмжлэгтэй** ("Багшийн тогтмол
дэмжлэгтэйгээр гүйцэтгэнэ"), **Хөгжиж буй** ("Хэсэгчлэн бие даан гүйцэтгэж
байна"), **Хүрсэн** ("Насны онцлогт тохирсон түвшинд хүрсэн"), **Давсан**
("Насны онцлогоос давсан чадвар үзүүлж байна") — but a kindergarten may rename
them and may have three or six. The design must not hard-code a number of levels
or their names; the colour ramp is derived from a level's position in the list.

The five default development domains, each carrying its own colour: **Бие
бялдрын хөгжил**, **Нийгэмшихүй, сэтгэл хөдлөл**, **Хэл яриа, харилцаа**,
**Танин мэдэхүй**, **Урлаг, гоо зүйн хүмүүжил**. The five default observation
types: **Өдөр тутмын ажиглалт**, **Үйл ажиллагааны ажиглалт**, **Онцлох ахиц**,
**Анхаарал шаардсан**, **Гэр бүлээс ирсэн**. All are editable rows, not enums.

Choices are held as a draft and **bulk-saved**: "Хадгалах" / "Хадгалж байна…",
then a toast naming what happened — "N хүүхдийн үнэлгээ хадгалагдлаа." Switching
domain clears the pending draft, so a choice made under "Хэл яриа" can never be
saved against "Танин мэдэхүй".

A "Шинэ тэмдэглэл" strip lets a teacher record an observation for a child
without leaving the sheet. It defaults to nobody rather than to the first child.

An administrator, who has every group, gets **group chips along the top** to
switch in place. A teacher with one group gets no switcher — the product gives
them one group and a switcher would invent a choice that does not exist.

Empty states: "Улирал тохируулаагүй байна", "Бүлэгт хүүхэд алга" — "Энэ
хичээлийн жилд идэвхтэй бүртгэлтэй хүүхэд байхгүй байна."

### 4.7 `/groups/{groupId}/attendance` — "Ирц"

*Job: take today's register.*

- A **Огноо** field at the top; the group's name is the lede.
- One row per child under the heading "Бүлгийн ирц", with **six statuses**:
  "Ирсэн" · "Хагас өдөр" · "Чөлөөтэй" · "Өвчтэй" · "Тасалсан" · "Бусад".
  All six must be offerable — a control that renders and then fails on save is
  worse than one never offered, because the teacher blames themselves.
- Toast on save: "Ирц бүртгэгдлээ."
- Below the register, **"Эцэг эхийн мэдэгдэл"** — the queue of parent-submitted
  absence notices and leave requests, rendered *inside* this screen. Approving
  one writes the very attendance rows this sheet is about, so it belongs here
  rather than on a separate page a teacher would have to remember to check
  before marking an absence by hand. (It also has its own route,
  `/attendance-requests/review`, titled "Ирцийн мэдэгдэл — хянах", lede "Эцэг
  эхийн ирцийн мэдэгдэл, чөлөөний хүсэлтийг хянаж, ирцэд бүртгэнэ.")

### 4.8 `/groups/{groupId}/meals` — "Хоолны бүртгэл"

*Job: record who ate what.*

- **Огноо** field; the group's name as lede.
- Four sittings, each its own section: **Өглөөний цай** (short: Өглөө),
  **Үдийн хоол** (Үд), **Үдээс хойших цай** (Үдээс хойш), **Нэмэлт хоол**
  (Нэмэлт).
- Per child, per sitting, a status: **Авсан** · **Аваагүй** · **Хэсэгчлэн** ·
  **Тусгай хоол**.
- An optional note per row, max 500 characters — "Тэмдэглэл 500 тэмдэгтээс
  хэтрэхгүй." Hint: "Жишээ: гэрээсээ хоолтой ирсэн, харшлын улмаас тусгай хоол."
  The note control is disabled until a status is chosen ("Эхлээд хоолны төлөвийг
  сонгоно уу.").
- Unsaved work locks date switching — "Эхлээд хадгална уу." — because a
  register is too much work to lose to a mistaken tap. A "Болих" in the save bar
  is the one-press way out.

### 4.9 `/notifications` — "Ангийн самбар / Мэдээ"

*Job: read and post to the class board.*

A feed with unread state. Unread rows are marked three ways — a brand tint on
the row, a heavier title, and an `sr-only` "Уншаагүй" — because a 8px dot alone
is not enough.

Composing (`/notifications/new`, "Шинэ мэдэгдэл", lede "Ангийн самбарт зар
нийтлэх."):
- **Гарчиг (заавал биш)**
- **Мэдээний төрөл** — a chip row (e.g. "Зарлал"), the same vocabulary the feed
  filters by
- **Дэлгэрэнгүй** (required) — placeholder "Огноо, цаг, юу авчрахыг бичнэ үү."
- Photo attachments, each removable
- Toggle **"Чухал"** — "Жагсаалтын дээд талд, тэмдэглэгээтэй харагдана."
- Publish: "Нийтлэх" → "Зураг илгээж байна…" → "Нийтэлж байна…"

### 4.10 `/surveys` — "Судалгаа"

*Job: ask families a question and read the answers.*

Lede "Гэр бүлээс санал асуулга авах."

- Search ("Судалгаа хайх"), a type chip row, and a status tab pair:
  **Идэвхтэй** (draft + published) / **Дууссан** (closed).
- Statuses are named "Ноорог", "Нийтэлсэн", "Хаасан".
- Scope: **"Хүүхэд тус бүрээр"** or **"Цэцэрлэгээр нэг удаа"**.
- Creating one ("Шинэ судалгаа"): **Гарчиг** (required), **Хэнд зориулагдсан**,
  **Хаагдах огноо**, then "Үргэлжлүүлэх" into the question editor.
- `/surveys/{id}` shows the survey and its analytics.
- Empty states: "Судалгаа алга" — "Эхний судалгаагаа үүсгэж эхэлнэ үү."

### 4.11 `/chat` — "Чат"

*Job: talk to the group's teachers and parents.*

Lede: "Бүлгийнхээ багш, эцэг эхтэй шууд харилцах."

At `lg` the room list and the open conversation sit side by side; below that it
is a single pane. The same implementation also renders inside the floating
widget, so there is one chat in two frames.

**There is no AI in it.** It is a group message board, stated three times by the
client. A redesign must not introduce an assistant, suggested replies, or
summarisation.

### 4.12 `/documents` — "Баримт бичгийн сан"

*Job: find the curriculum, methodology and internal rules.*

Lede "Хөтөлбөр, арга зүй, дотоод журам." Search, category filter, and a
bookmarked-only filter. Staff only — it never appears for parents. Empty states:
"Олдсонгүй" / "Баримт нэмээгүй байна".

### 4.13 `/children/{id}/portfolio` — "Цахим хувийн хавтас"

*Job: manage the child's portfolio.* Three tiles under "Цахим хавтасны хэсгүүд":

- **Миний тухай** — identity, birth facts and birthday notes, favourites
- **Хөгжил** — itself three tabs under "Хөгжлийн хэсгүүд":
  - **Насны онцлог** (first, open by default) — ages 2–5 and milestones.
    "Хөгжлийн түүх" lists the age cards, each reading "Тэмдэглэлтэй" or
    "Хоосон". A comparison view sits behind it, titled "Хөгжлийн харьцуулалт",
    with "Өндөр - Жингийн ахиц" and "Дуртай зүйлс".
  - **Ажиглалт** — a launcher into the child's observations, not a second copy
    of the list
  - **Бүтээл** — the child's artwork
- **Зургийн цомог** — the photo album (`/children/{id}/overview`), which also
  carries the photo-consent control

Editing is inline, one section at a time. **Not a wizard.**

This is the emotional centre of the product for a family and deserves the most
design care. Download-as-PDF lives here.

### 4.14 `/children/{id}/term-report` — "Улирлын тайлан"

*Job: read (and, for staff, write) the term's narrative report.*

Sections per development domain with the term's level and the teacher's
narrative. Empty states: "Улирал бүртгэгдээгүй байна", "Тайлан хараахан бэлэн
болоогүй", "Тайлан хоосон байна".

**PDF generation is a background job, not a request.** It takes ~2.5 seconds and
runs on a queue. The UI must show progress and then offer a download — a button
that blocks for three seconds is not an acceptable design.

### 4.15 `/settings` — "Багшийн мэдээлэл"

Own profile and password.

### 4.16 Things a teacher explicitly **cannot** do

- See financial information of any kind. Every funding, invoice and payment
  route is administrator/accountant only, and the client stated the rule
  directly: "Багш санхүүгийн бүрэн мэдээллийг харах эрхгүй байна."
- Reach another group's children, another kindergarten's children, or a child
  they are not assigned. The server answers **404**, not 403.
- Create school years, terms, users, groups, or edit assessment configuration.

---

## 5. Other roles, briefly

*Named for context. This document does not spec them.*

**Administrator (Захирал)** — everything a teacher has, plus "Удирдлагын самбар"
(kindergarten-wide figures), and seven administration screens: Цэцэрлэгийн
мэдээлэл · Хэрэглэгч ба эрх ("Багш, админ, эцэг эхийн бүртгэл.") · Хичээлийн
жил · Улирал · Үнэлгээний тохиргоо ("Хөгжлийн чиглэл, үнэлгээний түвшин,
ажиглалтын төрөл.") · Аудит ("Хэн, хэзээ, юу хийсэн. Зөвхөн уншина — түүхийг
засах боломжгүй.") · Бүлгүүд. Plus finance: "Ирц ба тооцоолол" and "Ирцийн
дэлгэрэнгүй".

**Parent (Эцэг эх)** — a mobile-first shell with a bottom bar. `/home` is a
single reverse-chronological feed of what happened recently, not a dashboard. A
parent of more than one child gets a child switcher in the sidebar. They read
the portfolio, read observations marked visible to them, submit their own
"Гэрийн мөч", answer surveys, notify absences, and chat.

**Cook (Тогооч)** — "Гал тогооны хэсэг": Долоо хоногийн цэс · Орц, түүхий эд ·
Технологийн карт · Нийлүүлэгч · Хүнсний захиалга · Нөөц · Тайлан. No access to
the dashboard or to children.

**Accountant (Нягтлан)** — "Санхүүгийн хэсэг": Санхүүжилт ("Сарын тооцоо, тариф.
Ирц болон хоолны бүртгэлээс автоматаар бодогдоно."), Эцэг эхийн нэхэмжлэл,
Санхүүгийн үйлдлийн түүх.

**Platform operator** — "Платформын удирдлага": registers kindergartens, reviews
applications, and sees system-wide totals and the operator's own revenue.

---

## 6. Repeating patterns worth designing once

Three screens are **the same shape three times**: Ирц, Хоол ба цэс and Явцын
үнэлгээ. All three are a group-scoped register — a date or term selector, a
roster, a per-child choice, and a bulk save. All three link straight to the
group for a teacher with one group and show a picker otherwise. **A redesign
should keep them one pattern**, not three designs that drift.

Two more, each used everywhere:

- **List → filters → cards → pagination**, with an empty state that says what to
  do next.
- **Detail → tabs → inline section editing**, with the primary actions in the
  header and the rest behind an overflow menu ("Бусад үйлдэл").

---

## 7. Vocabulary reference

| Mongolian | Meaning |
| --- | --- |
| Цэцэрлэг | kindergarten |
| Бүлэг | group / class |
| Хүүхэд, Хүүхдүүд | child, children |
| Багш | teacher |
| Эцэг эх | parent / guardian |
| Ажиглалт | observation |
| Явцын үнэлгээ | progress assessment |
| Хөгжлийн чиглэл | development domain |
| Улирал | term |
| Хичээлийн жил | school year |
| Ирц | attendance |
| Хоол ба цэс | meals and menu |
| Цахим хувийн хавтас | the child's digital portfolio |
| Ангийн самбар | the class board |
| Судалгаа | survey |
| Мэдэгдэл | notification |
| Баримт бичиг | document |
| Санхүүжилт | funding |
| Нэхэмжлэл | invoice |

---

## 8. Constraints the redesign must not break

These are not preferences. Each one has a failure behind it.

**Language and typography**

1. **All user-facing text is Mongolian.** Use the exact strings in this
   document; do not re-translate them.
2. **Mongolian compounds are long and wrap at almost every width.** Real
   examples that must be laid out, not truncated: "Чөлөөний хүсэлт хянах",
   "Хүүхдийн хөгжил ба үнэлгээ", "Явцын үнэлгээ" (which wraps to two lines in a
   five-tab bottom bar at 375px), "Ангийн самбар / Мэдээ". Never assume a label
   fits on one line.
3. A form field's height must keep a focused input at 16px, or iOS zooms the
   page on focus.

**Structure**

4. **One route tree, one shell, role-derived navigation.** No separate apps.
5. **A teacher has exactly one group and gets no group switcher.** Administrators
   get group chips on the registers to switch in place.
6. Ирц, Хоол ба цэс and Явцын үнэлгээ stay one pattern (§6).
7. Assessment cannot start without a group. Any entry point must resolve the
   group rather than open a screen whose first act is "which group?".
8. Every menu entry goes somewhere. No greyed-out "coming soon" rows.
9. Content column caps at 1400px and does not stretch past it.

**Mobile**

10. **Mobile-first.** It works on a phone before it works anywhere else. The
    teacher's shell is desktop-*first* in emphasis but must remain fully usable
    on a phone; the parent's is phone-first outright.
11. Tap targets are at least 44px. The bottom bar clears the iOS home indicator
    and page content clears the bottom bar (`pb-24` on mobile), or the last row
    of every list is untappable.

**Behaviour**

12. **Confirm before delete. Toast after save. Loading state over ~300ms** —
    skeletons on lists, not spinners.
13. **Observations autosave a draft.** Losing typed text is the worst failure
    that screen can have.
14. A register with unsaved changes locks the date selector and offers a
    one-press cancel.
15. **Empty states say what to do next**, not just that something is empty.
16. PDF generation is a queued background job with progress, never a blocking
    button.

**Access and privacy**

17. **404, never 403, for child data.** An unauthorised child, observation,
    photo or report returns 404 — a 403 confirms the record exists. The
    not-found page must look **identical** whether the record is absent or
    forbidden; the visual design carries the same guarantee as the status code.
18. One exception: an unpaid guardian's portal-access fee answers **402**, and
    only after authorisation has already passed. A stranger still gets 404.
19. Photos are never served by direct URL. They go through a check and then a
    short-lived signed link.

**Configuration is data, not code**

20. Development domains, assessment levels and observation types are
    **administrator-editable tables**. The design must not hard-code their
    names, their number, or their colours. A kindergarten may have three levels
    or six.

**Accessibility**

21. Every field has a real `<label>` — a placeholder is not a label. Every image
    has an `alt`. State is never carried by colour alone: the active nav item,
    an unread notice and an assessment level each carry at least three signals
    (tint, weight, and text or `aria-current`).
22. Two navigation landmarks must not share a name — the sidebar is "Үндсэн цэс"
    and the bottom bar is "Доод цэс".

**Product**

23. **There is no AI anywhere in this product**, chat included. It is a group
    message board, not an assistant. Do not propose suggestion, summarisation or
    autocomplete features.
