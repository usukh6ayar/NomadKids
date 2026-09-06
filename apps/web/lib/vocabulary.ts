/**
 * The nouns that were naming more than one thing.
 *
 * ★ Copy lives inline everywhere else in this product, and should keep doing so.
 * These four are here because they were the failure, not because constants are
 * the house style.
 *
 * "Хавтас" meant five things at once. A parent tapped **Хавтас** in the bottom
 * bar, arrived on a screen titled **Хөгжлийн хавтас**, opened a child, and found
 * a second button also called **Хавтас** that went somewhere else — while the
 * sidebar called the product **Хүүхдийн хөгжлийн цахим хувийн хавтас** and the
 * phone header shortened it to **Хүүхдийн хавтас**. Separately, one component —
 * `ChildGallery` — was labelled **Цомог** as a tab and **Зураг, бүтээл** in the
 * portfolio.
 *
 * Nielsen's consistency heuristic, four ways, and none of it visible from any
 * single file. That is what makes this the one case worth centralising: the
 * mistake is only apparent when you can see all five call sites at once.
 *
 * ★★ The RFP settles two of the four, and it outranks preference.
 *
 * §4 is titled "Хүүхдийн цахим хувийн хавтас" and §4.4 "Зургийн цомог". The
 * audit's first instinct was to call the gallery "Зураг"; the RFP already had a
 * name for it, so the tab's existing "Цомог" was the closer of the two and the
 * portfolio's "Зураг, бүтээл" is the one that changed.
 *
 * `vocabulary.test.tsx` fails if a retired spelling comes back.
 */

/**
 * The product, in the sidebar and the phone header.
 *
 * ★ **The platform's name, not a kindergarten's** — changed 2026-09-06.
 *
 * It read "Бяцхан нүүдэлчид", which is the name of the first kindergarten to
 * use the system. That was right while there was one; it is wrong now that the
 * product is sold to others, because a second kindergarten's staff would open
 * the app and be greeted by a competitor's name. `nomadkids.mn` was already the
 * domain, so this makes the name in the header agree with the name in the
 * address bar.
 *
 * ★★ It stays a **Latin** wordmark in an otherwise Mongolian interface, which
 * is deliberate rather than an oversight: it is a proper noun, the same one the
 * domain and the invoices carry, and transliterating it would create a second
 * name for one product. Every other string a user reads is still Mongolian.
 *
 * ★★★ The brand before that was a description — "Хүүхдийн хөгжлийн цахим хувийн
 * хавтас" — which put the word "хавтас" in the one place a user cannot navigate
 * away from, competing with the section actually called that. A name rather
 * than a feature leaves the noun free, and that reasoning still holds.
 */
export const BRAND = "NomadKids";

/** The RFP §4 record: "Миний тухай", ages 2–5, the album, the birthday notes. */
export const PORTFOLIO = "Цахим хувийн хавтас";

/** The photographs — RFP §4.4. One name, on the tab and inside the portfolio. */
export const GALLERY = "Зургийн цомог";

/** A parent's own children: the bottom-bar entry and the screen it opens. */
export const MY_CHILDREN = "Миний хүүхдүүд";
