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

## 7. Verdict

**The application is ready to deploy.** Two of the four Phase 12 blockers are
closed: the container is built and its PDF worker verified from the inside, and
password-reset email works end to end.

What remains is not code. It is **provisioning** — managed Postgres, Redis, an
R2 bucket, two signing secrets, DNS and certificates — and **device QA**, which
needs a phone. Neither can be done from this environment, and neither is
blocked by anything in the repository.

Nothing found in Phase 12 or Phase 13 remains unfixed.
