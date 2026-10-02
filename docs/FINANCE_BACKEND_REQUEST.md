# Finance — backend request (2026-10-02)

The «Санхүү» screen (`/finance`) was rebuilt as tabs at the client's request:
Төлбөрийн үлдэгдэл · Төлбөрийн нэхэмжлэл · Гүйлгээ · Жилийн тайлан · Маягт ·
Санхүүжилт.

**The frontend is finished.** Three pieces of it call routes that do not exist
yet. Until they do, each one shows a "coming soon" message on a 404, not an
error, so the screen can ship now. Once the routes exist, the screens fill in
with no frontend change, **provided the shapes below are kept exactly**.

| §   | What                              | Frontend file (already written)                     | Priority |
| --- | --------------------------------- | --------------------------------------------------- | -------- |
| 1   | Payments ledger + Excel           | `apps/web/components/finance/transactions.tsx`      | High     |
| 2   | File ESIS food-income forms 1 & 2 | `apps/web/components/finance/esis-forms.tsx`        | High     |
| 3   | ~~ESIS status on the finance roster~~ ✅ #162 | `apps/web/components/finance/payment-report.tsx`    | Medium   |

Every route below is tenant-scoped, readable by `ADMIN` and `ACCOUNTANT` only
(the same gate as `/kindergartens/:id/invoices`), paginated where it lists,
and goes through a repository with the base filter (CLAUDE.md §2.2, §3.4).
Money is a **string** with two decimals, as everywhere else in the finance
module. The response shapes are declared in the frontend files with zod.
When a route ships, move its schema into `@kinder/contracts`, and the
frontend will import it from there.

---

## 1. Payments ledger — «Гүйлгээ» tab

Every `Payment` row of one kindergarten over a date range, newest first, with
four totals at the head of the tab: Нийт орлого, Нийт зарлага, Цэвэр
үлдэгдэл, Гүйлгээний тоо. Today a payment can only be seen inside its invoice
(`GET /invoices/:id`).

### `GET /kindergartens/:id/payments`

| Query      | Type                                    | Notes                                                   |
| ---------- | --------------------------------------- | ------------------------------------------------------- |
| `from`, `to` | `YYYY-MM-DD`, both required, inclusive | Filters on the day the payment was **recorded** (`createdAt`, Ulaanbaatar time). The UI defaults to the 1st of this month → today. Refuse a range over 366 days with 400 |
| `groupId`  | uuid, optional                          | The child's current group                               |
| `method`   | `PaymentMethod`, optional               | `CASH`, `BANK_TRANSFER`, `QPAY`, `SOCIALPAY`, `OTHER`   |
| `kind`     | `PAYMENT` \| `REVERSAL`, optional       | `REVERSAL` = a row with `reversalOfId` set              |
| `q`        | string, optional                        | Child's last/first name, registration number or invoice `number`, case-insensitive |
| `page`, `pageSize` | standard                        | UI sends `pageSize=25`; cap at 100                      |

Response — `paginated(...)` **plus a `summary`**:

```jsonc
{
  "items": [
    {
      "id": "uuid",
      "kind": "PAYMENT",              // "REVERSAL" when reversalOfId is set
      "amount": "-12500.00",          // negative on a reversal row, as on Payment
      "method": "CASH",
      "note": null,                   // shown in «Утга» after the invoice number
      "voidedAt": null,               // set on the original when it is voided
      "createdAt": "2026-10-05T03:00:00.000Z",
      "invoice": { "id": "uuid", "number": "INV-7 | null", "month": "2026-10" },
      "child": {
        "id": "uuid", "lastName": "… | null", "firstName": "…",
        "registrationNumber": "ТА22010101 | null",
        "group": { "id": "uuid", "name": "…" }   // or null — same rule as the invoice register
      }
    }
  ],
  "page": 1, "pageSize": 25, "total": 1, "totalPages": 1,
  "summary": {                        // over EVERY matching row, not the page
    "income": "130000.00",            // sum of amount (reversals are negative, so they net out)
    "expense": "0.00",                // always "0.00" until an expense module exists
    "net": "130000.00",               // income − expense
    "count": 4                        // = total
  }
}
```

Compute `summary` with one aggregate query (`SUM`/`COUNT` under the same
`WHERE`), not by loading the rows.

- **Include voided payments and their reversal rows.** Do not filter them out.
  The finance rules (CLAUDE.md §7, нэмэлт.md §14) forbid deleting a confirmed
  payment, and the reader must see the void and its reversal side by side.
- **Exclude the portal access fee.** QPay access-fee payments write no
  `Payment` row (CLAUDE.md §7, §8), so nothing should be needed here. Confirm
  it anyway.
- **One query with `select`/`include`.** No per-row lookups (N+1).

### `GET /kindergartens/:id/payments/export`

Same query parameters, no pagination, returns an `.xlsx` file. Follow
`invoices/export` (`invoice-register-workbook.ts`). The UI links to it
directly, so the browser's session cookie authenticates the download.

### Tests

- Authorization over HTTP (CLAUDE.md §4.1):
  - a teacher gets 404;
  - a guardian gets 404;
  - another kindergarten's admin or accountant gets 404.
- Pagination: no unbounded list.
- A voided payment and its reversal both appear in the list.

---

## 2. File ESIS food-income forms 1 and 2 — «Маягт» tab

The tab already **reads** both forms from ESIS (`livelihoodForm1` API-000229
and `livelihoodForm2` API-000231). The client now wants to **file** them from
our own ledger. The two ESIS write services are already in
`esis.portal-snapshot.json`, but nothing calls them yet:

| Our key (proposed)     | ESIS id | ESIS service                                       |
| ---------------------- | ------- | -------------------------------------------------- |
| `livelihoodForm1Save`  | 129 / API-000228 | `POST /svc/api/hub/v2/cook/form1/school/livelhood/save` |
| `livelihoodForm2Save`  | 131 / API-000230 | `POST /svc/api/hub/v2/cook/form2/school/livelhood/save` |

(Note ESIS's own spelling: `livelhood`, `livelhoodDiscount`.)

ESIS payloads, from the snapshot:

- **Form 1:** `institutionId`, `academicMonth`, `studentCNT`,
  `inLivelihoodCNT`, `inLivelihoodBudget`, `inLivelihoodAmount`.
- **Form 2:** `institutionId`, `academicMonth`, `studentGroupId`, and
  `dataList[]`. Each `dataList` entry has `personId`, `comingDays`,
  `arrivalDays`, `amountDue`, `amountPaid`, `livelhoodDiscount`.

The tab draws the draft as the paper return: a title, `(Маягт - 1)`, the
table, and signature lines for the director and the budget officer. It prints
from the browser, and its Excel is built client-side from the draft. So the
draft is the only thing it needs.

`esis.endpoints.ts` and `esis.catalog.ts` both refused these writes because
"nothing in this product is yet the thing that files it". **That condition is
now met:** there is a screen that previews and files the forms. Update those
comments when you add the services.

### Design: the API composes the figures, the user only confirms

The accountant types nothing. The API computes both forms from our invoices,
payments, attendance and the ESIS food-discount list
(`funding/food-discount.ts`). The UI shows that draft and sends it after one
confirmed press. This reuses the `EsisWriteRequest` pattern (spec №3б):

1. Store the payload **before** sending.
2. Send exactly those bytes.
3. Keep ESIS's answer.

`EsisWriteRequest.groupId` is required today, but Form 1 has no group. Make it
nullable for these two services, or add a separate table. Your choice.

### `GET /kindergartens/:id/finance/esis-forms/form1/draft?month=YYYY-MM`

```jsonc
{
  "month": "2026-10",
  "orgName": "Нийслэлийн 115-р цэцэрлэг", // printed in the title and the «Байгууллагын нэр» cell
  "studentCnt": 83,               // → studentCNT
  "livelihoodCnt": 65,            // → inLivelihoodCNT
  "livelihoodBudget": "1250000.00", // → inLivelihoodBudget (what should be collected)
  "livelihoodAmount": "980000.00",  // → inLivelihoodAmount (what was collected)
  "lastSubmittedAt": "ISO | null"   // last SENT form-1 write for this month
}
```

### `GET /kindergartens/:id/finance/esis-forms/form2/draft?month=YYYY-MM&groupId=uuid`

```jsonc
{
  "month": "2026-10",
  "orgName": "Нийслэлийн 115-р цэцэрлэг",
  "groupId": "uuid",
  "groupName": "Дунд бүлэг",
  "rows": [
    {
      "childId": "uuid", "lastName": "… | null", "firstName": "…",
      "comingDays": 22,           // school days the child was due
      "arrivalDays": 19,          // days attended
      "amountDue": "90000.00",
      "amountPaid": "50000.00",
      "livelihoodDiscount": "10000.00"
    }
  ],
  "lastSubmittedAt": "ISO | null"
}
```

`groupId` is required for Form 2. If the group has no `esisGroupId`, or a
child has no `esisPersonId`, answer **400 with a Mongolian `detail`** that
names the missing link. Do not send a row ESIS cannot place. The UI shows
`detail` as is.

### `POST /kindergartens/:id/finance/esis-forms/{form1|form2}/submit`

Body: `{ "month": "YYYY-MM" }` for Form 1, `{ "month", "groupId" }` for Form 2.

The server rebuilds the draft, stores the request, sends it and returns:

```jsonc
{ "status": "SUCCEEDED" | "FAILED", "errorCode": null, "message": null, "submittedAt": "ISO" }
```

ESIS refusing the form is **200 with `status: "FAILED"`**, the same convention
as `/esis/write`. When it fails, put ESIS's `RESPONSE_MESSAGE` in `message`;
the UI shows it. Write an `AuditLog` row for every submit.

### Questions to settle before building

1. **What the figures mean.** This is the most important question; get the
   client's or the ministry's answer before writing any code.
   - Form 1 `studentCNT`: is it every active child in the month, or only
     those with an invoice?
   - Form 1 `inLivelihoodBudget` / `inLivelihoodAmount`: are they "billed" and
     "paid" for meals only, or for the whole invoice?
   - Form 2 `comingDays`: is it the kindergarten's working days in the month,
     or days the child was enrolled?
   - Form 2 `livelhoodDiscount`: is it the invoice's `discountAmount`, or only
     the meal subsidy?
2. **The `academicYear` / `academicMonth` format** ESIS expects (1–12? 9 = the
   first month of the school year?). Read one live `livelihoodForm1` response
   and copy its format.
3. **Production only.** ESIS has no test environment, so the first real
   submit changes the ministry's register. Do it together with the client
   once.
4. **Catalog grant.** Add both write services to `Role.ACCOUNTANT` in
   `esis.catalog.ts`, and to the `esisResourceKeySchema` enum in
   `@kinder/contracts`.

### Tests

- The authorization trio over HTTP, on all four routes.
- The draft totals come from fixture invoices and attendance (assert the
  numbers, not just the status).
- Submit stores the payload before calling ESIS (mock the ESIS client), and a
  FAILED answer is recorded and returned as 200.

---

## 3. ESIS status on the finance roster — «Жилийн тайлан» tab

**✅ Delivered in #162 (2026-10-01)** — `finance-roster` now sends both fields. Kept below for reference only.

This was agreed earlier and has not been delivered. The annual report has a
«Төлөв» column. It shows "—" until
`GET /kindergartens/:id/children/finance-roster` adds two fields to each
child:

```jsonc
"esisProgramStatus": "Суралцаж байгаа" | "Шилжсэн" | … | null,  // ESIS students/list → programStatusName
"esisActionDate":    "2026-09-15" | null                         // ESIS students/list → actionDate
```

Take them from the stored roster sync. **Do not call ESIS live for each
child.** Both fields are nullable, and a child ESIS does not know returns
`null`.

---

## Already done on the frontend, no backend needed

- **«Нэхэмжлэх» per group** on «Төлбөрийн нэхэмжлэл». It calls the existing
  `POST /kindergartens/:id/invoices/generate-month` with the group's children
  as `childIds`.
- **«Нийт ирц» on «Жилийн тайлан».** It is summed from the existing
  `GET …/attendance/register` in 92-day windows (`PRESENT` + `HALF_DAY`).
  - That is 4+ requests per school year. If it is slow on a large
    kindergarten, a single `GET …/attendance/attended-days?from=&to=` that
    returns `{ childId, days }[]` would replace them. Optional.

## Not in this request

- **Expense module.** It needs a new data model and a decision from the
  client, so it is not started on either side.
- **Raising invoices and recording payments.** These are unchanged and still
  happen on `/invoices`.

## When done

Tell the frontend which routes are live. The frontend will then:

- move the zod schemas into `@kinder/contracts`;
- remove the "coming soon" branches.

Run the api suite on its own, never at the same time as the web suite
(CLAUDE.md §4.4).
