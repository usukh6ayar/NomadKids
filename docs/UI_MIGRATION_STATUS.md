# UI_MIGRATION_STATUS.md

Bringing the v2 web app's appearance in line with the reference project
(`../ByatshanNuudelchid`), which is the approved visual design.

**The rule for this work:** the old UI is the visual reference; the old
implementation is not. Where the reference has an accessibility or responsive
defect, the port fixes it and this document records the deviation. Backend
architecture does not change.

Started 2026-08-20.

---

## 1. Method

Both applications are driven with real headless Chrome (Puppeteer 25, already a
dependency of the API's PDF worker), not eyeballed and not inferred from source.

```
old:  http://localhost:8000   Django, docker compose, real demo data
new:  http://localhost:3000   Next.js dev server
```

Each capture records a full-page screenshot plus a measured audit:

- horizontal overflow (`documentElement.scrollWidth - clientWidth`) and the
  first elements that exceed the viewport
- every interactive element under the 44px tap floor, with its height
- computed body background and font stack

Widths: **375 · 390 · 768 · 1024 · 1440**.

The Django debug toolbar is hidden before capture and excluded from the audit —
left in, it covers the right half of the page and reports its own controls as
undersized.

### What curl and source-reading cannot do

Overflow, clipping, overlap and tap-target size are properties of a rendered
layout. They are measured here, not deduced. Colour and spacing tokens *can* be
compared from source and are, in §2.

---

## 2. Global tokens — already aligned

Checked before any screen work, and the result reframed the task: the palette
was ported already. The difference is layout and composition, not colour.

| Token | Reference `app.css` | v2 `globals.css` | Match |
| --- | --- | --- | --- |
| Canvas | `--bg: #f8f7f4` | `--color-canvas: #f8f7f4` | ✅ |
| Surface | `--card: #ffffff` | `--color-surface: #ffffff` | ✅ |
| Border | `--line: #e9e6e0` | `--color-border: #e9e6e0` | ✅ |
| Ink | `--ink: #26242b` | `--color-ink: #26242b` | ✅ |
| Muted | `--muted: #77737d` | `--color-muted: #77737d` | ✅ |
| Brand | `--brand: #6c63ff` | `--color-primary: #6c63ff` | ✅ |
| Brand soft | `--brand-soft: #eeecff` | `--color-primary-soft: #eeecff` | ✅ |
| Control radius | `--radius-ctl: 12px` | `--radius-control: 12px` | ✅ |
| Control height | `--control-h: 48px` | `--size-control: 48px` | ✅ |
| Card radius | `--radius: 18px` | `--radius-card: 18px` | ✅ |
| Row radius | `--radius-sm: 14px` | `--radius-row: 14px` | ✅ |
| Card shadow | `--shadow` two soft layers | `--shadow-card`, same values | ✅ |

Confirmed at runtime: both apps compute `body` background as
`rgb(248, 247, 244)`.

**Closed 2026-08-20.** `--radius-card` was 16px, making every card in the
product 2px tighter than the design; it is now 18px, and `--radius-row` (14px)
and `--shadow-card` were added to match `--radius-sm` and `--shadow`.

The shadow is the one worth explaining. `Card` previously carried a border and
no shadow, on the reasoning that the brief rules out excessive elevation. That
holds — but the reference's `--shadow` is not elevation: it is two very soft
layers that separate a white card from a canvas only four steps away from white.
With a border alone at that contrast, cards read as flat cut-outs.

**Known difference, not a defect — no dark theme.** The reference ships a theme
toggle (`_theme.html`, `:root[data-theme="dark"]`). v2 deliberately does not:
`globals.css` records that the brief specifies one palette, and an unreviewed
second appearance for every screen is not in scope. Not tracked as a mismatch
below.

---

## 3. Screens

### 3.1 Login — **done**

Reference: `templates/base_auth.html` + `templates/accounts/login.html`.
New: `app/login/page.tsx` + `components/shell/auth-shell.tsx` (new).

#### Visual match

Before this work the two screens shared only their background colour. The new
login was a centred 420px column with a text wordmark; the reference is a
two-column split with a branded card.

| Element | Was | Now |
| --- | --- | --- |
| Container | bare form on canvas | white card, 440px, 18px radius, hairline border, soft shadow ≥900px |
| Desktop layout | single centred column | two columns — card left, illustration panel right |
| Brand | text "NomadKids" | `logo-160.png` beside the uppercase two-line product title |
| Subtitle | "Хүүхдийн хөгжлийн цахим хавтас" | "Багш, эцэг эх, администраторт зориулсан аюулгүй нэвтрэх систем." |
| Section heading | absent | "Нэвтрэх", 1.35rem bold |
| Role tabs | absent | Багш / Эцэг эх / Админ segmented control |
| Identifier label | "Хэрэглэгчийн нэр, и-мэйл эсвэл утас" | follows the tab — "Нэвтрэх нэр эсвэл и-мэйл" / "Утасны дугаар эсвэл и-мэйл" |
| Forgot link | centred, underlined | left-aligned, semibold, above a rule |
| Footer | absent | "Аюулгүй нэвтрэлт · HTTPS · Нууц үг хамгаалагдсан" |
| Art panel | absent | gradient panel with logo and tagline, hidden below 900px |

The 900px breakpoint is the reference's own, not Tailwind's `lg` (1024px). At
1000px the split still has room; folding early leaves a visibly empty half.

#### The role tabs are presentational — verified, not assumed

They looked like a product decision. They are not. The reference's
`accounts/views.py` states it and the code agrees — `attempt_login()` is called
with `identifier` and `password` only, and `role` is never passed to it:

> They are presentational only: they change which identifier the field asks
> for, nothing else. Filtering authentication by the selected tab would turn the
> form into a role oracle — an attacker could learn which role an address
> belongs to by watching which tab accepts it.

So the port changes a label and nothing else. `loginSchema` is untouched, the
API contract is untouched, and the role still comes from `Membership` after
login. Had the tab been submitted and honoured, this would have been a genuine
security decision and would have stopped here.

#### Responsive and accessibility

Measured at 390 · 768 · 1440, after the change:

| Check | Reference | New |
| --- | --- | --- |
| Horizontal overflow | 0 | 0 |
| Tap targets < 44px | **4** | **0** |

Three deviations from the reference, all deliberate:

1. **Role tabs are 44px, not 41px.** Measured on the running reference at 390px:
   `a h=41 "Багш"`, `"Эцэг эх"`, `"Админ"`. Under the floor the rest of this
   product holds to. Same control, two pixels more forgiving.
2. **The forgot-password link is a 44px target, not 17px.** Measured:
   `a h=17 "Нууц үгээ мартсан уу?"`. It looks identical; the box around it is
   tappable.
3. **Required fields keep their asterisk.** The reference marks required fields
   with the `required` attribute alone, with no visual indicator. Removing v2's
   asterisk would match the screenshot and lose a real affordance, so it stays.
   This is the one place the new screen is visibly *not* pixel-identical.

Tabs are `role="group"` with `aria-pressed`, not tab semantics: there are no
tabpanels, only one form whose label changes, and calling them tabs would
promise a screen reader a structure that does not exist.

#### Tests

`apps/web` full suite — 65 passed. Three login tests were updated for the new
identifier label; that label change is intended, and the tests now assert the
reference's wording.

#### Remaining differences

- Required-field asterisks (above, deliberate).
- Card radius 18px here vs `--radius-card: 16px` elsewhere in v2 — see §2.
- The Next.js dev-mode indicator appears in dev screenshots. Not shipped.

---

### 3.2 Forgot password — **done**

Reference: `templates/accounts/password_reset_request.html`.
New: `app/forgot-password/page.tsx`.

Moved onto `AuthShell`, so it now carries the same card, brand block and footer
as login instead of its own bare centred column. Heading, supporting sentence,
the administrator fallback line and the "Нэвтрэх хуудас руу буцах" link all take
the reference's wording and placement. Submit reads "Холбоос илгээх", as there.

**Deliberate deviation — the field stays wider than the reference's.** The
reference asks for an e-mail address only. v2's API accepts any identifier, and
`PRODUCTION_READINESS.md` records why: many parents here have a phone number and
no e-mail, and refusing them would mean an account that can never be recovered.
The prose is the reference's; the field is v2's.

The success state no longer swaps in a separate `Card` — it replaces the form
inside the same card, so the page does not visibly change shape on submit.

Measured at **375 · 390 · 768 · 1024 · 1440**: overflow 0, tap targets under
44px 0. The reference's own "Нэвтрэх хуудас руу буцах" measures 17px tall; this
one is a 44px target.

### 3.3 Reset password — **done**

Reference: `templates/accounts/password_reset_confirm.html`.
New: `app/reset-password/[token]/page.tsx`.

On `AuthShell`, with the reference's heading, its rules list above the form, and
its "Нууц үг хадгалах" button label. The success state is now a card in the same
shell rather than a separate centred layout.

**★ The rules list has one item, not four.** The reference lists length,
uppercase, lowercase and digit, mirroring Django's `AUTH_PASSWORD_VALIDATORS`.
This API enforces length alone — `auth.dto.ts`:

```ts
password: z.string().min(8, "Нууц үг дор хаяж 8 тэмдэгт байх ёстой").max(200)
```

Copying the list would announce three requirements that reject nothing. A rule
the server does not enforce is not a rule; it is a message users learn to
ignore. If the policy should match the reference's, that is a backend change and
a decision to take deliberately — noted here, not made here.

### 3.4 The application shell — **done**

Reference: `templates/base_teacher.html`, `base_parent.html`, and the
`.shell` / `.sidebar` / `.brand` / `.nav` / `.whoami` / `.mhead` rules in
`app.css`. New: `components/shell/app-shell.tsx`.

This was the single largest visual gap in the product: every authenticated
screen is inside it.

| Element | Was | Now (reference's values) |
| --- | --- | --- |
| Sidebar width | 232px | **244px** |
| Sidebar padding | `px-3 py-5` | **18px 14px** |
| Brand | `NK` square + "NomadKids" | `mark-96.png` in a **40px `#f1efff`** rounded tile |
| Brand text | one line | **two lines** — product name, then "Багшийн хэсэг" |
| Nav item | `text-sm`, `gap-2.5` | **.92rem, 11px gap, 10px 12px padding** |
| Identity | in the top bar | **`whoami` block pinned to the sidebar foot** |
| Logout | text button in the top bar | **44px icon button** inside `whoami` |
| Phone header | generic top bar | **`mhead`** — brand, avatar, logout, sticky |
| Main padding | `pt-4` | **22px top, 26px side, 48px bottom** |

Active/hover states follow `.nav a[aria-current]` and `.nav a:hover` exactly:
`--brand-soft` on `--brand` at weight 600 when current, canvas-on-ink on hover.

**Corrected once the reference was rendered.** An earlier version of this
section claimed v2 should show the identity once. It should not — see §6.1.

**Measured defect found and fixed during the port.** The old brand link was
**32px** tall at every width — under the tap floor, in the shell, on every
screen. Now 44px.

### 3.5–3.11 Teacher and parent screens — **verified, two defects fixed**

With demo data in place (§5), every MVP screen was driven in a real browser:
signed in, navigated, measured, screenshotted.

| Screen | 375 | 768 | 1024 | 1440 |
| --- | --- | --- | --- | --- |
| Teacher dashboard | ✅ | ✅ | ✅ | ✅ |
| Children list | ✅ | ✅ | ✅ | ✅ |
| Child detail | ✅ | ✅ | ✅ | ✅ |
| Observation form | ✅ | ✅ | ✅ | ✅ |
| Assessment | ✅ | ✅ | ✅ | ✅ |
| Review queue | ✅ | ✅ | ✅ | ✅ |
| Notifications | ✅ | ✅ | ✅ | ✅ |
| Portfolio | ✅ | ✅ | ✅ | ✅ |
| Parent home | ✅ | ✅ | ✅ | ✅ |
| Parent notifications | ✅ | — | — | — |

✅ = 0 horizontal overflow, 0 effective tap targets under 44px.

Three real defects, all found by measurement rather than by looking:

1. **Notification filter buttons were 40px** (`Бүгд`, `Уншаагүй`). Now 44px.
2. **The child's name in the review queue was an 18px link.** It is inline in a
   sentence, so the box was grown rather than the text.
3. **Checkbox rows had dead pixels.** The box is 20px with a 44px row around it,
   but the `<label>` wrapped only the text — the gap and the trailing space did
   nothing. The whole row is now the label, so a thumb landing anywhere on the
   line toggles it. The native 20px box is kept deliberately: a restyled one
   loses the platform's focus ring and checked state.

**A note on how #3 was found, because it nearly was not.** The audit flags
elements under 44px, and a 20px checkbox inside a tappable row is a false
positive — the effective target is the row. Rather than suppress the warning,
the audit now measures the wrapping `<label>`. That turned a noisy signal into
an accurate one, and it was the accurate version that showed the label was too
small to be the row.

### 3.12 Reports — **not a screen**

There is no reports screen to compare. Report generation is a dialog
(`components/reports/report-dialog.tsx`) opened from a child, and the output is
a PDF. The PDF's own layout is verified separately, against extracted text —
`docs/PDF_SPIKE.md` §4, per CLAUDE.md §4.3.

### 3.13 Parent child detail — **same as parent home**

`/home` *is* the parent's child view in v2: the child switcher, the profile
card, the term assessment and the moment feed are all on it. The reference
splits `parent_home` and `parent_child_detail`; v2 does not, and that predates
this work. Recorded as a structural difference, not a styling mismatch.

---

## 4. Files changed

| File | Change |
| --- | --- |
| `apps/web/components/shell/auth-shell.tsx` | new — auth layout, role tabs |
| `apps/web/components/shell/app-shell.tsx` | rebuilt — sidebar, brand, `whoami`, phone header |
| `apps/web/app/login/page.tsx` | rebuilt against the reference |
| `apps/web/app/forgot-password/page.tsx` | moved onto `AuthShell` |
| `apps/web/app/reset-password/[token]/page.tsx` | moved onto `AuthShell` |
| `apps/web/app/(app)/notifications/page.tsx` | filter buttons 40px → 44px; `PageHeader` |
| `apps/web/app/(app)/observations/review/page.tsx` | child link 18px → 44px; `PageHeader` |
| `apps/web/app/(app)/dashboard/page.tsx` · `children/page.tsx` | `PageHeader` |
| `apps/web/components/ui/field.tsx` | checkbox row is now the label |
| `apps/web/components/ui/card.tsx` | 18px radius + shadow; new `RowList` / `RowCard` |
| `apps/web/components/media/media-image.tsx` | avatars tinted per child |
| `apps/web/app/globals.css` | `--radius-card` 16→18px; `--radius-row`, `--shadow-card` |
| `apps/web/components/shell/app-shell.tsx` | grouped `NavSection`s, `NavShortcut`s, sidebar scroll fix |
| `apps/web/app/(app)/layout.tsx` | the reference's five sections and quick links |
| `apps/web/components/ui/card.tsx` | `SectionHeader` takes a `lede` |
| `apps/web/app/globals.css` | `--color-faint` |
| `apps/web/public/logo-160.png` · `mark-96.png` | brand assets, copied from the reference |
| `apps/web/test/flows.test.tsx` · `csrf.test.tsx` | identifier label updated |
| `apps/api/prisma/seed-demo.ts` | new — local-only demo data (§5) |
| `apps/api/package.json` | `seed:demo` script |

All three signed-out screens share one shell, as they do in the reference, and
every authenticated screen shares the rebuilt `AppShell`.

**Verification.** `apps/web` full suite — 65 passed. `tsc --noEmit` clean.
Thirty-one page captures in headless Chrome across five widths: **0 horizontal
overflow, 0 effective tap targets under 44px**, against 4 undersized targets on
the reference's own login and 1 on its password-reset request.

---

## 5. Demo data

`apps/api/prisma/seed-demo.ts`, run with `pnpm --filter @kinder/api seed:demo`.

Comparing screens needs rows: an empty list, an empty table and an empty
dashboard all look alike and none of them looks like the design. This creates
one kindergarten with 2 groups, 10 children, 36 observations, 50 assessments and
3 announcements, plus admin, teacher and parent accounts.

The observations deliberately cover the states the screens branch on — pending
review, approved-and-visible, approved-but-private — because a feed with one
kind of row does not exercise the feed.

**★ It refuses to run against anything but a local database.** Two independent
checks, because either alone has a plausible failure: an unset `NODE_ENV` looks
like development on a production box, and a tunnelled production database really
does answer on `localhost`. Both must pass.

This is the one place in the repository where a default password is acceptable.
`seed.ts` refuses to invent one and is right to — a seeded `admin/admin123`
nobody changes is a production backdoor. The difference is that this script
cannot reach a production database, so the accounts it creates cannot exist
anywhere that matters.

---

## 6. Rendered side-by-side — the reference, signed in

The reference login arrived, so its authenticated screens were rendered rather
than read. That changed two conclusions.

### 6.1 A correction

An earlier note here claimed the reference shows the identity **once**, in the
sidebar, and hides the topbar pill "because it was the same fact twice". That is
only true below 900px. Rendered at 1440, the reference shows **both** — the
sidebar `whoami` *and* the topbar `.who` pill.

Fixed: `PageHeader` now carries the pill on a desktop and drops it below `lg`,
where the phone header holds it. This is what the reference does, and the port
was wrong for a plausible-sounding reason.

### 6.2 The reference's own page header, now ported

Every reference screen opens with `.topbar`: an `h1`, a supporting line, and the
identity pill at the right. v2 had a bare `h1` at `text-xl`.

`PageHeader` in `app-shell.tsx` is that pattern — 1.5rem/1.35 heading per
`--t-page`, an optional lede, a slot for trailing controls, and the pill.
Applied to the dashboard, children, review queue and notifications. The
dashboard's title is now "Хяналтын самбар" and the review queue's
"Эцэг эхийн ажиглалт — хянах", both the reference's wording.

### 6.3 What the rendered reference showed that v2 will *not* copy

This is the substantive finding, and it is a scope one.

The reference's teacher dashboard is **mostly Phase 2**: attendance
registration, a monthly attendance report with a trend chart and a donut, a
meal-cost table, an Excel/PDF export row. Its sidebar has fifteen entries across
five collapsible groups — Ирц, Хоол, Санхүү, Чат, Судалгаа, Тайлан. Its children
list carries attendance and meal-cost stat cards, an Excel import button and a
profile-completion ring.

CLAUDE.md §7 excludes every one of those from the MVP by name: attendance,
meals, finance, chat, surveys, Excel import/export, analytics.

So "the same product" stops at the chrome. v2 matches the shell, the header, the
navigation styling, the palette and the component vocabulary — and does not grow
a menu of features it does not have. The reference makes the same argument in
`base_teacher.html`, having cut twelve mockup entries down to six:

> The mockups draw twelve sidebar entries covering all three phases. Only the
> sections that exist are listed: a menu entry that goes nowhere teaches users
> the system is broken.

Its five grouped nav sections exist because it has fifteen destinations. v2 has
five. Grouping five items under five headings would be the form of the design
without its reason.

### 6.4 Per-screen differences that remain, with cause

| Screen | Difference | Cause |
| --- | --- | --- |
| Dashboard | No attendance register, trend chart, donut, meal costs | Phase 2 — CLAUDE.md §7 |
| Dashboard | No `bandmini` age-band strip | Feature v2 does not expose; porting it is backend work, not styling |
| Children | No Excel import / CSV / PDF row | Excel import/export excluded — §7 |
| Children | No attendance or meal-cost stat cards | Phase 2 |
| Children | No profile-completion ring | Not a v2 concept |
| Children | No registration code under the name | No equivalent field surfaced |
| Children | Rows share one card with dividers; reference gives each row its own card | Open — cosmetic, listed below |
| Children | Live debounced search; reference has a submit button and a sort menu | v2's is a deliberate improvement |
| Sidebar | Flat list; reference groups into `<details>` sections | v2 has five destinations, not fifteen |
| Sidebar | No theme toggle | v2 ships one palette — `globals.css` |

### 6.5 Cosmetic alignment — **closed**

All three items from the previous pass are done.

**List rows are separate cards.** The reference's `.kidlist` / `.kidrow` is a
column of individually bordered cards with an 8px gap, not one card with
dividers. Added `RowList` and `RowCard` to `components/ui/card.tsx` and moved
the children list and notifications onto them. Row radius is 14px, not the
card's 18px: a row is smaller and the larger radius eats its corners.

The hover affordance is the reference's too — `border-color` moves to the brand
colour, rather than a background wash. That is what tells you the row is a link.

**Card radius and shadow** — §2.

**Avatars are tinted per child.** The reference gives each child a different
colour so a teacher finds a row by shape rather than by reading every name; its
`app.css` makes the same argument for the dashboard statistics. Five tints, all
from v2's existing accent tokens — mint, sky, sun, peach, brand — so no new
colour enters the palette.

★ The tint is derived from the **name**, not the list index. An index would
repaint every child the moment the sort order changed, and a child would be a
different colour on the dashboard than in the list. Hashing the name means the
colour is a property of the child.

### 6.6 The grouped sidebar — **done**

The last structural difference. The reference's desktop sidebar is a top-level
link, a tinted quick-links box, then five collapsible `<details>` sections; v2's
was a flat list of five links.

Now ported in full — `NavSection` and `NavShortcut` in `app-shell.tsx`, with the
reference's own headings and ordering:

```
Хяналтын самбар                    top-level, active state
ТҮРГЭН ХОЛБООС                     tinted box, three daily destinations
Хүүхдийн хөгжил ба үнэлгээ         Хүүхдүүд · Ажиглалт хянах · Явцын үнэлгээ · Тайлан
Өдөр тутмын бүртгэл                Ирц · Хоол
Харилцаа холбоо                    Ангийн самбар / Мэдээ · Судалгаа · Чат
Санхүү ба баримт бичиг             Санхүү · Баримт бичиг
Багш ба байгууллага                Багшийн мэдээлэл · Бүлэг, цэцэрлэгийн мэдээлэл
```

**★ Entries the MVP does not have render as "удахгүй", not as links — and that
is the reference's own device, not a compromise invented here.** Its
`base_teacher.html` ships "Санхүү удахгүй" and "Баримт бичиг удахгүй" as plain
`<span>`s for precisely this reason, and states the rule:

> a menu entry that goes nowhere teaches users the system is broken

So the menu names the whole product, exactly as the design does, while only the
built parts are reachable. Ирц, Хоол, Санхүү, Баримт бичиг, Судалгаа and Чат are
Phase 2 per CLAUDE.md §7; **this changes their appearance in the navigation and
nothing else.** No route, no API call, no schema — frontend only.

Явцын үнэлгээ and Тайлан are `удахгүй` for a different reason: both exist in v2,
but assessment always begins from a group and a report from a child, so neither
has a top-level route to point at.

**A defect the port introduced, found by measurement.** Five sections make the
sidebar taller than a laptop viewport. The whole panel scrolled, so `whoami`'s
`mt-auto` placed it at the foot of the *content* rather than the panel — it
overlapped the last section and the way out scrolled off the screen. Fixed: the
brand and the identity are fixed, and only the menu between them scrolls.

### 6.7 Responsive audit — deepened

The measurement up to this point checked two things: page overflow and tap-target
size. That is thin. The audit now also catches, at **320 · 360 · 390 · 414 · 768
· 1024 · 1280 · 1440**:

- text clipped horizontally by a hidden overflow with no ellipsis
- text clipped vertically by a fixed height
- any element whose right edge passes the viewport
- type under 11px

320px was added because it is the narrowest phone still in use, and the previous
floor of 375 would never have shown a defect that only appears below it.

**`sr-only` is excluded, and that mattered.** Screen-reader-only text is
deliberately 1px and clipped; auditing it reports the technique as the bug. The
first run produced forty such false positives and would have buried anything
real.

Two genuine findings, both fixed:

| Where | Was | Now |
| --- | --- | --- |
| Unread badge digit | 10px | **11px** |
| "ТҮРГЭН ХОЛБООС" eyebrow | .64rem (10.2px) | **11px** |

The eyebrow is the reference's own size. An all-caps label at 10px is the
smallest type in the product and the hardest to read; the extra pixel costs no
layout and the letter-spacing still carries the style.

Everything else was clean: **0 overflow, 0 clipping, 0 elements past the
viewport, 0 tap targets under 44px**, on nine screens at eight widths.

### 6.8 Final measurement

Twenty-seven captures — nine screens (teacher dashboard, children, child detail,
observation form, assessment, review queue, notifications, portfolio, parent
home) at 375 · 768 · 1440, signed in with demo data:

Thirty-six captures — nine screens at 375 · 768 · 1024 · 1440, signed in with
demo data:

```
36/36 clean   — 0 horizontal overflow, 0 effective tap targets under 44px
apps/web      — 65 tests passed
tsc --noEmit  — clean
eslint        — clean
```

### 6.9 Direction change — E-Mongolia principles now lead

**2026-08-20, mid-work.** The brief changed: e-mongolia.mn is a style reference
for its *principles* — spacious layout, strong hierarchy, restrained colour,
minimal decorative UI, clear primary actions — adapted to something warmer and
child-focused. No branding, illustrations or components copied.

**This conflicts with "match Django exactly", and the conflict is real.** The
reference is dense (fifteen menu entries, a dashboard of tables and charts) and
carries a cool-blue decorative panel in an otherwise warm product. Confirmed
with the client that the principles win where the two disagree; structure stays
Django-derived.

Applied:

| Principle | Change |
| --- | --- |
| Warmer · minimal decorative UI | The quick-links box was `#f7fbff` on `#dbe9f3` — the one cool element in a warm product. Now canvas on the standard border. |
| Strong hierarchy | `SectionHeader` takes a `lede`, so a module says what it is for. Heading up to 1.05rem per `--t-title`. |
| Spacious | Desktop gains 40px lead-in, 32px sides, 64px tail, and 28–32px between modules. The phone keeps 16px — 26px of side padding costs a seventh of a 375px screen. |
| Restrained colour | `#a6a3ae` was hard-coded twice; it is now `--color-faint`, the third text step. |

**What did not change**, deliberately: the sidebar structure, the grouped
sections, the row-card lists, the palette, the component vocabulary. The
principles are a quality layer over the ported structure, not a redesign.

### 6.10 What is left

**The theme toggle — dropped, 2026-08-20.** The reference has "Харанхуй горим"
and a full `:root[data-theme="dark"]` palette. It will not be ported: the
product ships one palette, as `globals.css` has always recorded. Verified that
no dark-theme code exists in v2's source — the only matches are generated files
under `.next/`.

**Mobile teacher navigation.** The reference turns its sidebar into a horizontal
scrolling strip below `lg`; v2 keeps a bottom tab bar. Left as it is
deliberately — the bottom bar is reachable one-handed and already meets the tap
floor, and CLAUDE.md §5 puts the phone first.

---

## 7. Photos — child pictures and work

Added 2026-08-20. Frontend only: every endpoint already existed.

### 7.1 What was missing

`MediaPurpose.CHILD_PHOTO` and `POST /children/:id/media/profile-photo` have
been in the schema and the API from the start, and **nothing in the web app
ever called either**. A child's avatar was always initials, and the only way a
photo entered the product was as an attachment to an observation.

| Piece | New |
| --- | --- |
| `components/media/photo-upload.tsx` | Picking, size check, sequential upload, retry |
| `components/media/child-gallery.tsx` | The grid, the full-size viewer, profile picture, delete |
| Portfolio page | "Зураг, бүтээл" section and its anchor |
| `observation-photos.tsx` | Rewritten onto the shared uploader |

`PhotoUpload` exists because the same behaviour is now needed in three places,
and three copies of a sequential-upload-with-retry loop is three chances to get
the error handling subtly different.

### 7.2 Decisions

**No "artwork" purpose.** `MediaPurpose` has three values and a fourth is a
schema migration. A drawing is a photograph of a drawing; the caption says
which. The enum earns a value when artwork needs its own filtering, sorting or
report section — not before.

**The gallery reads both purposes.** A photo attached to an observation and a
picture of a drawing uploaded on its own are the same thing to a parent looking
at their child's year. The API records the difference; the family should not
have to visit two places for one idea.

**Uploads go through the API, never straight to the bucket.** A presigned PUT
hands the browser a URL it can write anything to, and content sniffing, the size
limit and EXIF stripping cannot be enforced on the far side of one. EXIF matters
more than usual here: these are photographs of children, and a phone writes GPS
coordinates into them by default.

**Deleting archives.** `DELETE /media/:id` sets a status, so a photo removed
from the gallery still exists for the audit trail.

### 7.3 ★ A production defect this uncovered

Uploading a real file in a real browser surfaced a bug that had been in the
product since the media module was written.

Every photo loads as `<img src="{api}/v1/media/:id">`. That endpoint checks
permission and then **302s to a presigned URL on the storage host** — MinIO
locally, R2 in production. CSP is enforced against the URL the browser finally
fetches, not the one in the attribute, and `middleware.ts` listed only the API
origin:

```
img-src 'self' data: blob: {apiOrigin}
```

So **every child photo in the product was blocked by the page's own policy.**

The request chain was correct end to end — 302 issued, presigned URL valid,
`200`, `image/png`, 2942 bytes, confirmed with curl. The image still did not
appear. Nothing short of rendering a photo in a browser could have caught it: no
server-side check sees a CSP violation, and there were no photos in any local
database until the demo seed existed.

Fixed with `NEXT_PUBLIC_MEDIA_URL`, whose origin is appended to `img-src`. The
exact origin, never a wildcard — presigned URLs are unguessable and short-lived,
but `img-src *` would let an injected tag exfiltrate by URL. A malformed value
is ignored rather than thrown: this runs on every request, and a typo should
cost a missing photo, not the whole site.

**This must be set in production before photos work there.** It is the R2 S3
endpoint the presigned URLs are issued on — added to `.env.example`, and listed
in the deployment blockers.

### 7.4 Verified in a browser

Driven with real Chrome, signed in, against the demo database:

```
upload      file picked → POST → thumbnail appears
            naturalWidth 64 × 64 — the bytes actually arrived and decoded
viewer      opens, role="dialog", Escape closes, body scroll locked
profile     "Хувийн зураг болгох" → children.photoMediaFileId set in Postgres
            → header avatar renders the photograph after reload
responsive  9 screens × 8 widths (320…1440) — 0 issues
```

### 7.5 The audit missed a second false positive

The tap-target check flagged the gallery's file input at `h=1` on every width.
It is `sr-only` and operated through the styled `<label>` that points at it — a
44px button. Measuring the hidden input reports the technique as the bug, the
same mistake as auditing `sr-only` text.

The audit now resolves a control's real target: the wrapping label, or the label
whose `for` names it, whichever is larger. Two false-positive classes found in
one session is a reminder that an audit is code, and wrong audit results are
worse than none — they train you to ignore output.

---

## 8. The class board — likes, no comments

Added 2026-08-20. **Backend and frontend**, because a like has to persist.

### 8.1 What was asked, and what it needed

> "It should work like a Facebook group — people can like, but not comment.
> Only teachers post."

Two of those three were already true. v2 has never had comments, and creating a
notice is staff-only. The like was the new part, and it is the one that could
not be done in the frontend alone: a like that vanishes on reload is worse than
no like, because it looks like it worked.

### 8.2 The model

```prisma
model NotificationReaction {
  kindergartenId  // §3.1 — denormalised even though reachable through the notice
  notificationId
  userId
  deletedAt       // §3.2 — un-liking soft-deletes
  @@unique([notificationId, userId])
}
```

**Soft-deleted, and that shapes the write.** Un-liking sets `deletedAt`; liking
again clears it. The unique pair therefore survives the round trip, which is why
the repository upserts rather than inserting — a plain `create` fails on the
constraint the moment anyone changes their mind twice. There is a test for
exactly that sequence.

Migration read by hand per §3.3: `CREATE TABLE`, two indexes, three foreign
keys. Additive, no `DROP`, no data-losing operation.

### 8.3 The endpoints

```
POST   /notifications/:id/like     → the updated notice
DELETE /notifications/:id/like     → the updated notice
```

Both run the same `audienceFilter` + `findReadable` as every other read on this
board, so a guardian who may not see a notice gets **404** — a like cannot be
used to probe which announcements exist (§1.7). Both are idempotent in both
directions: a double-tap on a phone must not produce two likes, and un-liking
something never liked is a no-op rather than an error.

They return the updated notice so the button can show the new count without a
second request.

**The response carries a count and a boolean, never a list of who.** Same
reasoning as `reads`: a parent must not be able to work out which other families
are on the board. `toPublicShape()` collapses both and strips the raw rows.

### 8.4 There is no comment endpoint, on purpose

A class board families can reply to is a moderation surface, and nobody has been
given the job of moderating it. Posting stays with staff; reacting is open to
anyone who can read the notice.

`notifications.test.ts` asserts the *absence* — `POST /notifications/:id/comments`
must 404 — so the decision cannot be undone by someone adding a route without
reading why. The same file re-asserts that a guardian still cannot post.

### 8.5 Tests

Thirteen new cases, all through HTTP against the real app and database, per
§4.1:

```
likes                    guardian can like · twice still counts once
                         un-like · un-like twice · re-like after un-like
                         count is everyone's, likedByMe is mine
                         the count shows in the list
authorization            other kindergarten → 404
                         notice targeted at another family → 404
                         unpublished draft → 404
                         unauthenticated → 401 · no CSRF → 403
the absent feature       no comment endpoint → 404
                         a guardian still cannot post → refused
```

Three of these failed on first run, all because the *test* was wrong, not the
code — a helper's argument order, an assertion that scanned the whole payload
for a user id (the notice's author is a legitimate id in it), and one that
expected 403 where the tenant check correctly answers 404 first. Worth recording
because a test that fails for its own reasons is indistinguishable from a real
defect until you read it.

### 8.6 The frontend

`components/notifications/like-button.tsx`, on the list rows and the detail
page. Optimistic, and it has to be: the button sits inside a row that is a link,
so the tap must feel instant or the user taps again on the way to the next
screen. `preventDefault` and `stopPropagation` are both needed, or liking
navigates.

The heart **fills** when liked rather than only changing colour, so the state
survives a monochrome screen and colour-blindness. The accessible name carries
the count — "Таалагдсныг болих, 3" — rather than leaving an unlabelled icon.

### 8.7 Verified in a browser

Signed in as a parent, against the demo database:

```
before      aria-pressed=false, no count
click       aria-pressed=true, "1"      — and the row did not navigate
reload      aria-pressed=true, "1"      — it persisted
click again aria-pressed=false, no count
responsive  8 widths, parent and teacher — clean
```

### 8.8 An operational note

Running the API integration suite **truncates the local development database** —
`resetData()` does not distinguish dev data from test data. The demo seed has to
be re-run afterwards:

```bash
export $(grep -E '^DATABASE_URL=' .env | xargs)
pnpm --filter @kinder/api seed && pnpm --filter @kinder/api seed:demo
```

Cost twenty minutes of debugging a login that had started returning 401 for no
apparent reason.

---

## 9. The feed — endless scroll and photo posts

Added 2026-08-20. Backend and frontend.

### 9.1 Endless scroll

`useInfiniteQuery` plus an `IntersectionObserver` sentinel, replacing "Өмнөх /
Дараах". A class board is read the way a phone is read — thumb down until
something looks familiar. Pagination makes the reader hold a page number in
their head to answer "have I seen this one", which is the wrong question to make
a parent answer on a bus.

The API is unchanged and still paginated; the client stitches the pages
together. `totalPages` says whether another exists, so the last page ends rather
than fetching for ever. `rootMargin: 400px` starts the fetch before the reader
reaches the bottom, so the next batch is usually already there. The sentinel has
a 1px height — a zero-height element never intersects.

### 9.2 Photos on a notice

Announcements had no way to carry an image, and there was **no compose screen at
all**: a teacher could only create a notice through the API.

**Schema.** `MediaFile.notificationId` and a `NOTIFICATION` purpose. Migration
read by hand per §3.3 — an enum value, a nullable column, an index, a foreign
key. Additive, no data-losing operation.

**Endpoint.** `POST /notifications/:id/media`, staff only, authorised by
kindergarten membership rather than by child — a notice is addressed to a group,
so there is no child to check against. Guardians may like a notice, never
illustrate one: an upload endpoint that accepted a parent would be a way around
"only staff post". The storage key is kindergarten-scoped and still random.

**Compose screen.** `/notifications/new`. Two steps on one screen: the notice is
created as a DRAFT, photos attach to that draft, publishing is a separate
button. The API forces that order — a photo needs a notice to belong to — and it
is the right shape anyway, because a half-written notice cannot reach two
hundred families by someone hitting save.

### 9.3 ★ The defect this surfaced

Uploading worked. The photo then failed to load, for everyone.

`getDownloadUrl` opened with:

```ts
if (!media || !media.childId) throw new NotFoundException();
```

That test had been standing in for "is this a real file" — every media row until
now had a child. A class-board photo has none, so **every notice photo 404'd**
immediately after being uploaded successfully.

The fix is a branch, not a loosened check: a notice photo is readable exactly
when its notice is, and `NotificationsService.isReadable()` was added so
`MediaService` can ask rather than re-derive the audience rules. Copying them
would be the second copy §1.1 forbids — the one that eventually disagrees with
the first.

Three tests pin it: the audience gets a 302, someone outside gets 404, and a
photo on an unpublished draft is not fetchable by a guardian.

### 9.4 Tests

Ten new API cases on top of the like suite, all through HTTP:

```
attach            teacher can attach · appears on the notice · appears in the list
                  storage key never leaves the API
download          audience → 302 · outsider → 404 · draft → 404 for a guardian
authorization     guardian cannot attach → 404 · other kindergarten → refused
                  unauthenticated → 401 · no CSRF → 403
content           a shell script named .png → 400 (sniffed, not trusted — §1.6)
```

`notifications` + `media` suites: 95 passed, no regression in the existing media
authorization tests.

### 9.5 Verified in a browser

Teacher composes → uploads → publishes → **parent sees the post with the photo**:

```
compose      draft created, upload control appears
upload       thumbnail renders — naturalWidth 64, the bytes arrived
publish      lands on /notifications
as a parent  the new post is in the feed, 1 image, decoded
scroll       "Бүх мэдэгдлийг үзлээ." at the end
responsive   feed and compose, 8 widths — clean
```

One harness bug worth recording: the test clicked `button[type="submit"]` and
hit the wrong control once the upload block appeared, silently navigating away
via "Болих". Buttons are now targeted by their label. A test that drives the
wrong element reports a product failure that does not exist.
