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
 * The supplied system logo carries this Mongolian wordmark. Keeping the same
 * name in metadata, navigation and accessible text prevents the interface from
 * presenting a second brand beside the artwork.
 *
 * ★★★ The brand before that was a description — "Хүүхдийн хөгжлийн цахим хувийн
 * хавтас" — which put the word "хавтас" in the one place a user cannot navigate
 * away from, competing with the section actually called that. A name rather
 * than a feature leaves the noun free, and that reasoning still holds.
 */
export const BRAND = "Бяцхан нүүдэлчид";

/** The RFP §4 record: "Миний тухай", ages 2–5, the album, the birthday notes. */
export const PORTFOLIO = "Цахим хувийн хавтас";

/** The photographs — RFP §4.4. One name, on the tab and inside the portfolio. */
export const GALLERY = "Зургийн цомог";

/** A parent's own children: the bottom-bar entry and the screen it opens. */
export const MY_CHILDREN = "Миний хүүхдүүд";
