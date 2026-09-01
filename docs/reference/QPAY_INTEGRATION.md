# QPAY_INTEGRATION.md — the online-payment boundary (нэмэлт.md §8)

**Status:** ★ **Exercised against the live merchant account, 2026-09-01.**
Credentials arrived that day (`ӨВ БЯЦХАН НҮҮДЭЛЧИД`, invoice code
`NOMADKIDS_INVOICE`) and the flow was run end to end on the staging VPS.

What §1 below called assumed is now observed:

```
QPay POST /v2/auth/token    → 200 (423ms)
QPay POST /v2/invoice       → 200 (118ms)   → EMV QR + 10 KB PNG
QPay POST /v2/payment/check → 200  (55ms)   → correctly reports NOT paid
```

Every field name in §1 is confirmed: `invoice_code`, `sender_invoice_no`,
`invoice_receiver_code`, `amount`, `callback_url` on the request;
`invoice_id`, `qr_text`, `qr_image` on the response. `QPAY_BASE_URL` carries
**no** `/v2` — the client appends it, and the onboarding mail's
`https://merchant.qpay.mn/v2/auth/token` confirms the split.

★★ **One correction the live account forced.** QPay's own mail says to base the
token's life on a timestamp — "Token-ийн хугацааг timestamp-д тулгуурлан" — and
`expires_in` on this API is an absolute epoch, not the duration the name
implies. This client read it as seconds-from-now, which cached the token until
the year 58,000: correct until QPay expired it server-side, then 401 on every
call until a restart. `tokenExpiryMs` now accepts both readings. See its own
comment.

**Still not exercised:** a payment actually being made. The QR was generated and
`checkPayment` correctly reported it unpaid; nobody has scanned one, so the
callback and the `reconcile` → `AccessSubscription.markPaid` path remain
unproven against real money.

---

## 0. What this is and is not

This is the QPay counterpart to `docs/ESIS_REQUEST.md` — but the two are
different situations, not the same document twice.

ESIS is a ministry system with no public API documentation; the request
document is a literal draft letter, because getting the contract shape at all
requires a signed data-sharing agreement first. QPay is a commercial payment
gateway with a public API (`developer.qpay.mn`) — no agreement is needed to
read the contract, only to get a merchant account that can call it for real.
So instead of a request draft, this file records what was implemented against
the public documentation and what is still unverified.

---

## 1. The assumed API shape

QPay's v2 "Simple" merchant API, base URL `QPAY_BASE_URL`:

| Call            | Method + path         | Auth                          | Used for                                    |
| ---------------- | ---------------------- | ------------------------------ | -------------------------------------------- |
| Token exchange   | `POST /v2/auth/token`  | `Authorization: Basic` (user:pass) | Getting a bearer token — `QpayClient.getAccessToken` |
| Create invoice   | `POST /v2/invoice`     | `Authorization: Bearer`       | Starting a payment — `QpayClient.createInvoice` |
| Check payment    | `POST /v2/payment/check` | `Authorization: Bearer`     | Confirming payment — `QpayClient.checkPayment` |

Request/response fields this codebase actually reads are declared as Zod
schemas in `apps/api/src/integrations/qpay/qpay.types.ts`, with
`.passthrough()` so an unknown extra field cannot break parsing — only a
missing or renamed field this code depends on can, and it does so loudly (a
`QpayError("invalid_response", …)`), not as a silently wrong amount credited
to the wrong invoice.

**What is genuinely unverified:** whether these exact field names, this exact
auth flow, and this exact base URL are still current. QPay's documentation
has had at least one major revision (v1 → v2) and nothing here has been
checked against a real response.

---

## 2. The reconciliation model — the part that does not depend on the guess above

Regardless of whether every field name in §1 is exactly right, the safety
property this integration relies on does not depend on it:

**The callback's own request body is never trusted for amount or status.**
QPay calls `QPAY_CALLBACK_URL` after a payment, but that call only tells this
system *which* `qpay_invoice_id` to go check — `QpayCallbackController`
extracts an id from a handful of plausible field names (query or body; the
exact one QPay uses is itself unconfirmed) and does nothing else with the
payload. The actual question — "was this paid, and for how much" — is always
answered by calling `checkPayment` back to QPay directly, authenticated with
this deployment's own credentials. A forged callback can, at worst, trigger a
status check that finds nothing to credit.

**Two triggers, one idempotent path.** A parent's browser polls
`GET /children/:id/invoices/:invoiceId/qpay` while the QR is on screen; QPay's
webhook calls `POST /qpay/callback` independently. Both end up in
`QpayService.reconcile`, and `QpayRepository.claimForPayment` — a single
`UPDATE … WHERE status = 'PENDING'` — guarantees only one of them ever creates
the real `Payment` row, even if both observe QPay's `checkPayment` as PAID at
the same moment. See that method's own comment for why the claim has to
happen *before* the `Payment` is created, not after.

**A kindergarten with no public callback URL still works.** `QPAY_CALLBACK_URL`
must be a real public HTTPS endpoint (QPay's servers cannot reach
`localhost`), but polling alone reconciles correctly — the callback is a
latency optimisation, not a correctness dependency.

---

## 3. What is genuinely NOT built

- **SocialPay, bank transfer gateways, "Бусад" gateway** — нэмэлт.md §8 names
  several; `Payment.method` and `InvoiceLineType` already reserve room for
  them (the enum values existed before this module), but only QPay has a
  client. Adding another gateway is a new `*.client.ts` beside this one, not a
  rewrite of anything here.
- **Refunds through the gateway.** `InvoicesService.markRefunded` is a manual,
  human decision, same as before this module — QPay's own refund API (if it
  has one at this tier) is not called.
- **A cancel-invoice call.** An expired or abandoned `QpayInvoice` row is
  marked `EXPIRED` locally; QPay is never told to cancel the invoice on their
  side. Harmless — an invoice nobody pays simply expires on their end too —
  but worth knowing if QPay's dashboard shows it as still open.

---

## 4. Configuration

`.env.example`'s QPay section is authoritative for the variable names.
Summary: `QPAY_BASE_URL`, `QPAY_USERNAME`, `QPAY_PASSWORD`,
`QPAY_INVOICE_CODE`, `QPAY_CALLBACK_URL`, `QPAY_TIMEOUT_MS`. Optional as a
set, exactly like `ESIS_*` — leave all of it empty and every existing feature
(invoices, manual CASH/BANK_TRANSFER payments) keeps working; only the
"QPay-ээр төлөх" button stops rendering. `config/env.ts` refuses a
half-configured set at boot in production, for the same reason SMTP and ESIS
do: half-configured looks configured and fails as a confusing gateway error
instead of an honest "we never set this".

To get real values: register as a QPay merchant (qpay.mn). `QPAY_USERNAME` /
`QPAY_PASSWORD` authenticate the merchant account; `QPAY_INVOICE_CODE` is
assigned during provisioning, not chosen locally. Ask specifically for
sandbox credentials before touching production ones — nothing in this
codebase has been run against either yet.

---

## 5. When real credentials arrive

1. Set `QPAY_*` in `.env` (sandbox first). `QpayService.isConfigured` flips
   true and the pay button appears on a parent's invoice.
2. Exercise the real flow once, by hand: generate an invoice, start a QPay
   payment, pay it with QPay's own test instrument (their sandbox
   documentation names one), and confirm `GET .../qpay` transitions
   PENDING → PAID without the callback (polling alone) and then again with a
   real public `QPAY_CALLBACK_URL` (a tunnel is enough for this step).
3. **Record the real response bodies here**, under a `## Confirmed responses`
   heading — the same "get the real sample before trusting the guess" step
   `docs/ESIS_REQUEST.md` describes for ESIS. If any field name in §1 is
   wrong, fix `qpay.types.ts`'s schemas; the `invalid_response` error from
   step 2 will have already said which one.
4. If SocialPay or a bank gateway is requested next, it is a new client
   beside `qpay.client.ts`, not a change to `QpayInvoice` — the schema's
   `PaymentMethod` enum already has room.
