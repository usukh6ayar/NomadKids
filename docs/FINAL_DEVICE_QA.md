# FINAL_DEVICE_QA.md

What was verified about responsive behaviour and browsers, what was **not**, and
the checklist a person with real devices must work through before sign-off.

Written 2026-08-20 (Phase 12).

---

## 1. What this environment can and cannot prove

The test environment is a headless macOS shell. There is no browser to drive and
no device to hold, so the honest split is:

|                       |                                                                                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Provable here**     | that the code _specifies_ the right sizes, that no rule reintroduces horizontal overflow, that markup is labelled and focusable, that the served CSS contains the tokens |
| **Not provable here** | that a real Safari lays it out correctly at 390 px, that a thumb can hit the targets, that iOS does not zoom on focus, that a download behaves                           |

★ **jsdom has no layout engine.** Every element measures 0 × 0. A test calling
`getBoundingClientRect()` would return zeros and pass at any size — it would
assert nothing while looking like the strongest test in the file. That is why
`apps/web/test/responsive.test.tsx` asserts on **class strings and CSS source**
instead, and why the items below are BLOCKED rather than quietly passed.

---

## 2. Verified automatically

`apps/web/test/responsive.test.tsx` — 15 assertions, run in `SUITE`:

- **Every** button size (`md`, `sm`, `lg`, `icon`) is ≥ 44 px. Asserted by
  parsing the height out of the variant's class string, so a new "compact"
  32 px variant fails the test rather than shipping.
- Inputs and selects are 48 px; a checkbox row is ≥ 44 px so the label is part
  of the target.
- `globals.css` forces **16 px** on `input, textarea, select`.
- `html { overflow-x: hidden }` and `overflow-wrap: break-word` are present.
- The focus ring is defined globally and `outline: none` appears nowhere.
- Every field's label is bound to its control (queried _by label_, so the
  association is real rather than visual).
- An error is `role="alert"` and referenced by `aria-describedby`.
- The palette tokens and both sizing floors are present.
- A `prefers-reduced-motion` block exists.

Confirmed in the **running** application: the served CSS bundle
(`/_next/static/chunks/…globals….css`) contains `f8f7f4`, `6c63ff`, `26242b`,
`44px` and `48px`.

### Why 16 px is a rule and not a preference

iOS Safari zooms the page when a focused input's text is below 16 px, and it
does not zoom back out. The user is left on a horizontally scrolled page with no
obvious way back — the "zero horizontal overflow" requirement, broken by a font
size. It is enforced globally in `globals.css` rather than per component.

---

## 3. BLOCKED — needs a real browser

### 3.1 Viewport rendering

Check each width for horizontal overflow, clipped text and reachable controls:

| Width   | Represents                                      |
| ------- | ----------------------------------------------- |
| 375 px  | iPhone SE / mini — the tightest realistic case  |
| 390 px  | iPhone 13/14/15 — the most common parent device |
| 768 px  | iPad portrait                                   |
| 1024 px | iPad landscape / small laptop                   |
| 1440 px | Desktop                                         |

Per width, walk: `/login` → `/dashboard` → `/children` → a child → the portfolio
→ a new observation → `/observations/review` → a group assessment →
`/notifications` → `/settings`.

Watch for:

- [ ] The page never scrolls sideways (the body; wide content may scroll inside
      its own container).
- [ ] The bottom navigation does not cover the last row of a long list —
      `pb-24` is meant to clear it; confirm with a list long enough to scroll.
- [ ] The sticky assessment save bar sits above the bottom bar on a phone and
      does not obscure the last child in the roster.
- [ ] The parent child-switcher scrolls horizontally _within itself_ with three
      or more children and long names.
- [ ] Mongolian names wrap rather than widening the layout.

### 3.2 Browsers

| Browser          | Status      | Note                             |
| ---------------- | ----------- | -------------------------------- |
| Chrome (desktop) | **BLOCKED** | no browser in this environment   |
| Safari (desktop) | **BLOCKED** | macOS only, not automatable here |
| Mobile Safari    | **BLOCKED** | needs a device or simulator      |
| Android Chrome   | **BLOCKED** | needs a device or emulator       |

**Mobile Safari is the one that matters most.** It is where the parent audience
lives and where the platform-specific traps are:

- [ ] **Cookie auth works.** Safari's cross-site tracking prevention is the
      real risk. In production the web app and API share a registrable domain
      (`nomadkids.mn` / `api.nomadkids.mn`), so the cookie is same-site and
      `SameSite=Lax` is correct. Confirm a login on a real device survives a
      tab switch and an app backgrounding.
- [ ] **Input focus does not zoom** the page (this is the 16 px rule paying off).
- [ ] **Rotation** from portrait to landscape and back does not leave the layout
      broken.
- [ ] **File upload** opens the camera roll and an upload completes over
      cellular.
- [ ] **PDF download** — the report opens a presigned URL in a new tab.
      **Fixed in Phase 12 before it could be observed:** the tab was being
      opened in `onSuccess`, i.e. _after_ an `await`, which is off the user
      gesture and gets blocked as a popup by iOS Safari. The parent would tap
      "Татаж авах", nothing would happen, and no error would explain it. The
      tab is now opened synchronously with a blank URL and its location set once
      the presigned URL arrives, with a same-tab fallback if even that is
      refused. Confirm on a device that the file opens.
- [ ] `env(safe-area-inset-bottom)` keeps the bottom bar clear of the home
      indicator on a notched device.

### 3.3 Accessibility with a real screen reader

Automated checks cover labelling and roles. Not covered:

- [ ] VoiceOver announces the unread count as "N уншаагүй мэдэгдэл", not a bare
      digit.
- [ ] The assessment level radiogroup is navigable and announces the child.
- [ ] Focus order through the observation form is sensible.

---

## 4. Known risk, ranked

1. **Bottom navigation overlapping list content** — the padding is set, but
   `env(safe-area-inset-bottom)` behaviour varies by device.
2. **Cookie behaviour in Mobile Safari** — expected to work on a shared
   registrable domain, but ITP is the component most likely to surprise.

---

## 5. Sign-off

Device QA cannot be signed off from this environment. It needs one person, one
iPhone and one Android phone, working through §3 against a deployed build.

Everything in §2 is verified and will stay verified — those assertions run in
CI on every change.
