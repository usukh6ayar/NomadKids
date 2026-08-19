# UI_UX_MAP.md — routes and screens

**Status:** design only.
**Direction:** clean, simple, modern, warm, fast.
**Core principle: one screen = one primary job.**

The reference system has 81 templates. This is **24 routes**. The reduction is
the point — most of those templates were partials, and several screens existed
because a model existed rather than because a person needed them.

---

## 1. What "one screen = one primary job" rules out

- No landing pages that only link elsewhere. If a route's job is "choose where to
  go next", the navigation already does that.
- No dashboard that is a wall of statistics. A dashboard answers _what needs my
  attention today_, or it is not built.
- No charts in the MVP. Radar charts and percentile curves are Phase 2/3.
- No screen that exists because a table exists. `Enrollment` has no screen of its
  own; it is edited inside the child.

---

## 2. Route map

```
apps/web/app/
├── login
├── forgot-password
├── reset-password/[token]
│
└── (app)/                       one authenticated shell, role-aware
    ├── dashboard                teacher / admin
    ├── home                     parent
    ├── children                 roster (staff) or own children (parent)
    ├── children/[childId]
    ├── children/[childId]/portfolio
    ├── children/[childId]/observations/new
    ├── observations/review      teacher / admin
    ├── groups/[groupId]/assessment
    ├── notifications
    ├── notifications/[notificationId]
    ├── settings
    ├── admin                    admin
    └── no-access
```

### ★ Why one route group and not three (corrected 2026-08-20)

This document originally specified `(teacher)`, `(parent)` and `(admin)` route
groups. **That does not build.** Next resolves route groups into the same URL
space, and all three audiences need `/children/[childId]`, `/notifications` and
`/settings` — three groups declaring them is a duplicate-route error.

The alternative, prefixing the parent's routes (`/my/children/…`), would give
one child two URLs, so a link a teacher pastes to a parent breaks for one of
them.

So: **one shell, navigation derived from the session's roles**, and the handful
of screens both audiences reach render the view appropriate to the viewer. The
data is already filtered by the API — a parent's `/children/:id/observations`
does not contain private notes — so the difference is layout and affordances,
never client-side hiding.

It also handles a case the split could not: the client has administrators whose
own children attend. They get one product rather than two they must sign out of
to switch between.

**Reports have no route of their own.** Generating a PDF is an action taken _on
a child_, from that child's page — a dialog with progress and a download. A
"Reports" index would list things you already navigated away from.

**Assessment has no menu item.** It cannot start without a group, so a top-level
entry would open a screen whose first act is to ask "which group?". The groups a
teacher teaches are listed on the dashboard, each linking straight into its
assessment column.

---

## 3. Teacher

### `/dashboard` — _know what needs attention_

Not statistics. Three lists, each an action:

1. **Parent submissions awaiting review** — the only true queue in the product.
2. **Assessment gaps** — children with no assessment this term, by group.
3. **Recent activity** — the last observations written, so a teacher resumes.

Empty state matters: on a quiet day this page says so plainly rather than
showing four zeros.

### `/children` — _find a child_

Search by name, filter by group, school year and status. Card list with photo,
name, group, age. Paginated. On a phone it is a single column — this is the
screen a teacher opens while standing up.

### `/children/[childId]` — _understand and work on this child_

The hub. Identity header, then tabs: **Тойм** (recent observations and current
assessment), **Хөгжлийн хавтас**, **Ажиглалт**, **Үнэлгээ**. Primary actions in
the header: record an observation, generate a PDF.

### `/children/[childId]/portfolio` — _manage the portfolio_

"Миний тухай", ages 2–5, birthday notes, photo gallery. Inline editing, one
section at a time. Not a wizard.

### `/children/[childId]/observations/new` — _record one observation_

A full-page form, never a modal — teachers write several paragraphs here. Type,
date, the four texts, domain tags, photos, parent visibility. Autosaves a draft;
losing a written observation to a tapped Back button is the worst failure this
screen can have.

### `/observations` — _find an observation across children_

Filters: child, group, type, domain, date range, source. Exists because a
teacher preparing a parent meeting searches across children, not within one.

### `/observations/review` — _process parent submissions_

One at a time, approve or return with a note. Not a table.

### `/groups/[groupId]/assessment` — _assess a group_

Children × domains grid, one term at a time. Tap a cell, pick a level, optional
comment. Bulk-saves. This is the densest screen in the product and the one that
must feel fastest.

### `/settings` — own profile and password.

---

## 4. Parent

Parents of more than one child get a child switcher in the header. It is
authorized server-side — reference test:
`test_switching_to_a_child_that_is_not_theirs_gets_404`.

### `/home` — _what happened recently_

A single reverse-chronological feed: observations marked visible, notices, new
photos, a finalized term report. Not a dashboard. A parent opening this on a
phone in the evening should see today, immediately.

### `/children/[childId]` — _understand my child's development_

Development areas with the current term's level in plain language, the teacher's
narrative from the finalized term report, recent observations. **No radar chart,
no percentile curve** — a levels-and-words presentation a parent can act on.

### `/children/[childId]/portfolio` — _explore my child's story_

Read-mostly: "Миний тухай", ages 2–5, the photo gallery. The emotional centre of
the product; it gets the most design care. Download-as-PDF lives here.

### `/children/[childId]/observations/new` — _share something from home_

A short form — date, what happened, optional photo. Deliberately smaller than the
teacher's. Goes to the review queue.

### `/notifications` — read, with unread state. Polled, not realtime.

### `/settings` — own profile and password.

---

## 5. Admin

Five screens, one shared CRUD pattern (list → drawer form → optimistic save).
This replaces 16 Django ModelAdmin classes and is the largest single build cost
in the MVP; keeping the pattern uniform is what keeps it affordable.

| Route                       | Job                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------ |
| `/users`                    | Create staff and guardians, assign roles, deactivate. Invitations are sent from here |
| `/kindergarten`             | Kindergarten details and school years                                                |
| `/groups`                   | Groups, and which teachers are assigned to each                                      |
| `/config/domains`           | Development domains — **data, not code**                                             |
| `/config/levels`            | Assessment levels — **data, not code**                                               |
| `/config/observation-types` | Observation types                                                                    |

System-provided configuration rows are visible but not editable; the admin
creates a kindergarten-specific override instead. The UI shows this as a lock
icon with an "Өөрийн болгох" action, rather than a form that fails on submit.

Admins reach children through the teacher screens; there is no separate admin
child list.

---

## 6. Cross-cutting

| Rule                                              | Applies                                                 |
| ------------------------------------------------- | ------------------------------------------------------- |
| All user-facing text in **Mongolian**             | everywhere; code and identifiers in English             |
| Mobile-first                                      | it works on a phone before anywhere else                |
| Confirm before delete                             | every destructive action                                |
| Toast after save                                  | every mutation                                          |
| Loading state                                     | anything over ~300 ms; skeletons on lists, not spinners |
| Every field has a `<label>`, every image an `alt` | accessibility                                           |
| Empty states say what to do next                  | every list                                              |
| Optimistic updates                                | assessment grid, notification read, visibility toggles  |

### 6.1 Error routes

`not-found.tsx` and `error.tsx` per route group, in Mongolian. A 404 must look
identical whether the record is absent or forbidden — the visual design carries
the same guarantee as the status code.

### 6.2 Design tokens

Colour, spacing, radius and type scale are lifted from the reference system's
`app.css` so the product stays recognisable to the client. Components are
shadcn/ui; the 3,115 lines of hand-written CSS are not ported.

---

## 7. Screens deliberately not built

| Not built                               | Why                                                  |
| --------------------------------------- | ---------------------------------------------------- |
| Reports index                           | Reports are generated from a child's page            |
| Enrollment management screen            | Edited within the child                              |
| Guardianship screen                     | Edited within the child                              |
| Media library                           | Photos are reached through a child or an observation |
| Audit log viewer                        | API only in the MVP; a screen is Phase 2             |
| Attendance, meals, finance, invoices    | Phase 2                                              |
| Chat, surveys, analytics, growth charts | Phase 2/3                                            |
| Separate admin child list               | Admins use the teacher screens                       |
