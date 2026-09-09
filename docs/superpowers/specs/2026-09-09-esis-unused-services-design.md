# ESIS — the unused seven, a row that opens, and tables that fit

**Date:** 2026-09-09
**Status:** approved by the client in conversation, 2026-09-09
**Touches:** `apps/api/src/integrations/esis/`, `apps/web/components/esis/`,
`apps/web/components/menu/`, four screens

---

## 1. What this is

Twenty-two ESIS services are in `ESIS_ENDPOINTS`. Fifteen are drawn on a
screen. **Seven have never been placed**, so a token scoped to them buys
nothing:

| Key                    | ID / slug        | Path                             | Params      |
| ---------------------- | ---------------- | -------------------------------- | ----------- |
| `studentMovements`     | `2`              | `student/movement/v2/:beginDate` | `beginDate` |
| `foodProductTypes`     | 111 · API-000210 | `cook/product/type`              | —           |
| `foodMaterialGroups`   | 112 · API-000211 | `cook/materialGroup`             | —           |
| `foodMaterials`        | 123 · API-000222 | `cook/material`                  | —           |
| `foodProductMaterials` | 125 · API-000224 | `cook/productMaterials`          | —           |
| `foodKit`              | 126 · API-000225 | `cook/kit/:productId`            | `productId` |
| `foodKitProducts`      | 127 · API-000226 | `cook/kit/product/:productId`    | `productId` |

All seven already carry a `PORTAL`-verified field list (`esis.fields.ts`) and
demo rows (`esis.samples.ts`). Nothing about the catalog needs inventing —
this is a grant, a placement and two pieces of UI.

Three client requests are being satisfied at once, and they turn out to be one
piece of work:

1. "тогоочид хамаарах бусад API-уудыг дууд ашигла"
2. "жагсаалт харах дээр дандаа жагсаалт гэсэн api-ууд. дээр нь дарахад
   дэлгэрэнгүй ерөнхий мэдээлэл байх"
3. "хүснэгтүүдийг зүгээр энгийн харагдуул. хажуу тийшээ scroll ntr хийхгүй"

(2) and (3) are the same change seen from two sides, which is the reason they
are specified together — see §4.

---

## 2. The role grant

`esis.catalog.ts`'s `ROLE_SERVICES[Role.COOK]` is `["foodProducts"]`. It
becomes the cook's seven:

```ts
[Role.COOK]: [
  "foodProductTypes",
  "foodMaterialGroups",
  "foodMaterials",
  "foodProducts",
  "foodProductMaterials",
  "foodKit",
  "foodKitProducts",
],
```

`studentMovements` needs **no grant**. `ADMIN` already resolves to `ALL_KEYS`,
so it has always been callable; it simply had no screen. It stays admin-only —
a transfer register is the director's question, not a teacher's, and
`EsisDataPanel` renders nothing for a role whose catalog omits the key, so
placing it on a shared screen is safe.

The catalog comment that says "the other six food services stay off this list
until they are asked for" is replaced rather than deleted: they were asked for,
on 2026-09-09, and the note records that.

---

## 3. Where each panel lands

| Screen                  | Panels added                                                                 |
| ----------------------- | ---------------------------------------------------------------------------- |
| `/kitchen/ingredients`  | `foodMaterialGroups` (түүхий эдийн бүлэг), `foodMaterials` (түүхий эд)       |
| `/kitchen/recipes`      | `foodProductTypes` (бүтээгдэхүүний төрөл), above the existing `foodProducts` |
| `/kitchen/recipes/[id]` | `foodProductMaterials` (бүтээгдэхүүний орц)                                  |
| `/children`             | `studentMovements` (суралцагчийн хөдөлгөөн)                                  |

`foodKit` and `foodKitProducts` get **no panel of their own**, deliberately.
Both take `:productId`, and `EsisDataPanel`'s answer to a missing path
parameter is to ask the reader to type it. A cook typing a ministry product
code into a box is not a feature. They are reachable only as the drill-down
target of a `foodProducts` row, which supplies the id — §4.

---

## 4. One table shape: few columns, and a row that opens

### The problem

`esis-rows.tsx` sets a floor of `min-w-[720px]`, `min-w-[1400px]` or
`min-w-[2400px]` by column count, so a 27-column staff table scrolls sideways
by construction. The client asked for that to stop. But the columns cannot
simply be dropped — they are what the service carries, and the panel exists to
show what ESIS holds.

### The shape

A list shows **at most five columns**; the whole record is one click away.

- `TableShell` is given `minWidth="min-w-0"` and `tableClassName="table-fixed"`,
  with truncating cells, so it fits whatever width it has. `rowTableWidth` is
  deleted.

  ★ `tableClassName` is a **new prop**, and the reason is a bug this spec
  originally shipped: `TableShell`'s existing `className` lands on the wrapping
  `Card`, not the `<table>`. `table-fixed` passed there does nothing, the table
  falls back to auto layout, and `truncate` on the cells stops ellipsing and
  starts widening — handing the sideways scroll straight back to
  `overflow-x-auto`. The test asserts on the `<table>` element for that reason,
  not on the component's props.

- `esisSampleColumns` keeps returning every field. A new `esisVisibleColumns`
  helper takes the first five for the table; the row's own expansion renders
  **all** of them.
- Clicking a row toggles a full-width `<tr>` underneath it containing
  `EsisRecordFields` — the existing stacked label-above-value layout, already
  responsive and already how a single record is drawn. So "дэлгэрэнгүй" is not
  a new visual language; it is the one-record view the component already has,
  reached from a row.

That is why (2) and (3) are one change: the fields that no longer fit across
are exactly the fields the drill-down exists to show.

### Rows that already lead somewhere

`/children`'s roster passes `hrefs` so a row opens that child's page. That
behaviour is unchanged and takes precedence: where `hrefs` is given the row
navigates, and where it is not the row expands. A row never does both.

### The nested drill-down

A new optional prop carries the second half of the client's sentence — the
detail is sometimes _another service_, not just more columns:

```ts
detail?: {
  /** Services to read for the opened row. */
  resources: EsisResourceKey[];
  /** The row field whose value fills their path parameter. */
  param: { name: string; from: string };
};
```

`/kitchen/recipes` passes
`{ resources: ["foodKit", "foodKitProducts"], param: { name: "productId", from: "productId" } }`
on its `foodProducts` panel. Opening "Цуйван" reads `cook/kit/5201` and
`cook/kit/product/5201` for that row and nothing else — one press, one call,
per `EsisDataPanel`'s existing `refetchOnWindowFocus: false` discipline.

The nested panels take a new `compact` prop — a heading and the records, and
none of the page furniture. Without it the drill-down renders a _second
complete panel_ inside a table cell (icon, `<h2>`, slug/ID/path line, record
badge, pull button, footer disclaimer), twice over for the two detail services:
a page inside a page, on the screen whose instruction was "зүгээр энгийн
харагдуул". There is no pull button on a compact panel because there is nothing
to press — `autoRead` has already run for the id the row supplied.

★ **In demo mode the nested read never fires** (`canRead` is false), so opening
"Цуйван" (`5201`) shows `foodKit`'s canned row for `5245`. That is demo data
presented as _this record's_ detail, a stronger claim than a demo list panel
makes. It is left as-is, consistent with the client's 2026-09-08 decision to
drop the demo badge entirely, and recorded here rather than discovered on the
server.

---

## 5. "Бэлэн хоол сонгох" — the menu's dish picker

`menu-dish-editor.tsx` offers a dish two ways today: free text, or a local
`APPROVED` технологийн карт (`useRecipe`). A third mode joins them —
**ESIS-ийн бэлэн бүтээгдэхүүн**.

Picking one fills the dish's `name`, `calories` and `ingredients` from the
`foodProducts` row, and leaves `recipeId` empty: an ESIS product is not one of
this kindergarten's recipe cards, and writing a foreign id into `recipeId`
would point the menu at a row that does not exist.

`DishDraft` gains no persisted field. The mode is UI-only, exactly as
`useRecipe` is — `fromDraft` still emits the same `saveMenuDaySchema` payload,
so nothing about the meals contract changes and a dish saved from ESIS is
indistinguishable from one typed by hand. That is the point: the ministry's
reference is where the cook _reads_ the calories, not a foreign key the menu
carries forever.

The picker is offered only where the recipe picker already is — behind the
`kitchen` prop, so a teacher's menu form is unchanged.

---

## 6. Tests

`esis-admin.test.ts` already asserts role scoping. Added:

- a cook's catalog contains all seven food services and **no** roster service
- a teacher's catalog contains none of the six newly granted keys
- a parent gets 404 from `/esis/catalog` (unchanged, re-asserted)
- `foodKit` is refused to a role that does not hold it, through HTTP (§4.1)

Web:

- `esis-rows` renders at most five columns, and the `<table>` itself carries
  `min-w-0` + `table-fixed` and no `min-w-[` floor
- clicking a row reveals every field, including ones absent from the table
- opening a row reads the detail service, and renders it compact — one pull
  button and one footer on the screen, not three
- a row with an `href` navigates and does **not** expand

---

## 7. Deliberately not in this spec

- **Chat image/video upload.** A separate conversation: `MediaFile`'s pipeline
  is sharp-only, and video needs a format policy, a size ceiling, a poster
  frame and disk the VPS may not have.
- **API-000172 (хүүхэд бүртгэх) and the family-save services.** Blocked on the
  client supplying method, path, parameters and response fields from the
  developer portal — the public `/api/structure` truncates before the
  суралцагч block, so they cannot be verified from here. `studentInfo`'s
  `ADAPTER` note records the same limitation.
- `POST cook/form1|form2 …/save`. Still read-only, for the reason
  `esis.endpoints.ts` already gives: nothing here files a school's income
  return.
