# NomadKids — UI/UX audit

> **Status, 2026-08-24.** Fixed and covered by regression tests:
>
> | Finding | Where | Tests |
> |---|---|---|
> | 0.1 header search discarded `?q=` | `children/page.tsx` | `test/search.test.tsx` |
> | 0.2 17 landmarks with dangling `aria-labelledby` | `ui/card.tsx` + 8 sites | `test/landmarks.test.tsx` |
> | 0.3 `<h1>` lighter than its section headings | `app-shell.tsx`, `dashboard` | `test/page-header.test.tsx` |
> | 0.4 identity rendered twice on staff desktop | `app-shell.tsx` | `test/page-header.test.tsx` |
> | 0.5 child chips claimed `role="tablist"` | `home/page.tsx` | `test/landmarks.test.tsx` |
> | 1.1 portfolio opened nine empty boxes | `age-section-shell.tsx` | `test/portfolio.test.tsx` |
> | 4.1 radius tokens bypassed | 53 files | `test/tokens.test.tsx` |
> | 4.2 no type scale (20 sizes) | 53 files | `test/tokens.test.tsx` |
>
> Suite 135 passing. Each defect fix was confirmed to fail with its fix reverted.
>
> **Two bugs surfaced by the work itself**, neither in the audit:
> - The header's search `<input>` carried `text-sm`, which beats the
>   `input { font-size: 16px }` rule in `globals.css` and triggers the iOS
>   focus-zoom that rule exists to prevent. Fixed; `tokens.test.tsx` now bans a
>   font-size class on any text control.
> - Naming the scale `text-caption` … `text-display` collided with
>   tailwind-merge, which treats an unrecognised `text-*` as a **colour** and so
>   silently dropped `text-primary-ink` from every filled button. Fixed by
>   registering the steps as a `font-size` group in `lib/utils.ts`.
>
> **Open:** the judgement items in Parts 1–3 — 1.2 (login tabs), 1.3/1.4
> (duplicate dashboard tiles), 1.5 (two icon systems), 2.1 (five-button hero
> row), 2.2/2.3 (portfolio navigation and the age row's inverted signal),
> 2.5–2.7, 3.1 (five meanings of "Хавтас"), 3.2–3.4, 4.3, 4.4.

**Scope.** Teacher dashboard, child detail, portfolio, parent home, children list,
login, and the shared design system (`globals.css`, `ui/*`, `shell/*`).
No screenshot was supplied, so this is audited against the source — which is the
better evidence anyway: it shows every state, not the one that was captured.

**Ground rules I held myself to.** Every replacement string below is Mongolian
(CLAUDE.md §5). Nothing here proposes deleting a `<label>`, an `sr-only` name, or
an empty state's next-step copy — those are mandatory.

Every finding was checked against `docs/reference/Project_Info.md` (the RFP, final
authority) and against the test suite. **One finding inverted on that check** — see
1.1 — and each recommendation that moves a user-facing string names the test that
moves with it.

`responsive.test.tsx` asserts literal height classes (`h-[48px]`, `min-h-[44px]`)
and the palette hex values. It does **not** assert on radius or font-size, so §4.1
and §4.2 are unpinned. Token-ifying *heights* would break it; token-ifying radius
and type would not.

**A note on method.** This codebase argues for its own choices in prose, at
length, above almost every component. So I split the findings: **Part 0 is fact**
— places where the code contradicts a rule it states about itself, verified by
reading and grepping. **Parts 1–4 are judgement**, and where a comment already
argues the other side, I name that argument and answer it.

---

## Part 0 — Defects, not opinions

These five are verified. I'd fix them before touching anything cosmetic.

### 0.1 The header search does nothing. ★ Highest severity

`HeaderSearch` submits to `/children?q=…` (`shell/app-shell.tsx:152`). Its own
docblock says: *"lands on `/children?q=…`, where the list picks the term up from
the URL and takes over."*

It does not. `StaffChildren` initialises its term from `useState("")`
(`children/page.tsx:47`) and never reads `useSearchParams`. Grepping the file for
`q` returns exactly one hit — `params.set("q", search)`, the outbound direction.

So: a teacher types a name in the dashboard header, presses Enter, and lands on a
complete unfiltered roster with an empty search box. The control looks like it
worked. This is worse than a missing feature — it is a feature that lies, and it
is on the busiest screen in the product.

**Fix.** Seed and sync from the URL:

```ts
const searchParams = useSearchParams();
const [query, setQuery] = useState(() => searchParams.get("q") ?? "");
```

Then either drop `HeaderSearch`'s empty-submit navigation or keep it — but the
list has to be the thing that reads the parameter, exactly as the docblock claims.

### 0.2 Every `aria-labelledby` in the app points at nothing

**14 `aria-labelledby` attributes across 7 files** (a grep for the string returns
16 hits; two are the comments quoted below, not code). One of the 14 —
`portfolio/page.tsx:552` — is templated across ages 2–5, so **17 sections render
with a broken name**. Four `id=` attributes exist in the entire app, and **not one
of them matches**:

| Referenced | Actually exists |
|---|---|
| `about-me-heading` | `about-me` (the scroll anchor) |
| `gallery-heading` | `gallery` |
| `birthdays-heading` | `birthdays` |
| `development-heading`, `recent-heading`, `profile-heading`, `password-heading`, `coverage-heading`, `activity-heading`, `details-heading`, `transfer-heading`, `archive-heading`, `photos-heading`, `age-{2..5}-heading` | *nothing* |

A dangling `aria-labelledby` does not fall back to the content — it **erases** the
accessible name. Seventeen `<section>` landmarks are announced as unnamed regions.
Every one of them looks correct in the markup, which is why this survived.

The sharpest part: `dashboard/recent-observations.tsx:33` and
`needs-attention-alerts.tsx:43` both carry a comment explaining precisely why
`aria-label` is used instead — *"`SectionHeader` renders the heading and does not
take an id, so pointing at one would name this section after an element that does
not exist."* The rest of the app does the thing those comments warn against.

**Fix — one of two, applied everywhere.** Either give `SectionHeader` an
`id` prop and pass it, or convert all 16 to `aria-label`. I'd take the `id` prop:
it keeps the name and the heading as one string instead of two that drift.

```tsx
export function SectionHeader({ title, id, ... }) {
  ...
  <Tag id={id} className="...">{title}</Tag>
```

### 0.3 The page title is lighter than the section headings under it

`PageHeader`'s `<h1>` is `text-[1.5rem] leading-[1.35] tracking-[-.01em] text-ink`
(`app-shell.tsx:87`) — **no font-weight class.** Tailwind's preflight resets
heading weight to `inherit`, so it renders **24px / 400**.

`SectionHeader`'s `<h2>` is `text-[1.05rem] font-semibold` (`card.tsx:88`) —
**16.8px / 600**.

The inverted hierarchy is on screen right now: every section heading is bolder
than the page title above it. Visual weight is doing the opposite of what the
document structure says.

That the omission is an oversight rather than a choice is settled by the rest of
the app — **every other heading sets its weight explicitly**: `text-xl
font-semibold` (dashboard `:69`, home `:48`), `text-[1.35rem] font-semibold`
(login), `text-lg … font-semibold` (child hero), `text-[1.05rem] font-semibold`
(`SectionHeader`). The `PageHeader` `<h1>` is the lone exception in the codebase.

It gets worse mid-page-load. The dashboard's loading and error branches render
their own title as `text-xl font-semibold` (`dashboard/page.tsx:69` and `:78`) —
20px / 600. So when data arrives the title **grows 4px and loses 200 weight
units**, in place. Same on parent home (`home/page.tsx:48, 57, 75, 88`).

**Fix.** `text-[1.5rem] font-semibold` on the `PageHeader` `<h1>`, and make the
loading/error branches render `<PageHeader title=… />` rather than a hand-rolled
heading. That also removes three copies of the title string per page.

### 0.4 The signed-in user is rendered twice, simultaneously, with two different roles

On a teacher's desktop, both of these are visible at once:

- `WhoAmI` at the sidebar foot (`app-shell.tsx:336`) — name + **"Багшийн хэсэг"**
- The `PageHeader` identity pill (`app-shell.tsx:106`, `hidden … lg:flex`) — name
  + **"Багш"**

Same person, twice, ~200px apart, described two different ways. The pill's
docblock explains carefully why it hides below 900px — the phone header already
carries it — and never addresses the sidebar sitting beside it at exactly the
width where the pill *is* shown.

**Fix.** Delete the pill for `variant="teacher"`. Keep it for the parent shell,
which has no sidebar. That also frees the header's right side for actions, which
is where the crowding is.

### 0.5 The child chips on parent home claim to be tabs and aren't

`home/page.tsx:92-118`: `role="tablist"` with `role="tab"` + `aria-selected` on
each button. There is no `tabpanel`, no `aria-controls`, no roving tabindex, no
arrow-key handling. A screen-reader user is told "tab, 1 of 3" and then arrow
keys do nothing; a keyboard user has to Tab through every child.

It is a filter chip group, not a tab set.

**Fix.** `role="group"` + `aria-label="Хүүхэд сонгох"` on the container,
`aria-pressed` on each button — which is **exactly what `LoginTabs` already does
correctly** two files away (`auth-shell.tsx:123-146`), with a comment explaining
why. Copy that.

---

## 1. Elements to DELETE

### 1.1 Nine empty boxes and nine "Засах" buttons on a two-year-old's portfolio

> **★ Corrected against the RFP.** My first draft said *delete* the age sections
> that don't apply yet. **RFP §4.3 forbids that**: *"2, 3, 4, 5 нас тус бүрд
> тусдаа мэдээллийн хуудастай байна"* — each of ages 2–5 shall have its own
> separate information page. The four sections must exist. What follows is the
> version that survives the RFP: collapse, don't delete.

`portfolio/page.tsx:186` renders `AgeSection` for ages **2, 3, 4, 5**
unconditionally. `:731` renders a birthday `Card` for the same four ages,
unconditionally.

Open the portfolio of a newly-registered two-year-old and count what is on screen:

- 1 about-me card: *"Хараахан бөглөөгүй байна…"*
- 4 age cards, 3 of them dashed and empty: *"Энэ насны мэдээлэл хараахан бөглөөгүй байна."*
- 4 birthday cards, all empty: *"Тэмдэглэл бичээгүй байна."*
- **9 "Засах" buttons**

Nine invitations to fill in years that have not happened. The child is two; the
"5 нас" card is three years early. This is the single largest source of cognitive
load in the product — a screen that is mostly placeholders for the future teaches
people the record is unfinished rather than that it is being built.

**Fix — progressive disclosure, structure intact.** Every age keeps its section and
its anchor, satisfying §4.3. Ages the child has not reached render **collapsed**:

```tsx
<details open={age <= currentAge}>
  <summary>{age} нас — {filled ? "бөглөсөн" : "хоосон"}</summary>
  …
</details>
```

`<details>` is the right primitive here and the codebase already uses it for
`NavGroup` — it works before hydration and keeps the platform's keyboard
behaviour. Nine boxes become two open and seven one-line summaries, the anchors
still resolve, and nothing the RFP mandates is removed. Same treatment for the
birthday cards (§4.2 mandates those too).

**This gets more urgent, not less.** RFP §4.3 lists **17 fields per age**;
`AGE_FIELDS` implements 8. §4.1 lists 10 for Миний тухай; `ABOUT_FIELDS`
implements 5 plus height/weight. When the missing fields land, this page roughly
doubles. Any decluttering that only trims today's content will not survive that —
which is why the fix has to be structural.

### 1.2 Two of three login tabs

`LOGIN_TABS` (`auth-shell.tsx:105`):

```
Багш   → "Нэвтрэх нэр эсвэл и-мэйл"
Эцэг эх → "Утасны дугаар эсвэл и-мэйл"
Админ  → "Нэвтрэх нэр эсвэл и-мэйл"   ← identical to Багш
```

Багш and Админ are byte-identical. And the tab is never sent to the API — login
takes `identifier` + `password`. A user who picks the wrong one signs in fine.

So the first control every user in the system touches asks a question, ignores the
answer, and in two of three cases doesn't even change the label. That is a false
affordance in the most consequential position in the product, and a support call
waiting to happen: *"Би багш дээр дарах ёстой юу?"*

**RFP check — it does not require this.** §3.1 says *"Систем нь хэрэглэгчийн эрхэд
суурилсан нэвтрэх системтэй байна"* (a **role-based access** system) and line 800
lists *"Администратор, багш, эцэг эхийн нэвтрэх систем"* (all three roles can sign
in). Neither asks the user to declare their role at the door. The finding stands.

**Fix.** Delete the segmented control. One field:

> **Нэвтрэх нэр, утас эсвэл и-мэйл**

The counter-argument in the docblock is fidelity to the reference project. That is
a reason to match a *working* control, not to reproduce one that ignores its own
input. If the client wants the three tabs kept for familiarity, the conservative
version is to make them *differ* — distinct placeholder, distinct autocomplete,
distinct `inputMode="tel"` for Эцэг эх — so the control at least earns the tap.

**Tests.** No test asserts on `LOGIN_TABS`; `flows.test.tsx:1025` and `:151` match
"Багш"/"Эцэг эх" in unrelated fixtures and labels. Safe.

### 1.3 The "Улирлын явц" stat tile

The dashboard shows term progress twice, ~300px apart:

- `DashboardStats` tile — `47%`, `12 / 26 үнэлэгдсэн`, sky tint (`dashboard-stats.tsx:50`)
- `TermProgress` section — heading, `12 / 26 хүүхэд үнэлэгдсэн`, `47%`, and a bar
  (`dashboard/page.tsx:110`)

The code argues the tile is "the summary" and the bar "the detail". But the tile
carries *both* numbers already — it is not a summary of the section, it is the
section minus the bar.

**The code's own justification decides this.** `term-progress.tsx` says: *"only one
of the two is a `progressbar` an assistive technology can report."* Correct — and
that is an argument for deleting the tile, not for keeping it. Delete the tile;
the stat row drops to three and stops being the loudest thing on a screen whose
docblock opens with *"Not statistics."*

### 1.4 The "Хянах" stat tile

Same duplication. The tile shows `pendingReviews` with a sun tint
(`dashboard-stats.tsx:53-58`); the alert card below shows the same count, names
what it is, **and carries the button that acts on it**
(`needs-attention-alerts.tsx:127`).

A number you cannot act on, directly above the same number you can. Delete the
tile. `Хүүхэд` and `Бүлэг` are enough for the "how big is my world" row the
component describes — and two tiles side by side read better than four competing
ones.

### 1.5 One of the two hand-rolled SVG icon sets

`LogoutIcon` (`app-shell.tsx:551`) and `ChevronIcon` (`:469`) are inline SVGs with
`strokeWidth` 2 and **2.5** respectively, living in a file that imports `Bell` and
`Search` from lucide-react at the default weight. Three stroke weights, two icon
systems, one file.

**Fix.** `import { LogOut, ChevronDown } from "lucide-react"`. Delete ~35 lines.

### 1.6 The lede under "Анхаарах зүйлс"

Title: **Анхаарах зүйлс.** Lede: **Өнөөдөр таны хариу үйлдэл шаардаж буй зүйлс.**

The lede restates the title in more words. The section only renders when it has
content (good — that is the right call), so its presence is already the message.
Delete the lede.

---

## 2. Elements to FIX or REORGANIZE

### 2.1 The child hero's five-button row — the worst hierarchy problem in the app

`children/[childId]/page.tsx:119-176` puts **five** buttons in the hero for staff:

`[+ Ажиглалт] [Хавтас] [Улирлын тайлан] [Засах] [PDF]`

Four are `variant="secondary"` — identical white pills, identical size, identical
weight. At 375px they wrap to three rows, filling most of the first screen with
undifferentiated controls. Fitts's law and Hick's law both apply: five equal
targets means the primary action is found by reading, not by looking.

Two of them also overlap: **Улирлын тайлан** opens the term report and **PDF**
generates a PDF of it. From the row you cannot tell which produces the document.

**Fix.** One primary, one secondary, the rest in the overflow menu — you already
have `ui/menu.tsx` and use it on the dashboard:

```
[+ Ажиглалт]  [Хөгжлийн хавтас]  [⋯]
                                  ├ Улирлын тайлан
                                  ├ PDF татах
                                  └ Засах
```

This drops the hero from three wrapped rows to one on a phone.

### 2.2 The portfolio's double navigation

`portfolio/page.tsx:135-177` stacks two nav systems before any content: a row of
three pills (Миний тухай / Зураг, бүтээл / Төрсөн өдөр) and a 4-column grid of
64px age buttons. Seven jump links, then the same seven sections rendered in full
below. On a phone, a full screen of navigation for a page you were about to scroll
anyway.

**Fix.** Keep the age row — it is the timeline and it earns its space. Delete the
three pills: with 1.1 applied the page is short enough to scroll, and "Миний тухай"
is the first thing under them.

### 2.3 The age row has its colour and its meaning inverted

`AGE_TONE` (`portfolio/page.tsx:35-40`) gives each age its own saturated tint —
mint, sky, sun, peach. Whether the age has any content is carried by a **6px dot
at 25% opacity of the current colour**.

Gestalt similarity says a set of peers should look alike, and difference should
encode a variable. Here it is backwards: the loudest signal (four colours) encodes
the label, which the text already gives you, and the variable that actually
matters — done vs. empty — is the faintest mark on the page. Four saturated
buttons also read as four different *kinds* of thing rather than one timeline.

The `aria-label` is correct, so this is not a colour-alone failure. It is a
misallocated signal.

**Fix.** One tint for the set. Filled ages get the tint + a check; empty ages get
`bg-canvas` + border. The row then reads as progress at a glance, which is what
the docblock says it is for.

### 2.4 The stat number sits in a pill for no reason

`dashboard-stats.tsx:88` — the number is `inline-flex … rounded-[10px] px-1.5`
with a tinted background on two of four tiles. So inside one row: two plain
numbers and two numbers in coloured chips, at the same size. The chip reads as a
badge, i.e. as a status, and `47%` is not a status.

**Fix.** Tint the *text*, not a box behind it. `text-sky-ink` on the percentage
gives the same emphasis without inventing a second component.

### 2.5 The parent's home and the teacher's dashboard are built from different parts

`home/page.tsx` does not use `PageHeader` — it hand-rolls `<h1 className="text-xl
font-semibold">` in four places. So the two primary landing screens of the product
have different title typography, different spacing, and one has a search and an
action menu while the other has neither.

**Fix.** `home/page.tsx` uses `PageHeader`. That also fixes 0.3 on that screen for
free.

### 2.6 The two search fields don't match

Header search (`app-shell.tsx:176`): `h-[44px] rounded-pill`, placeholder
*"Хүүхдийн нэрээр хайх…"*. List search (`children/page.tsx:104`): the shared
`Input` (48px, `rounded-control`), placeholder *"Нэр эсвэл овгоор хайх"*.

Two shapes, two heights, two placeholders, one job — and 0.1 means using the first
one drops you next to the second one, empty. Fix 0.1, then make the header field
use `Input`.

### 2.7 The portfolio's hero is a different hero

`portfolio/page.tsx:133` renders `<ChildHeroProfile child={data} />` — no
`actions`, no `showHealthAlert`. So a teacher who navigates from the child record
to the portfolio loses the health-note badge and every action, and the page has no
way back to the record. The identity block whose whole stated purpose is *"a
teacher moving between screens never loses track of whose record is open"* changes
shape between those screens.

**Fix.** Pass `showHealthAlert={isStaff}` and at minimum a "← Хүүхдийн бүртгэл"
action.

---

## 3. Clarity & UX copywriting

### 3.1 "Хавтас" means five different things

| Where | String | Points at |
|---|---|---|
| Sidebar brand | Хүүхдийн хөгжлийн цахим хувийн хавтас | product |
| Mobile brand | Хүүхдийн хавтас | product |
| Parent nav item | Хавтас | `/children` |
| Parent list `<h1>` | Хөгжлийн хавтас | `/children` |
| Child hero button | Хавтас | `/children/:id/portfolio` |

A parent taps **Хавтас** in the bottom bar, lands on a page titled **Хөгжлийн
хавтас**, opens a child, and finds a button also called **Хавтас** that goes
somewhere else. Nielsen's consistency heuristic, four ways.

Worse, the *same component* — `ChildGallery` — is labelled **"Цомог"** as a tab
(`children/[childId]/page.tsx:196`) and **"Зураг, бүтээл"** in the portfolio
(`portfolio/page.tsx:138`).

**Fix — one noun per thing, taken from the RFP where the RFP names it:**

| Thing | String | Source |
|---|---|---|
| The product | **Хүүхдийн хөгжлийн хавтас** (full, no short variant) | RFP line 11 |
| The §4.1–4.3 document | **Хөгжлийн хавтас** | |
| `ChildGallery`, both places | **Зургийн цомог** | **RFP §4.4** |
| Parent nav → `/children` | **Миний хүүхдүүд** | |
| Hero button → portfolio | **Хөгжлийн хавтас** | |

Note the gallery: my instinct was "Зураг", but **RFP §4.4 names it "Зургийн
цомог"**, so the existing tab label "Цомог" is the closer of the two and the
portfolio's "Зураг, бүтээл" is the one to change. The RFP outranks my preference.

**Tests that move with this.** `roles.test.tsx:59` asserts
`getAllByText("Хавтас")` against the parent navigation — renaming that item
requires updating the assertion. Nothing asserts on "Цомог".

### 3.2 Labels that are verbs with no object

| Current | Problem | Suggested |
|---|---|---|
| `Хянах` (stat tile) | "Review" — review *what*? | **Хүлээгдэж буй** / detail: `Эцэг эхийн ажиглалт` |
| `Сүүлийн үйл явдал` | "Recent events" — they are observations | **Сүүлийн ажиглалтууд** |
| `Нүүр` (parent `<h1>`) | A nav label used as a page title; says nothing | **Сайн байна уу, {firstName}** |
| `Товч мэдээлэл` (aria) | "Brief information" — of what? | **Өнөөдрийн тойм** |
| `PDF` (button) | Format as a label | **PDF татах** |

**Tests that move with this.** `flows.test.tsx:1335` finds the feed by accessible
name — `findByRole("region", { name: "Сүүлийн үйл явдал" })` — so renaming that
section means updating that line. **`Хянах` is subtler:** `roles.test.tsx:42, 63,
99` assert on it as a **navigation item**, which must keep its name. Only the
dashboard *stat tile* label changes; the nav entry and `/observations/review` stay
"Хянах". Renaming both would break three assertions and, more importantly, the
nav item is a destination where the verb is correct.

### 3.3 Two empty states say what is missing instead of what to do

CLAUDE.md §5: *"Empty states say what to do next."* `about-me` gets this right —
*"Хараахан бөглөөгүй байна. «Засах» дарж эхлүүлнэ үү."* The other two do not:

| Current | Suggested |
|---|---|
| `Энэ насны мэдээлэл хараахан бөглөөгүй байна.` | **Энэ насны тэмдэглэл хоосон байна. «Засах» дарж бөглөнө үү.** |
| `Тэмдэглэл бичээгүй байна.` | **Төрсөн өдрийн тэмдэглэл бичээгүй. «Засах» дарж нэмнэ үү.** |

All three are also bare `<p className="text-sm text-muted">` rather than the
`EmptyState` component that exists for exactly this. Use it — it is the thing that
makes the rule hold by construction.

### 3.4 Inconsistent back-links

`children/[childId]/page.tsx:83` — **"Жагсаалт руу буцах"**.
`portfolio/page.tsx:117` — **"Буцах"**. Same destination, same situation. Use the
explicit one in both.

---

## 4. Design rule violations

### 4.1 The radius tokens are defined and then bypassed — the exact failure `globals.css` warns about

`globals.css:155-158` defines four radius tokens. Actual usage across `app/` and
`components/`:

```
40 × rounded-[12px]     ← --radius-control
17 × rounded-full     }
 6 × rounded-pill     } ← ONE result, THREE spellings, 27 uses
 4 × rounded-[999px]  }
15 × rounded-[14px]     ← --radius-row
 9 × rounded-[18px]     ← --radius-card
 5 × rounded-[10px]     ← not a token at all
 1 × rounded-lg, 1 × rounded-[8px], 1 × rounded-[16px]
```

The pill is the sharpest case: `rounded-full`, `rounded-pill` and
`rounded-[999px]` render identically and appear 27 times between them, so a
reader has no way to tell which spelling is intended and a search for one finds a
third of the usages.

`Card` hard-codes `rounded-[18px]` (`card.tsx:22`). `Badge` hard-codes
`rounded-[999px]` (`badge.tsx:14`). `RowCard` hard-codes `rounded-[14px]`.

`globals.css:161-168` removed `--shadow-card` for precisely this reason, in
writing: *"A token nobody reads is worse than no token — it looks like the single
source of truth while two other values are what actually ship."* That sentence
describes the radius tokens today. And `rounded-[10px]` / `[8px]` / `[16px]` are
the drift already starting.

**Fix.** `rounded-control` / `rounded-row` / `rounded-card` / `rounded-pill`
everywhere; delete the three off-scale values. A find-and-replace, plus a lint rule
banning `rounded-[` under `components/ui/`.

### 4.2 There is no type scale — 20 distinct sizes

```
108 text-sm      38 text-xs      14 text-xl      11 text-[1.05rem]
  8 text-[.78rem]  6 text-[1.35rem]  5 text-lg    5 text-[.94rem]
  4 text-[.75rem]  3 text-[11px]     2 text-base  2 text-[15px]
  2 text-[.9rem]   2 text-[.8rem]    2 text-[.87rem]  2 text-[.82rem]
  2 text-2xl       1 text-[1.5rem]   1 text-[.92rem]  1 text-[.7rem]
```

`.78rem` (12.48px), `.8rem` (12.8px), `.82rem` (13.12px) and `text-xs` (12px) are
four sizes inside a 1.1px band — differences nobody can perceive but every future
edit has to choose between. Arbitrary values are interleaved with the Tailwind
scale, so there is no way to tell which is "correct" at a call site.

Note the same file that pins `--size-control` and `--size-tap` as tokens *because
a component might quietly ship the wrong value* leaves every type size to be
guessed at the call site.

**Fix.** Six steps as `@theme` tokens, mapped from what is already there:

```css
--text-caption: 0.75rem;   /* 11px, .7rem, .75rem, text-xs        */
--text-body-sm: 0.8125rem; /* .78rem, .8rem, .82rem               */
--text-body:    0.875rem;  /* text-sm — the workhorse             */
--text-body-lg: 0.9375rem; /* .9rem, .92rem, .94rem, 15px, base   */
--text-title:   1.0625rem; /* 1.05rem, text-lg — SectionHeader    */
--text-page:    1.5rem;    /* 1.35rem, text-xl, 2xl — PageHeader  */
```

Verified unpinned: `responsive.test.tsx` asserts heights (`:66` `h-[48px]`, `:75`,
`:80` `min-h-[44px]`, `:166` `min-h-[112px]`) and palette hex values (`:178-185`),
never a radius or a font-size. §4.1 and §4.2 are additive. Note the corollary —
those height assertions match **literal class strings**, so a future refactor that
token-ifies `h-[48px]` into `h-control` *would* break the suite. Radius and type
are the safe ones to start with.

### 4.3 Contrast — one real issue, and it is not where you'd look

The palette is measured and documented, and the ratios in `globals.css` check out.
`--color-muted` at 4.76:1 on white and 4.55:1 on canvas passes AA at every size it
is used. I am **not** flagging it — listing a passing value next to real findings
costs the real findings.

The one that does fail: the age-row progress dot,
`bg-current opacity-25` at 6px (`portfolio/page.tsx:169`). Against its own tint
that is roughly 1.5:1 — invisible. It survives WCAG only because the `aria-label`
carries the state, which is the right guard, but sighted users are reading a signal
that isn't there. Fixed by 2.3.

### 4.4 Spacing rhythm is per-page rather than systemic

Root gaps across four screens: `gap-6 lg:gap-8` (dashboard), `gap-5 lg:gap-7`
(children), `gap-6 py-2` (child detail, portfolio, home). Card padding: `px-4 py-3`
(RowCard), `px-4 py-3.5` (Stat), `px-4 py-4 sm:px-5` (hero, about-me), `px-6 py-10`
(EmptyState). Every value is defensible alone; together they mean no two screens
share a rhythm, and a new screen has no default to inherit.

**Fix.** Two page gaps (`gap-6` / `lg:gap-8`) and two card paddings (compact
`px-4 py-3.5`, roomy `px-5 py-5`), applied as `Card` variants rather than as
per-call-site class strings.

---

## Priority

| # | Finding | Cost | Why first |
|---|---|---|---|
| 1 | 0.1 Header search ignores `?q=` | ~5 lines | A control that lies, on the busiest screen |
| 2 | 0.2 16 dangling `aria-labelledby` | ~20 lines | 14 unnamed landmarks; RFP §13 |
| 3 | 1.1 Collapse unreached age + birthday cards | ~30 lines | Halves the parent-facing centrepiece; RFP-safe |
| 4 | 0.3 `<h1>` weight + load-time shift | 3 lines | Inverted hierarchy on every screen |
| 5 | 2.1 Five-button hero row | ~25 lines | Biggest hierarchy failure per screen |
| 6 | 0.4 Duplicate identity | ~5 lines | Deletion, unblocks header crowding |
| 7 | 1.2 Login tabs | ~15 lines | False affordance, first control users meet |
| 8 | 3.1 "Хавтас" ×5 | copy only | Cheapest clarity win available |
| 9 | 4.1 / 4.2 Tokens + type scale | mechanical | Stops the drift the codebase predicted |

1–4 are roughly an hour and are all defects.

## What I deliberately did not flag

- **`--color-muted` contrast.** Passes AA everywhere it is used. See 4.3.
- **"Хүүхэд" / "Бүлэг" as vanity metrics.** Arguable taste; the component already
  argues its side, and I don't have a stronger case.
- **Tabs on the child page vs. a scrolling record.** The old comment's argument was
  right, but the client decided, and the implementation (`?tab=` in the URL,
  lazy panels) handles the cost about as well as it can be handled.
- **Excluded Phase 2/3 features** (attendance, lunch, radar chart). Correctly held
  out per CLAUDE.md §7. Not a UX problem.

## Outside my remit — scope gaps I noticed while reading the RFP

Not UX findings, but they change how much room the layouts need, so they belong in
the same conversation as 1.1:

| RFP | Specified | Implemented |
|---|---|---|
| §4.1 Миний тухай | 10 fields | 5 + height/weight. Missing: анхны гарын үсэг/сараачсан зураг, нэмэлт зураг, оруулсан огноо |
| §4.2 Төрсөн өдрийн мэдээлэл | Орд, Монгол жилийн амьтан, төрсөн өдрийн зураг, тэмдэглэл | the note only |
| §4.3 Нас бүрд | 17 fields | 8 + the two notes. Missing: дуртай үлгэр, кино, хувцас; сэтгэл хөдлөлийн онцлог; гэр бүлийн гишүүд; суралцах сонирхол; тухайн насны зураг |

I have not checked these against `docs/MIGRATION_PLAN.md`, so some may be
deliberate MVP trims rather than gaps. Worth confirming before sign-off, since
§4.2's Орд and жилийн амьтан are computable from `dateOfBirth` and are cheap.
