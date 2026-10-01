# verify.mn — integration reference

Phone-ownership proof for three flows (password reset by phone, a guardian's
phone on an invitation, changing one's own phone). Written 2026-10-01.

★ **Not yet exercised against the live service.** No `VERIFY_MN_API_KEY`
existed when this was built, so every test stubs `VerifyMnClient`. The contract
below is read from https://verify.mn/ (its "AI code agent" section, the most
literal description the page gives). The first live run is the outstanding
step: see **Trying it live** below.

## How it works

1. Our server calls `POST https://api.verify.mn/sessions` with
   `{ phone, text }`. The text is a fresh random six-digit code. No `callback`
   is sent.
2. verify.mn answers `{ sessionId, phone, shortcode: "144773", text, smsUri,
displayInstruction, expiresAt }`. The TTL is five minutes.
3. The person sends `text` from `phone` to 144773. On a phone, `smsUri`
   (`sms:144773?body=…`) opens the SMS app with the message written.
   `displayInstruction` is shown verbatim, because it names the number to send
   from. Sending from another SIM is the commonest failure.
4. The browser polls our `POST /phone-verifications/check` every 3 s. Our
   server calls `GET https://api.verify.mn/sessions/:id`, at most once per 3 s
   per row, and treats `sessionStatus === "VERIFIED"` as the proof.

| Endpoint            | Auth           | Errors                                                  |
| ------------------- | -------------- | ------------------------------------------------------- |
| `POST /sessions`    | `Bearer vrf_…` | 400 validation, 401 bad key, 409 same phone+text active |
| `GET /sessions/:id` | **none**       | 404 unknown                                             |

`sessionStatus` is one of `PENDING`, `VERIFIED` or `EXPIRED`.

## Decisions

- **No callback.** It is an unsigned GET, a wake-up signal that verify.mn
  itself says to re-check against `GET /sessions/:id`. Polling is the proof
  either way. The callback would also add a public route and a public URL
  setting, and local development could not receive it.
- **The session id stays on the server.** `GET /sessions/:id` needs no key, so
  the id is a capability. The browser gets its own handle instead.
- **`responseSms` is not set.** Their reference says carriers handle it
  inconsistently: Unitel replaces it, and Lime sends no reply at all. The
  result is shown from `sessionStatus`, never from a reply SMS.
- **Pricing:** the sender pays 150₮ per SMS to their carrier, matched or not.
  The operator is credited 40₮ per verified phone on the verify.mn dashboard.
  The UI says the price before the person sends anything, and stops polling
  the moment the status settles.

## Code

| File                                                      | Role                                        |
| --------------------------------------------------------- | ------------------------------------------- |
| `apps/api/src/integrations/verify-mn/verify-mn.config.ts` | `isConfigured` — the key alone              |
| `apps/api/src/integrations/verify-mn/verify-mn.client.ts` | the two calls; never logs the key or the id |
| `apps/api/src/integrations/verify-mn/verify-mn.types.ts`  | response schemas, `.passthrough()`          |
| `apps/api/src/phone-verification/`                        | binding, throttle, single use               |
| `apps/web/components/auth/phone-verification.tsx`         | the step, shared by three screens           |

## Trying it live

1. Put the key in the root `.env` as `VERIFY_MN_API_KEY=vrf_…` and restart
   the api.
2. `GET /v1/phone-verifications/availability` should answer
   `{ "enabled": true }`.
3. On a phone, open `/forgot-password` → «Утсаар», enter a number that is
   on an account, and tap «SMS бичих».
4. Things to watch on that first run:
   - Do the response field names match the schemas? A mismatch surfaces as
     `VerifyMnError("invalid_response")` in the api log and as "SMS
     баталгаажуулалт түр ажиллахгүй байна" on screen.
   - Does iOS prefill the body from `sms:144773?body=…`? Older iOS wanted
     `&body=`.
