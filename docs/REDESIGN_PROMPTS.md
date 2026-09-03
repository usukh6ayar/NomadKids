# NomadKids — ChatGPT image-generation prompts

Source of every label, dimension and colour here: **`docs/REDESIGN_BRIEF.md`**.
When the two disagree, the brief wins — it was checked against the code.

Paste **Block 0** first, then any one screen prompt after it. Block 0 carries the
palette and house style so the six images come back looking like one product.

> **Expect the Cyrillic to come back garbled.** Image models cannot render
> Mongolian text reliably. The labels are in the prompts anyway — without them
> you get English mockups, which is worse. Treat the output as **layout, colour
> and composition** reference, then re-type the real labels from the design
> brief. If you want pixel-correct text instead, ask ChatGPT for HTML/CSS and
> screenshot it.

---

## Block 0 — shared style preamble

```
You are producing a high-fidelity UI mockup for "Бяцхан нүүдэлчид" (NomadKids),
a Mongolian kindergarten child-development portfolio app. Render it as a clean
product design screenshot, not a photograph, not an illustration of people
using a device.

HOUSE STYLE
- Clean, simple, modern, warm, fast. Generous whitespace. Flat design with very
  soft shadows only on cards. No gradients, no glassmorphism, no dark mode.
- Absolutely not a generic dark admin dashboard. This is a warm, friendly
  product used by kindergarten teachers on their phones.
- All interface text is in Mongolian Cyrillic.

PALETTE (use these exact values)
- Page background (canvas): #f8fafc
- Card / panel surface: #ffffff
- Borders: #e2e8f0, soft dividers #f1f5f9
- Primary text (ink): #1e293b
- Secondary text (muted): #64748b
- Faint text: #94a3b8
- Brand primary (buttons, active state, links): #1d4ed8
- Brand soft tint (active row background, chips): #eff6ff
- Danger / unread badge: #c0392b
- Pastel accents for category tiles and charts only:
  mint #bfe8d4, sky #cde7f7, sun #f8e6a0, peach #f8d5c2

GEOMETRY
- Corner radii: 12px on buttons and inputs, 14px on list rows, 18px on cards,
  fully rounded on chips and badges.
- Desktop sidebar is exactly 244px wide. Content column is capped at 1400px and
  centred — it never stretches edge to edge.
- Mobile bottom tab bar is 60px tall with five tabs.
- Minimum tap target 44px everywhere.

TYPOGRAPHY
- A clean geometric sans that supports Cyrillic. Page title ~24px semibold,
  section headings ~17px semibold, body ~15px, captions ~13px.
- Mongolian labels are LONG. Allow two-line labels; never truncate a label with
  an ellipsis in the mockup.
```

---

## Prompt 1 — Ангийн самбар (teacher dashboard), phone

```
[paste Block 0 first]

Render an iPhone-sized screen, 390x844, portrait, no device bezel — just the
screen content.

SCREEN: the teacher's class board, "Ангийн самбар".

TOP: a sticky white header — small tinted rounded square holding a logo mark,
beside it two lines: "Бяцхан нүүдэлчид" in semibold ink and "Багшийн хэсэг" in
small muted text. On the far right a bell icon with a small red circular badge
showing "3".

BELOW: page title "Ангийн самбар" in large semibold, and under it a muted line
"Дэлбээ бүлэг · 2026.09.03".

CONTENT, stacked with 20px gaps:
1. Two white cards side by side, equal width. Left card titled "Өнөөдрийн ирц"
   with a circular progress dial in brand blue showing about 86% and the figure
   "30 / 35" in the centre. Right card titled "Хүйсийн харьцаа" with a two-tone
   donut ring (sky #cde7f7 and peach #f8d5c2) and beneath it "Охид 17" and
   "Хөвгүүд 18".
2. One full-width white card, "Долоо хоногийн ирц", containing a small bar
   chart of five bars in brand blue with weekday labels underneath.
3. Two white cards side by side: "Энэ сарын төрсөн өдөр" showing two small
   circular child avatars with names and dates, and "Судалгаа" showing a
   response count and a thin progress bar.
4. One full-width white card, "Сүүлийн нийтлэл", with a rounded photograph on
   the left and a headline plus two lines of muted body text on the right.
5. One full-width white card, "Өнөөдрийн хоол", listing three meal rows, one of
   them carrying a small peach-coloured allergy warning chip.

BOTTOM: a fixed white tab bar, 60px tall, five tabs, each an icon above a small
label: "Самбар" (active — icon sits in a rounded #eff6ff tinted well, label in
#1d4ed8 semibold), "Мэдээ" (with a small red unread badge on the icon), "Явцын
үнэлгээ" (label wraps onto two lines), "Судалгаа", "Цэс". Inactive labels and
icons are muted grey.
```

---

## Prompt 2 — Ангийн самбар (teacher dashboard), desktop

```
[paste Block 0 first]

Render a desktop browser screen, 1440x900, no browser chrome — just the app.

LEFT: a 244px fixed white sidebar with a right hairline border.
- Top: logo mark in a tinted rounded square, "Бяцхан нүүдэлчид" semibold, and
  "Багшийн хэсэг" small and muted beneath it.
- Then one highlighted top-level row "Самбар" — brand-soft #eff6ff background,
  #1d4ed8 semibold text, and a 3px rounded brand-blue bar on its left edge.
- Then five collapsible sections, each a small semibold heading with a chevron,
  and indented rows beneath it in muted grey with a small line icon each:
  "Хүүхдийн хөгжил ба үнэлгээ" → Хүүхдүүд, Явцын үнэлгээ, Ажиглалт хянах,
  Чөлөөний хүсэлт хянах
  "Өдөр тутмын бүртгэл" → Ирц, Хоол ба цэс
  "Харилцаа холбоо" → Ангийн самбар / Мэдээ, Судалгаа, Чат
  "Санхүү ба баримт бичиг" → Баримт бичгийн сан
  "Багш ба байгууллага" → Багшийн мэдээлэл
- Bottom of the sidebar, pinned: a light #f8fafc rounded row with small circular
  avatar initials, the name "Батмөнх Тэмүүлэн" in semibold, "Дэлбээ бүлэг" muted
  beneath it, and a small logout icon button on the right.

TOP: a sticky white header bar spanning the area right of the sidebar, with a
thin bottom border. On the left a rounded brand-soft chip reading "Дэлбээ бүлэг".
On the right a bell icon with a red "3" badge, then a circular avatar in
brand-soft with initials.

MAIN: page title "Ангийн самбар" and the muted line "Дэлбээ бүлэг · 2026.09.03",
then the same five card bands as the phone version but laid out wider: the
attendance dial and gender donut as two cards in the top row, the weekly
attendance bar chart full width beneath, then birthdays and survey side by side,
then the latest class-board post as a wide card with its photograph on the left
and text beside it, then today's menu.

The content column is capped at 1400px and centred in the space the sidebar
leaves — it must not run flush to the right edge of the window.

Bottom right, floating above everything: a circular brand-blue chat button with
a message icon and a small red unread badge.
```

---

## Prompt 3 — Хүүхдүүд (child roster), phone

```
[paste Block 0 first]

Render an iPhone-sized screen, 390x844, portrait, no device bezel.

SCREEN: the child roster, "Хүүхдүүд".

TOP: the same white app header as before — logo mark, "Бяцхан нүүдэлчид" /
"Багшийн хэсэг", bell with red badge.

HEADER BLOCK: title "Хүүхдүүд" large semibold, muted lede "Хариуцсан бүлгийн
хүүхдүүд." Beneath it a row of wrapped action buttons: two secondary outline
buttons and one solid brand-blue primary button reading "Хүүхэд бүртгэх" that
has wrapped onto its own second line.

SEARCH: a full-width 48px rounded input with a magnifier icon on the left and
the placeholder "Нэр эсвэл овгоор хайх".

FILTERS: a wrapping row of small labelled dropdown fields — "Бүлэг", "Хүйс",
"Эрэмбэ" — each with a visible label above the control.

COUNT STRIP: two small tiles side by side showing a number and a muted caption
each.

LIST: six white cards stacked with 12px gaps, each 14px-rounded with a hairline
border. Each card: a circular child photograph on the left, then the child's
Mongolian name in semibold ink, and under it a muted line with the group name
and age, e.g. "Дэлбээ бүлэг · 4 нас". A faint chevron on the right edge.

BOTTOM: the same five-tab bar, with "Цэс" and the others inactive and no tab
highlighted (this screen is reached from the menu drawer).
```

---

## Prompt 4 — Шинэ ажиглалт (new observation form), phone

```
[paste Block 0 first]

Render an iPhone-sized screen, 390x844, portrait, no device bezel. The screen is
scrolled to show the whole form, so render it as a tall single column.

SCREEN: the observation form, "Шинэ ажиглалт". This is a full page, never a
modal — the teacher writes several paragraphs here, so the text areas must look
generous.

TOP: a small back link, then the page title "Шинэ ажиглалт".

FORM, as a single white card with 18px radius, containing labelled fields
separated by soft #f1f5f9 dividers. Every field has a visible label ABOVE it —
never a placeholder used as a label.

1. "Ажиглалтын төрөл" — a select control showing "Өдөр тутмын ажиглалт", with a
   small red asterisk marking it required.
2. "Огноо" — a date input showing 2026.09.03, required.
3. "Үйл ажиллагааны нэр" — a single-line text input.

Then a section heading in semibold ink: "Юу болсон бэ?"
4. "Нөхцөл байдал" — a multi-line textarea about four lines tall, showing the
   faint placeholder "Хаана, хэзээ, ямар нөхцөлд болсон бэ?"
5. "Хүүхэд юу хийсэн бэ?" — a four-line textarea.
6. "Хүүхэд юу хэлсэн бэ?" — a four-line textarea.

Then a section heading: "Багшийн дүгнэлт"
7. "Тайлбар" — a four-line textarea.
8. "Дараагийн алхам" — a three-line textarea.

Then a photo area: a dashed-border rounded drop zone with a camera icon and the
muted line "Хүсвэл зураг хавсаргана уу.", with two small square photo thumbnails
already added beside it, each with a tiny remove ✕ in its corner.

Then a section heading: "Хэн харах вэ?"
9. A checkbox row, checked, in brand blue: label "Эцэг эх харах боломжтой",
   with smaller muted description underneath "Тэмдэглэхгүй бол зөвхөн багш нар
   харна."
10. A second checkbox row, unchecked: "Цахим хувийн хавтасны PDF-д оруулах".

BOTTOM of the form: a full-width solid brand-blue #1d4ed8 button, 48px tall,
12px radius, reading "Хадгалах".

Above the bottom tab bar, show a small faint auto-save note.

BOTTOM: the standard five-tab bar.
```

---

## Prompt 5 — Явцын үнэлгээ (assessment grid), desktop

```
[paste Block 0 first]

Render a desktop browser screen, 1440x900, no browser chrome.

SCREEN: the group assessment sheet, "Явцын үнэлгээ". This is the densest and
fastest screen in the product — it must read as efficient, not decorative.

LEFT: the same 244px white sidebar as the dashboard, but with "Явцын үнэлгээ"
as the highlighted active row inside the "Хүүхдийн хөгжил ба үнэлгээ" section —
brand-soft background, brand-blue semibold text, 3px brand bar on its left edge.

TOP: the sticky white header with the "Дэлбээ бүлэг" chip, bell and avatar.

MAIN:
- Title "Явцын үнэлгээ", muted lede "Дэлбээ бүлэг".
- A control row of two labelled selects side by side: "Улирал" showing "I
  улирал", and "Хөгжлийн чиглэл" showing "Хэл яриа, харилцаа", with a small
  muted hint under the second reading "Нэг удаад нэг чиглэлээр үнэлнэ."
- A progress strip: a thin horizontal bar showing about 60% filled, with the
  caption "21 / 35 хүүхдийг үнэлсэн", and beside it four small rounded chips
  showing the level names and their counts, each chip in a different tint from
  a light-to-strong ramp.
- A section heading "Хэл яриа, харилцаа".
- THE GRID: a white card containing 8 visible child rows. Each row has, on the
  left, a small circular photograph and the child's Mongolian name in semibold;
  on the right, a horizontal segmented control of four pill-shaped buttons
  reading "Дэмжлэгтэй", "Хөгжиж буй", "Хүрсэн", "Давсан". In each row exactly
  one pill is selected, and the selected pill is filled with a tint that gets
  stronger from left to right across the four options — pale mint for the first,
  through to solid brand blue for the last. Unselected pills are white with a
  hairline border and muted text.
  Show 5 rows with a selection and 3 rows with nothing selected.
- A sticky save bar at the bottom of the card: on the left the muted text
  "5 өөрчлөлт хадгалаагүй байна", on the right a ghost "Болих" button and a
  solid brand-blue "Хадгалах" button.

Bottom right, the floating circular brand-blue chat button.
```

---

## Prompt 6 — Ирц (attendance register), phone

```
[paste Block 0 first]

Render an iPhone-sized screen, 390x844, portrait, no device bezel.

SCREEN: the daily attendance register, "Ирц".

TOP: the standard white app header with logo, "Багшийн хэсэг", and the bell.

HEADER BLOCK: title "Ирц", muted lede "Дэлбээ бүлэг".

CONTROL: a labelled date field "Огноо" showing 2026.09.03, full width, 48px
tall, with a calendar icon.

REGISTER: a white 18px-rounded card headed "Бүлгийн ирц", containing six child
rows separated by soft dividers. Each row: a circular child photograph, the
child's Mongolian name in semibold, and beneath the name a horizontally
scrollable row of six small pill buttons reading "Ирсэн", "Хагас өдөр",
"Чөлөөтэй", "Өвчтэй", "Тасалсан", "Бусад". In each row one pill is selected and
filled — "Ирсэн" filled mint #bfe8d4 with dark green text, "Өвчтэй" filled peach
#f8d5c2, "Тасалсан" filled pale red #fdeceb with #c0392b text — and the rest are
white with hairline borders and muted text. Show four rows marked "Ирсэн", one
"Өвчтэй", one "Чөлөөтэй".

A sticky save bar at the foot of the card with a ghost "Болих" and a solid
brand-blue "Хадгалах".

BELOW THE CARD: a second white card headed "Эцэг эхийн мэдэгдэл", containing two
pending request rows. Each row: a child's name, a muted line of reason text, and
two small buttons — a solid brand-blue "Батлах" and an outline "Татгалзах".

BOTTOM: the standard five-tab bar, no tab active.
```

---

## Prompt 7 — Хүүхдийн хуудас (child record), phone

```
[paste Block 0 first]

Render an iPhone-sized screen, 390x844, portrait, no device bezel.

SCREEN: one child's record.

TOP: the standard white app header.

HERO: a white 18px-rounded card. A large circular child photograph, beside it
the child's Mongolian name in large semibold, and under it two muted lines: the
group name and the age, and a small rounded chip showing enrolment status. A
small peach-tinted health-alert chip sits in the corner.

ACTION ROW: a solid brand-blue button "Ажиглалт", an outline button "Цахим
хувийн хавтас", and a small square outline overflow button showing three dots.

TABS: a four-tab horizontal strip, evenly spaced, labels "Ерөнхий" (active,
brand-blue text with a 2px brand-blue underline beneath it), "Өсөлт", "Эрүүл
мэнд", "Аюулгүй байдал". Inactive labels muted.

CONTENT under the active "Ерөнхий" tab, as stacked white cards:
1. "Хувийн мэдээлэл" — four label/value rows in two columns: birth date, sex,
   national id (masked), first day at kindergarten.
2. "Асран хамгаалагч" — two rows, each with small circular avatar initials, a
   name in semibold, a muted relation label, and a small phone icon button.
3. "Сүүлийн ажиглалт" — three compact rows, each a date, a one-line summary, and
   a tiny "Эцэг эх харна" chip on the ones visible to parents.

BOTTOM: the standard five-tab bar.
```

---

## Prompt 8 — Хүүхдүүд (roster), desktop — optional

```
[paste Block 0 first]

Render a desktop browser screen, 1440x900, no browser chrome.

Same 244px sidebar and sticky header as the dashboard prompt, with "Хүүхдүүд"
as the active sidebar row.

MAIN: title "Хүүхдүүд", muted lede "Хариуцсан бүлгийн хүүхдүүд.", with the
action buttons right-aligned on the title row — two outline buttons and a solid
brand-blue "Хүүхэд бүртгэх".

Below: a full-width search input, then a single row of four labelled filter
selects — "Бүлэг", "Хүйс", "Хамгийн бага нас", "Эрэмбэ".

Then a responsive grid of child cards, three per row, nine visible. Each card is
white, 18px radius, hairline border, with a circular photograph, the child's
Mongolian name in semibold, and a muted line beneath with group and age.

At the foot, a simple pagination control.

The content column is capped at 1400px and centred — not flush to the window
edge.

Bottom right, the floating circular brand-blue chat button.
```

---

## Tips for the ChatGPT round trip

- Generate **Block 0 + one prompt at a time**. Batching produces mush.
- If the output looks like a generic dark SaaS dashboard, add to the prompt:
  *"light background #f8fafc, white cards, no dark theme, no navy header, no
  purple, warm and friendly not corporate."*
- If cards stretch edge to edge on the desktop shots, add: *"content is a
  centred 1400px column with visible empty margin on both sides."*
- To iterate on one image, ask for a variation rather than a fresh generation —
  it keeps the palette.
- Once a layout is right, ask ChatGPT for the same screen as **HTML + Tailwind**;
  that is where you get correct Mongolian text.
