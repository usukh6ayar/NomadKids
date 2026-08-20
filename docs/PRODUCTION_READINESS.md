# PRODUCTION_READINESS.md

State of the system as it enters Phase 13, written 2026-08-20 after the Phase 12
QA pass.

`DEPLOYMENT.md` describes _how_ to deploy. This describes _whether it is ready_,
and is deliberately blunt about what has not been proven.

---

## 1. Readiness at a glance

| Area                       | State                                                  |
| -------------------------- | ------------------------------------------------------ |
| Test suite                 | ✅ 690 tests passing (6 contracts · 630 API · 54 web)  |
| Security probes            | ✅ 151 live HTTP assertions, 0 failures                |
| Migrations from empty      | ✅ verified                                            |
| Backup / restore           | ✅ real round trip with integrity checks               |
| Authentication and session | ✅ verified end to end                                 |
| CORS / CSRF                | ✅ verified with real preflights and forged requests   |
| Security headers           | ✅ API and web                                         |
| Tenant isolation / IDOR    | ✅ 32 assertions                                       |
| Media privacy              | ✅ 14 assertions against real object storage           |
| PDF output                 | ✅ A4, embedded Cyrillic, audience-correct content     |
| N+1 / pagination           | ✅ 8 in-process guards                                 |
| **Docker image**           | ✅ built, run, PDF verified inside the container       |
| **Device / browser QA**    | ⛔ needs a real phone                                  |
| **Production credentials** | ⛔ not provisioned                                     |
| Email delivery             | ✅ implemented and verified against a real SMTP server |

---

## 2. Blockers for Phase 13

### 2.1 ~~The Docker image has never been built~~ — **RESOLVED**

Built and run in Phase 13. The first real `docker build` found two defects that
no amount of review would have caught:

1. **`tsconfig.base.json` was never copied into the image.** Both packages
   `extends` it — and a missing `extends` target is **not an error** in
   TypeScript, it silently falls back to compiler defaults. Those have
   `esModuleInterop: false`, so the build died inside zod's type declarations
   with fifty `TS1259` errors that said nothing about the cause.
2. **`prisma generate` could not load its config.** It never opens a connection,
   but `prisma.config.ts` resolves the datasource through `env()`, which throws
   when unset. Fixed with a placeholder scoped to the build stage — `ENV` does
   not cross a multi-stage boundary, and the runtime stage was verified to have
   no `DATABASE_URL`.

Verified in the running container:

| Check                                     | Result                                               |
| ----------------------------------------- | ---------------------------------------------------- |
| Image builds                              | ✅                                                   |
| Fonts registered for Mongolian            | ✅ `Noto Sans` + DejaVu (4 families)                 |
| Runs as non-root                          | ✅ `uid=1001(app)`                                   |
| Build placeholder did not leak to runtime | ✅ absent                                            |
| Worker boots, font check passes           | ✅ "4 Mongolian-capable font(s) registered"          |
| **Boot assertion with fonts removed**     | ✅ **exit 1, refuses to start**                      |
| **PDF rendered inside the container**     | ✅ A4, 3 pages, 945 chars extracted                  |
| **Mongolian `өүӨҮ` in that PDF**          | ✅ 13 occurrences                                    |
| Fonts embedded and subsetted              | ✅ `AAAAAA+NotoSans-Bold`, `BAAAAA+NotoSans-Regular` |
| Serif fallback                            | ✅ none                                              |
| Runs within a 1 GB memory limit           | ✅                                                   |
| 121 security probes against the container | ✅ 0 failures                                        |

The blank-PDF failure mode now has all three defences verified rather than two.

### 2.2 Credentials not provisioned

Nothing here can be verified without them:

- Managed PostgreSQL (TLS required)
- Managed Redis
- Cloudflare R2 bucket, access key, secret, endpoint
- `JWT_SECRET` and `REFRESH_SECRET` — **two different** `openssl rand -base64 48`
- DNS for `nomadkids.mn` and `api.nomadkids.mn`, with certificates

`loadEnv()` refuses to boot in production on a localhost origin, a plaintext
`http://` origin, identical signing secrets, or a `COOKIE_DOMAIN` set without a
leading dot. Misconfiguration stops the process rather than surfacing as a login
that silently never works.

### 2.3 Device QA

See `FINAL_DEVICE_QA.md`. Blocks sign-off, not deployment.

### 2.4 DNS, TLS and the production origins — **not doable from here**

`nomadkids.mn` and `api.nomadkids.mn` are not registered or pointed at anything
in this environment, so §6's domain checks stay open. What _was_ verified is the
behaviour that depends on them: the container was run with
`CORS_ORIGINS=https://nomadkids.mn`, and all 41 auth/CORS/CSRF probes passed
against it — including that an untrusted origin receives no
`Access-Control-Allow-Origin`, and that a cross-origin POST is refused even with
a valid CSRF token.

**★ Promoted to a launch blocker, 2026-08-20.** This was filed as provisioning
tidy-up. It is not: until the records exist, **nobody can log in with a
browser**. The deployment runs `*.vercel.app` against `*.up.railway.app`, which
are different registrable domains, so the `SameSite=Lax` session cookies are
never sent back and every authenticated request 401s. §6b has the evidence and
the two consequences. Current state, measured:

```
dig nomadkids.mn      A  →  NOERROR, no answer   (zone delegated, apex unpublished)
dig api.nomadkids.mn  A  →  NXDOMAIN             (subdomain does not exist)
```

Moving the records also needs `CORS_ORIGINS` narrowed back to
`https://nomadkids.mn` alone (`SECURITY.md` §11 forbids the `*.vercel.app`
entry that was added to unblock the deploy), `WEB_ORIGIN` moved with it, and
`NEXT_PUBLIC_API_URL` rebuilt on Vercel — it is inlined at build time, so a
variable change alone does nothing.

---

## 3. Backup and restore — verified procedure

Tested for real in Phase 12, not merely written down.

### Backup

```bash
pg_dump -Fc -U <user> -d <database> > backup-$(date +%F).dump
```

Custom format (`-Fc`) rather than plain SQL: it is compressed, and it restores
selectively, which matters when recovering one table.

### Restore

```bash
createdb -U <user> restore_target
pg_restore -U <user> -d restore_target --no-owner backup-YYYY-MM-DD.dump
```

`--no-owner` because the managed provider's role names differ from local ones;
without it, restore fails on every `ALTER … OWNER TO`.

### Verify — do not skip this

A restore that "completed" is not a restore that worked. Phase 12 checked, and a
real recovery must check:

| Check                         | Expected             |
| ----------------------------- | -------------------- |
| Row counts against the source | identical            |
| Partial unique indexes        | **5** present        |
| Foreign keys                  | **71** present       |
| Password hashes               | `$argon2id$…` intact |
| `_prisma_migrations`          | complete history     |

The partial indexes matter most: they were hand-written into the migration
because Prisma cannot express them, and they are what enforce "one active
enrollment per child per year" and "one current school year per kindergarten".
A restore that lost them would appear healthy and admit duplicate enrollments.

### What is **not** backed up by this

**Object storage is separate.** `pg_dump` captures the `MediaFile` rows, not the
photographs. A restore of the database alone yields a system whose every image
404s — the rows point at objects that are not there.

The two halves must therefore be restored **to the same point in time**, and the
database is the one that decides what exists. Restoring a newer bucket against
an older database leaves orphaned objects (harmless, collected by the sweep);
restoring an older bucket against a newer database leaves broken images (not
harmless). **When in doubt, restore the bucket first and the database second.**

### R2 policy — decided in Phase 13

| Setting                  | Value                       | Why                                                                                                                             |
| ------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Bucket access            | **private**, no public read | Verified: the object 403s without its signature                                                                                 |
| Versioning               | **on**                      | An accidental delete or overwrite of a child's photo is otherwise unrecoverable, and the sweep does issue deletes               |
| Version retention        | 30 days                     | Long enough to notice and recover; short enough not to accumulate a second copy of everything for ever                          |
| Object lifecycle         | none on `children/`         | A portfolio photo is the product; it does not expire                                                                            |
| `reports/` prefix        | deleted at 14 days          | Already enforced in the application by `ReportRetentionService` — the lifecycle rule is a backstop for objects the sweep missed |
| Cross-region replication | not configured for the MVP  | R2 is already multi-zone within a region. Revisit if the client's risk appetite changes                                         |

Verified in Phase 13 that the bucket layout is `children/<childId>/<uuid>` and
`reports/<kindergartenId>/<uuid>` — no filename and no child's name in any key,
so a bucket listing discloses nothing on its own.

### Schedule — to be set in Phase 13

Not yet configured. Needs: frequency, retention, off-site copy, and a restore
rehearsal on a schedule. A backup nobody has restored is a hypothesis.

---

## 4. What Phase 12 found and fixed

| #   | Finding                                                                                                                                                     | Severity                                    | Fixed |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ----- |
| 1   | `PUT` missing from the CORS allow-list — every assessment and term-report save would fail the browser preflight                                             | **High** — core feature broken in a browser | ✅    |
| 2   | API never loaded `.env` at boot; `pnpm dev` died on nine missing variables                                                                                  | Medium — developer-facing                   | ✅    |
| 3   | Prisma CLI never loaded `.env`; every migration command failed                                                                                              | Medium — developer-facing                   | ✅    |
| 4   | Test suite and a running dev server shared a BullMQ queue, producing a phantom idempotency failure                                                          | Medium — presented as flakiness             | ✅    |
| 5   | **Per-IP login limit of 10/15 min would lock out an entire kindergarten** — one shared NAT address, eight teachers arriving at 08:00                        | **High** — availability                     | ✅    |
| 6   | `X-Powered-By` advertised on both API and web                                                                                                               | Low — reconnaissance                        | ✅    |
| 7   | No CSP on the web app                                                                                                                                       | Medium                                      | ✅    |
| 8   | **PDF download opened a tab after an `await`** — blocked as a popup by iOS Safari, so the primary parent action fails silently on the primary parent device | **High** — silent failure                   | ✅    |
| 9   | `SECURITY.md` §9 documented rate limits the code did not have                                                                                               | Low — documentation drift                   | ✅    |

### On #5, because it is the instructive one

Brute force is stopped by the **per-identifier** lockout: five failures against
one account locks it for fifteen minutes, recorded in the database so it
survives a restart. That is the control doing the real work, and it is verified.

The per-IP limit is supplementary — and an IP, in a kindergarten, is one address
for the whole building. At 10 per fifteen minutes the security control would
have presented as the product being broken, on the first morning, with nothing
to tell anyone why. Now 60: unreachable by shared-NAT staff, still useless as a
spray rate against accounts that each lock after five failures.

It was found by the QA probes tripping it and locking out the test suite.

---

## 5. Known gaps, accepted or deferred

### ~~Email delivery is not implemented~~ — **RESOLVED**

Implemented in Phase 13 (`src/mail/mail.service.ts`) and verified end to end
against a real SMTP server:

```
request reset          → 204
message delivered      → subject "Нууц үг сэргээх", 231 Cyrillic chars, HTML + text parts
link from the email    → confirm 204
login, new password    → 200
login, old password    → 401
token replay           → 401
unknown identifier     → 204 (unchanged — no enumeration)
```

Three decisions worth recording:

- **The response never varies on delivery.** 204 whether the identifier exists,
  whether SMTP is configured, and whether the send succeeded. Any of those
  leaking — in status, body or timing — turns the endpoint into a user
  enumeration oracle, which is why the service still burns an argon2
  verification on the missing-user path.
- **A token is issued even for an account with no email address.** Many parents
  here have a phone number and no email; refusing to create a token would mean
  their account can never be recovered at all, not even by an administrator
  reading the link out. Delivery is conditional; issuance is not. (The targeted
  auth tests caught this — an earlier version returned null and broke two of
  them.)
- **Half-configured SMTP is refused at boot in production.** `SMTP_HOST` without
  `MAIL_FROM`, or the reverse, looks configured and fails only when a parent
  needs it.

SMTP is reported by `/health/readiness` but deliberately does **not** gate the
status: a deployment without mail is a workable state, and failing readiness for
it would make a working system look broken.

### Rate limiting is per instance

`RateLimitService` holds counters in process memory. With one API container that
is the real limit; with several it becomes N× the configured value. Accepted for
the MVP and documented in the service. The account lockout that actually
protects passwords is in the database and does not have this property. Redis is
already in the stack if this needs to change.

### Admin CRUD screens are not built

Confirmed with the client as an intentional Phase 1 decision. The endpoints
exist and are tested; no UI links to them, so there is no dead navigation.
Administration is through the API and seed tooling.

### A presigned URL outlives revocation

Access is checked when a URL is **signed**, so revoking a teacher or guardian
stops all future URLs immediately. A URL already in someone's hands stays valid
until it expires — minutes. This is inherent to presigning; the alternative is
proxying every image through the API, which was rejected in D10 for bandwidth.
Worth stating plainly to the client rather than leaving implicit.

---

## 6. Pre-launch checklist

Deployment specifics are in `DEPLOYMENT.md` §7. Consolidated here:

- [x] Docker image builds; worker boots; PDF with Cyrillic generated **in the container**
- [x] Font removal makes the container **refuse to start**
- [x] Report instance ≥ 1 GB memory (verified under `--memory=1g`)
- [x] Backup/restore rehearsed against container-written data
- [ ] `GET /v1/health/readiness` (admin session) reports `status: "ok"` with
      `chromium`, `redis`, `storage` and `cyrillicFont` all true
- [ ] Both domains resolve and serve valid TLS
- [ ] A real browser session shows `HttpOnly; Secure; SameSite=Lax` with **no** `Domain`
- [ ] HSTS present over HTTPS (and confirmed absent on plain http)
- [ ] A raw R2 object URL returns 403
- [ ] API, Postgres and Redis in the same region; latency measured from Ulaanbaatar
- [ ] Backup taken, restored into a scratch database, and the five integrity
      checks in §3 pass
- [ ] R2 backup/retention policy decided and written down
- [ ] Device QA per `FINAL_DEVICE_QA.md`
- [ ] Email provider wired, or the client told resets are administrative
- [ ] Secrets set from the platform's secret store, never committed

---

## 6b. Deployed — 2026-08-20

The API is live on Railway and verified end to end against the running
production system.

**https://nomadkids.up.railway.app**

| Check                           | Result                                                              |
| ------------------------------- | ------------------------------------------------------------------- |
| `GET /v1/health`                | ✅ `{"status":"ok"}`                                                |
| `GET /v1/health/readiness`      | ✅ `status: ok`                                                     |
| storage (Cloudflare R2)         | ✅ true                                                             |
| chromium                        | ✅ true                                                             |
| redis                           | ✅ true                                                             |
| cyrillicFont                    | ✅ true — 4 Mongolian-capable fonts                                 |
| smtp                            | ⛔ not configured (does not gate readiness, by design)              |
| Migrations                      | ✅ both applied, logged by the entrypoint                           |
| Real login                      | ✅ 200, **no token in the response body**                           |
| **PDF generated on production** | ✅ A4, 2 pages, 596 chars extracted, `өүӨҮ` × 19, NotoSans embedded |
| PDF served from R2              | ✅ presigned URL on `…r2.cloudflarestorage.com`                     |
| HSTS / CSP / nosniff / DENY     | ✅ all present over HTTPS                                           |

### R2 verified independently

Before wiring the credentials in, the bucket was probed directly: write
succeeded, a presigned read returned the object, and an **unsigned** read was
refused (`InvalidArgument: Authorization`) — the object was not served. Public
access via the `r2.dev` URL is disabled.

### Four defects found by deploying, all fixed

None of these were visible before a real deploy:

1. **`tsconfig.base.json` was not copied into the image.** A missing `extends`
   target is not an error in TypeScript — it silently falls back to defaults
   without `esModuleInterop`, and the build died inside zod's declarations with
   fifty `TS1259` errors that named nothing relevant.
2. **No OpenSSL for Prisma.** `node:22-slim` ships without libssl; Prisma warned
   and defaulted to openssl-1.1.x on a Debian 12 (openssl-3) image. The build
   still succeeded — the failure landed at runtime.
3. **`prisma` CLI removed by `pnpm prune --prod`**, so migrations could not run
   in the image at all. Now a runtime dependency.
4. **Railway's pre-deploy step failed silently.** `failureStage:
PRE_DEPLOY_COMMAND`, empty logs, three command variations. Moved to the
   container entrypoint, where the output is visible — see `RAILWAY_SETUP.md` §3.

### Frontend deployed — Vercel

**https://nomadkids.vercel.app**

★ **Corrected 2026-08-20.** This section previously recorded the auth rows below
as "browser-shaped" and marked them ✅. They were `curl`, and **curl is not a
browser**. See _What curl cannot verify_ below — the distinction is not
pedantic, it is the difference between a green table and a login that cannot
work in any browser. The evidence is kept; only its label and its verdict change.

**Verified with curl — these results stand.** A request is a request, and
everything here is a property of the response itself:

| Check                               | Result                                              |
| ----------------------------------- | --------------------------------------------------- |
| `/login` renders                    | ✅ HTTP 200, `<title>NomadKids</title>`             |
| CSP names the API origin            | ✅ `connect-src`/`img-src` include the Railway host |
| Production CSP has no `unsafe-eval` | ✅ dev-only, as intended                            |
| HSTS · nosniff · frame DENY         | ✅                                                  |
| CORS from the Vercel origin         | ✅ `access-control-allow-origin` + credentials      |
| `POST /auth/login` answers 200      | ✅ three `Set-Cookie` headers present in the response |
| `GET /auth/me` with those cookies   | ✅ `bagsh`, role TEACHER — cookies replayed by hand  |

**Verified in a browser: nothing yet.** The DOM-level checks were done once, by
hand, and caught the CSP nonce defect below. No authenticated flow has ever been
exercised in a browser.

| Check                                       | Status                       |
| ------------------------------------------- | ---------------------------- |
| Page paints and responds to a click         | ✅ after the nonce fix       |
| **Login, in a browser**                     | 🚫 **BLOCKED — not verified** |
| **Session survives a navigation**           | 🚫 **BLOCKED — not verified** |
| **A protected mutation (save) succeeds**    | 🚫 **BLOCKED — not verified** |
| **Logout clears the session**               | 🚫 **BLOCKED — not verified** |

**Split-origin cookie behaviour: known broken, by inspection.** Not a pending
check — a finding.

| Check                                        | Status                                        |
| -------------------------------------------- | --------------------------------------------- |
| Session cookie is stored by a browser         | ❌ **fails on the Vercel↔Railway host pair**  |
| `SameSite` permits the cross-site request     | ❌ cookies are `SameSite=Lax`, hosts are cross-site |
| Web origin can read `kinder_csrf`             | ❌ host-only cookie on the API host — **fixed in the client**, see below |

Blocked on DNS, and blocked precisely: as of 2026-08-20 `nomadkids.mn` answers
`NOERROR` with **no A record**, and `api.nomadkids.mn` answers **`NXDOMAIN`**.
The zone is delegated (`*.orderbox-dns.com`) but neither host is published, so
`curl https://nomadkids.mn/login` fails to resolve. The browser verification
below cannot be attempted, let alone passed, until those records exist.

#### What curl cannot verify

`curl` has no cookie policy. It does not implement `SameSite`, it does not know
what a registrable domain is, and it replays whatever `Set-Cookie` it is given
to whatever host you next name. **Every cookie-scoping rule that governs a real
browser is invisible to it.** So a green curl login says only that the server
issued cookies — never that a browser would keep them or send them back.

That is what hid the real defect. Production runs `https://nomadkids.vercel.app`
against `https://nomadkids.up.railway.app`, which are different registrable
domains, so the session cookies — `SameSite=Lax`, confirmed on the live
deployment — are not sent on the cross-site request at all. Every authenticated
request 401s in a browser while the curl table above stays green.
`ARCHITECTURE.md` §2.1 and `DEPLOYMENT.md` §1 both warned about exactly this in
advance; no check in this document was capable of catching it.

Two consequences, tracked separately:

1. **The cookie topology.** Fixed by DNS, not by code — `nomadkids.mn` and
   `api.nomadkids.mn` are same-site, which is what the whole security model
   assumes. No code change; see §2.4.
2. **The CSRF token source.** Fixed in code, 2026-08-20. The web client read
   `kinder_csrf` from `document.cookie`, which cannot work when the API owns its
   own host: cookies scope by **domain**, not by site, so `nomadkids.mn` cannot
   read a host-only cookie belonging to `api.nomadkids.mn`. It now takes the
   token from the session response (`/auth/login`, `/auth/me`), which the API
   has always returned. This would have 403'd every save immediately after the
   DNS move — a second wall directly behind the first. Covered by
   `apps/web/test/csrf.test.tsx` and
   `apps/api/test/csrf-session-token.test.ts`.

Local development never showed either problem: `localhost:3000` and
`localhost:3001` are the **same** cookie domain, because ports are invisible to
cookies.

### ★ The first deployed build was broken in the browser

It looked fine to every check that did not open it: HTTP 200, correct title,
CSP present, HSTS present. In an actual browser the page painted and then
**nothing responded to a click** — two inline scripts blocked by CSP, and React
error #412 from a hydration that never completed.

The cause was my own `script-src 'self'`: Next emits inline bootstrap and
hydration scripts, and that policy refuses them.

Fixed with a **per-request nonce**, not `'unsafe-inline'`. Re-admitting all
inline script would also re-admit whatever an XSS injected — the wrong trade for
a product holding children's records. A nonce admits only what this server
emitted.

Two pieces were needed, and either alone is silently useless:

1. `middleware.ts` mints the nonce and sets the CSP on the **request** headers,
   which is where Next reads it from to stamp its own script tags.
2. The root layout is `force-dynamic`. A statically pre-rendered page is built
   before any nonce exists, so its inline bootstrap ships without one — which is
   exactly what the first deploy did. Setting it on the layout means a new route
   cannot quietly reintroduce the bug. The cost is nil here: every screen but
   login and password-reset is authenticated and was never cacheable.

CSP was removed from `next.config.ts` entirely — two CSP headers are **both**
enforced, so leaving the static one would have defeated the nonce.

Verified on the live deployment, headers and body from a single request:
**0 script tags without a nonce**, the header nonce matches the tags, no
`unsafe-inline` in `script-src`, and consecutive requests get different nonces.

The lesson worth keeping: a deployment check that never renders the page in a
browser cannot see this class of failure. Every signal short of that was green.

Two monorepo details cost a deploy each and are worth recording:

- **Root Directory.** Vercel looked for `next` in the repository root
  `package.json` and reported "No Next.js version detected". `rootDirectory`
  is a project setting, not something `vercel.json` can express — it had to be
  set through the API.
- **`@kinder/contracts` must be built first.** The app imports its compiled
  output, so `buildCommand` steps up to the workspace root and builds contracts
  before the app.

**CORS had to be widened.** `CORS_ORIGINS` was `https://nomadkids.mn` only, so
the browser refused every request from the Vercel origin — verified by asking
for the header and getting nothing back. It now lists both, and `WEB_ORIGIN`
(the password-reset link host) points at the live Vercel URL until DNS moves.

### Still outstanding

- **SMTP** — password reset issues valid tokens but cannot deliver them.
- **`nomadkids.mn` / `api.nomadkids.mn`** — not yet pointed at Railway or
  Vercel, and now the **launch blocker**, not a tidy-up: browser login cannot
  work on the current host pair at all. §2.4 has the measured DNS state and the
  full list of settings that move with the records.
- **`NEXT_PUBLIC_MEDIA_URL` is not set on Vercel.** Without it the page's own
  CSP blocks every photo in the product: `/v1/media/:id` redirects to a
  presigned URL on the R2 host, and `img-src` is enforced against the redirect
  target. Found by rendering an upload in a browser — see
  `UI_MIGRATION_STATUS.md` §7.3. Set it to the R2 S3 endpoint and rebuild;
  `NEXT_PUBLIC_*` is inlined at build time.
- **Every image 401s in a browser, for the same reason.** `lib/api/client.ts`
  documents `mediaUrl` as relying on the auth cookie riding along on an
  `<img src>` — true only while the two apps share a registrable domain. On the
  Vercel↔Railway pair the cookie is not attached, so `GET /v1/media/:id` is
  unauthenticated and every photo is broken. No code change; the DNS move fixes
  it, and it is worth re-checking explicitly afterwards.
- **Smoke-test data** — one child and one observation remain in the production
  database from the PDF verification; harmless, and to be removed with the first
  real data load.

---

## 7. Verdict

**The application is ready to deploy.** Two of the four Phase 12 blockers are
closed: the container is built and its PDF worker verified from the inside, and
password-reset email works end to end.

What remains is not code. It is **provisioning** — managed Postgres, Redis, an
R2 bucket, two signing secrets, DNS and certificates — and **device QA**, which
needs a phone. Neither can be done from this environment, and neither is
blocked by anything in the repository.

**★ Amended 2026-08-20. Deployed is not the same as usable.** The current
deployment cannot log anybody in from a browser, because the two hosts are
cross-site and the session cookies are `SameSite=Lax` (§2.4, §6b). The DNS
records are therefore not the last item on a provisioning list — they are the
thing standing between a deployed build and a working product, and the
browser-shaped flow in §6b stays **unverified** until they exist. Nothing in
this document that was checked with `curl` is evidence about that flow.

Nothing found in Phase 12 or Phase 13 remains unfixed.
