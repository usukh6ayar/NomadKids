# DEPLOYMENT.md — production topology

**Status:** design and configuration reference. Nothing is deployed yet;
deployment is the last implementation phase.

**Data residency:** approved by the client on 2026-08-19 (D13). This
application's data may be stored in cloud infrastructure outside Mongolia —
[SECURITY.md](SECURITY.md) §14.1.

---

## 1. Domains

| Role | Origin                     | Platform    | DNS                               |
| ---- | -------------------------- | ----------- | --------------------------------- |
| Web  | `https://nomadkids.mn`     | Vercel      | apex → Vercel (A / ALIAS)         |
| API  | `https://api.nomadkids.mn` | Railway/Fly | `api` CNAME → the platform's host |

Both are on the registrable domain `nomadkids.mn`, so they are **same-site**.
Everything in [SECURITY.md](SECURITY.md) §3 depends on that:

```
same registrable domain  →  same-site  →  SameSite=Lax works
                                       →  host-only cookie is enough
                                       →  the browser's own CSRF defence applies
```

> **Set the DNS records before the auth module is written.** Developing against
> `*.vercel.app` + `*.railway.app` puts the two on different registrable
> domains. Cookies become cross-site, `SameSite=None` becomes mandatory, and the
> code written under those conditions bakes in the weaker configuration. The
> change back is easy to make and hard to notice.

HTTPS everywhere. Both platforms terminate TLS and issue certificates
automatically; no plaintext origin appears in any configuration, and the
environment loader rejects one in production.

---

## 2. Services

```
                    ┌────────────────────────────────┐
                    │  Vercel                        │
   users ──────────▶│  https://nomadkids.mn          │
                    │  Next.js — SSR + static        │
                    └───────────────┬────────────────┘
                                    │ HTTPS, credentialed
                                    │ cookie + X-CSRF-Token
                    ┌───────────────▼────────────────┐
                    │  Railway / Fly                 │
                    │  https://api.nomadkids.mn      │
                    │  NestJS                        │
                    └──┬──────────┬──────────┬───────┘
                       │          │          │
          ┌────────────▼──┐  ┌────▼────┐  ┌──▼──────────────┐
          │  PostgreSQL   │  │  Redis  │  │ Cloudflare R2   │
          │  (managed)    │  │ BullMQ  │  │ private bucket  │
          └───────────────┘  └────┬────┘  └─────────────────┘
                                  │
                    ┌─────────────▼──────────────────┐
                    │  Report worker                 │
                    │  same image, worker entrypoint │
                    │  Chromium · ≥ 1 GB RAM         │
                    │  Cyrillic fonts installed      │
                    └────────────────────────────────┘
```

**Region:** choose the closest available region to Mongolia on each platform,
and keep the API, Postgres and Redis in the **same** one. A cross-region API →
database hop is added to every request. Measure real latency from Ulaanbaatar
before launch; RFP §17 asks for 3-second page loads.

---

## 3. Environment

`.env.example` is the complete list. Production differences:

| Variable                 | Production value                                    |
| ------------------------ | --------------------------------------------------- |
| `NODE_ENV`               | `production`                                        |
| `CORS_ORIGINS`           | `https://nomadkids.mn` — exactly this, nothing else |
| `COOKIE_DOMAIN`          | **empty** — host-only cookie, see below             |
| `DATABASE_URL`           | managed Postgres, TLS required                      |
| `REDIS_URL`              | managed Redis                                       |
| `REPORTS_WORKER_ENABLED` | `true` on the instance that renders PDFs            |
| `STORAGE_ENDPOINT`       | the R2 S3 endpoint                                  |
| `JWT_SECRET`             | `openssl rand -base64 48`                           |
| `REFRESH_SECRET`         | a **different** `openssl rand -base64 48`           |
| `NEXT_PUBLIC_API_URL`    | `https://api.nomadkids.mn`                          |

`loadEnv()` refuses to boot in production on: a `localhost` origin, a plaintext
`http://` origin, identical signing secrets, or a `COOKIE_DOMAIN` that is set
but missing its leading dot. Misconfiguration should stop the process, not
surface as a login that silently never works.

### Why `COOKIE_DOMAIN` is empty in production

The cookie is issued by `api.nomadkids.mn` and only needs to return there. A
host-only cookie does that already, because the two origins are same-site.
Setting `Domain=.nomadkids.mn` would hand the session cookie to every present
and future subdomain for no benefit. [SECURITY.md](SECURITY.md) §3.1.

---

## 4. The report worker

The API container and the worker run **one image with two entrypoints**. The
worker needs Chromium, which the API does not, but splitting the image lets the
two drift.

Non-negotiable, and measured in [PDF_SPIKE.md](PDF_SPIKE.md):

```dockerfile
# Without this the report renders COMPLETELY BLANK — no error, no tofu, just a
# 1 MB PDF of empty pages that reports success. PDF_SPIKE.md §4.
COPY fonts/ /usr/share/fonts/truetype/kinder/
RUN fc-cache -f
```

- **≥ 1 GB RAM.** 512 MB is the measured floor; 384 MB fails.
- **Boot assertion:** refuse to start if `fc-list :lang=mn` is empty.
- **One browser reused** across jobs — launch is ~500 ms, each render ~2.5 s.
- **Not on Vercel.** A 775 MB Chromium and a 2.5 s job do not fit a serverless
  function.

---

## 5. Storage

Private R2 bucket. No public access, no public custom domain. Objects are
reached only through `GET /media/:id`, which runs the authorization check and
then issues a 5-minute presigned URL — [SECURITY.md](SECURITY.md) §7.

Enable object versioning, with a lifecycle rule expiring noncurrent versions
after 30 days.

The storage client is written against the S3 API rather than an R2-specific SDK.
MinIO stands in locally, and if hosting ever has to move, the change is a set of
environment variables.

---

## 6. Backups

- Managed Postgres automated backup + PITR — **verify the provider's actual
  retention** before launch rather than assuming it.
- An independent nightly `pg_dump` to R2, 30-day retention, encrypted before
  upload, key stored elsewhere.
- **Restore drill before launch, then quarterly.** A backup that has never been
  restored is not a backup.

---

## 7. Pre-launch

The security checklist is [SECURITY.md](SECURITY.md) §15. Deployment-specific
items:

- [ ] `nomadkids.mn` and `api.nomadkids.mn` both resolve and serve valid TLS
- [ ] A real browser session on `https://nomadkids.mn` authenticates against
      `https://api.nomadkids.mn` — inspect the `Set-Cookie` header and confirm
      `HttpOnly; Secure; SameSite=Lax` with **no** `Domain`
- [ ] API, Postgres and Redis are in the same region; latency measured from
      Ulaanbaatar
- [ ] `GET /v1/health/readiness` (admin session) returns `status: "ok"` with
      `chromium`, `redis`, `storage` and **`cyrillicFont`** all true
- [ ] The report worker boots, and **fails to boot** when the fonts are removed:
      `docker run --rm <image> sh -c 'rm -rf /usr/share/fonts/*; fc-cache -f; node apps/api/dist/main.js'`
      must exit with the font error, not start
- [ ] A report generated in production is opened and **read** — not merely
      downloaded. A blank PDF is a successful download (PDF_SPIKE.md §4)
- [ ] The report instance has **≥ 1 GB** of memory (512 MB is the measured
      floor for one render; 384 MB fails)
- [ ] A raw R2 object URL returns 403
- [ ] Backup restored into a scratch database successfully
