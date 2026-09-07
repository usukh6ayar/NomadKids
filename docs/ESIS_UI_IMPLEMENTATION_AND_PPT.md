# ESIS UI implementation and presentation content

**Date:** 2026-09-07
**Status:** Internal self-assessment; not a ministry certification

## 1. Implemented in this change

- A platform-admin-only tenant mapping links each kindergarten to one ESIS
  `institutionId`.
- The ADMIN route `/admin/integrations/esis` shows C1-C5 readiness, the 17
  selected endpoints, blockers, dry-run controls, and recent run history.
- A read-only dry-run calls up to four GET services at a time. It changes no
  local records and returns only counts plus up to five safe display labels.
- `EsisSyncRun` records status and counts. A database constraint prevents two
  concurrent runs for the same kindergarten, stale locks recover after 15
  minutes, and `AuditLog` records the actor.
- `/children/import` now provides an `Excel / ESIS` source selector.
- TEST/PRODUCTION is visible. The token remains server-only; the UI receives
  presence only, never its value or length.

## 2. Overall requirement result

Order A/261 has 94 checks: 51 mandatory and 43 recommended.

| Category    | Complete | Partial | Not met | N/A | Total |
| ----------- | -------: | ------: | ------: | --: | ----: |
| Mandatory   |       35 |      14 |       1 |   1 |    51 |
| Recommended |       14 |      11 |      15 |   3 |    43 |

- **69%** of mandatory requirements are fully met.
- **96%** of mandatory requirements are complete or partially implemented.
- The one unmet mandatory requirement is Treasury-system integration.
- ESIS-related checks remain partial until contract, token scope, test, and
  production synchronization evidence exist.

## 3. ESIS requirement traceability

| Source                   | Requirement                                | Status                     | Evidence and implementation                                                                                            |
| ------------------------ | ------------------------------------------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| A/261 general #29        | Two-way education database exchange        | Partial                    | 17 v2 adapters, GET and attendance POST schemas, tenant mapping, operator UI, dry-run, audit; production queue remains |
| A/261 general #30        | API input/output documentation             | Complete                   | `docs/API.md`, `ESIS_API_READINESS.md`, API ID matrix                                                                  |
| A/261 general #31        | Integration capability                     | Complete                   | Isolated NestJS boundary, schema validation, timeout, redaction                                                        |
| A/261 preschool #3       | Receive/send organization and learner data | Partial                    | Organization, year, group, student and movement endpoints; approved import/write remains                               |
| A/261 preschool #37      | Pull the unified food catalog              | Partial                    | APIs 111, 112 and 123-127 plus food preview; local ingredient/recipe mapping remains                                   |
| A/261 preschool #51      | Receive/send teacher and staff data        | Partial                    | Teacher/staff schemas, sensitive-field stripping and preview; account mapping/write remains                            |
| A/465 section 3.4.3      | Name every inbound/outbound service        | Ready                      | 17 endpoints recorded with API ID, slug, method, and product use                                                       |
| A/465 sections 3.7 and 4 | Token and least-privilege API access       | Partial                    | Server-only token and scope matrix; BMTT has not granted scope                                                         |
| A/465 section 3.9        | Privacy and cybersecurity                  | Complete for current scope | RBAC, tenant mapping, token redaction, password/registration-number stripping, audit                                   |
| A/465 section 3.17       | Deliver primary records                    | Partial                    | Attendance v3 contract ready; production POST/reconcile remains                                                        |
| A/465 section 3.18       | Advance planning and test environment      | Partial                    | Rollout plan, TEST UI and dry-run; official test token/acceptance remains                                              |
| A/465 section 5          | Correction and history                     | Partial                    | Sync-run/audit history started; field conflicts and three-day SLA cases remain                                         |
| A/465 section 7.3        | Daily attendance and movement              | Partial externally         | Local attendance/movement works; daily ESIS delivery is not live                                                       |

## 4. PPT-ready ten-slide outline

### Slide 1 - NomadKids and ESIS integration

- Preschool operations, child development, attendance, food, and reporting
- Compliance work for Order A/261 and Procedure A/465
- Reporting date: 2026-09-07

### Slide 2 - Legal basis

- 2024 Order A/261: 94 software requirements
- 2025 Procedure A/465: data exchange, token, access, correction, and timing
- Goal: controlled, auditable two-way exchange with the education database

### Slide 3 - Current compliance result

- Mandatory: 35 complete, 14 partial, 1 not met, 1 not applicable
- 69% fully complete; 96% complete or partially implemented
- Unmet mandatory item: Treasury-system integration
- This is an internal assessment, not an external certification

### Slide 4 - ESIS endpoint scope

- Organization and academic year: 2 APIs
- Children, groups, teachers and staff: 6 APIs
- Attendance: 2 APIs, including 1 POST
- Unified food catalog: 7 APIs
- Total: 17 selected endpoints

### Slide 5 - Technical architecture

- Browser -> NomadKids API -> ESIS Hub; the browser never calls ESIS directly
- Bearer token stays in server secret storage
- Zod validation strips unknown and unnecessary sensitive fields
- Timeout, categorized errors, token redaction, and audit logging

### Slide 6 - New operator UI

- C1-C5 readiness cards
- Seventeen-row API access matrix
- TEST/PRODUCTION, institution mapping, and actionable blockers
- Read-only dry-run and recent activity history
- Demo route: `/admin/integrations/esis`

### Slide 7 - Safe import flow

- Platform admin approves the tenant institution mapping
- Kindergarten ADMIN runs up to four read-only datasets
- Counts and limited previews are shown; local data is unchanged
- Next phase: match -> field conflict -> approve -> background import

### Slide 8 - Access and data protection

- A tenant ID mismatch blocks the ESIS request at the API
- Teachers and parents do not see ESIS administration controls
- Platform admin maps institutions without reading kindergarten payloads
- ESIS passwords, registration numbers, and unused identifiers are stripped

### Slide 9 - Ready now and remaining work

**Ready:** 17 contracts, schemas, tenant mapping, readiness UI, dry-run,
history, audit, and Excel/ESIS source UX.

**Remaining:** contract, ACCESS_TOKEN, API scope, test acceptance, external-ID
matching, conflict approval, BullMQ retry/dead-letter, attendance reconciliation,
and approved local food import.

### Slide 10 - Rollout sequence

- T-12 weeks: contract, board decision, API scope
- T-8: token, institution mapping, access review
- T-4: test GET dry-run and contract verification
- T-2: one-group read-only pilot
- T-1: attendance POST/GET reconciliation pilot
- T: one-kindergarten production rollout
- KPI: sync >=99%, attendance reconciliation 100%, critical conflicts 0

## 5. Screenshots to include

1. `/admin/integrations/esis` - C1-C5 overview.
2. `API эрх` tab - endpoint matrix.
3. `Туршилтын импорт` tab - selection and dry-run result.
4. `Түүх` tab - actor, time, and status.
5. `/platform/[id]` - tenant institution mapping.
6. `/children/import` - Excel/ESIS source selection.

## 6. Accurate presentation wording

Use: **"Contracts and safe read-only dry-run for 17 ESIS endpoints are ready.
Production access opens after contract, token scope, and test acceptance."**

Do not claim: **"ESIS is fully connected", "A/261 is 100% complete", or
"production data is synchronizing".** C3-C5 evidence does not yet exist.
