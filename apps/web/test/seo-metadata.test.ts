import type { Metadata } from "next";
import { describe, expect, it } from "vitest";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";
import { metadata as rootMetadata } from "@/app/layout";
import { metadata as loginMetadata } from "@/app/login/layout";
import { metadata as faqMetadata } from "@/app/faq/page";
import { metadata as privacyMetadata } from "@/app/privacy/page";
import { metadata as termsMetadata } from "@/app/terms/page";
import { BRAND } from "@/lib/vocabulary";

/**
 * The public pages' search metadata.
 *
 * ★ This file exists because of a bug that was invisible in the source. The
 * root layout sets `alternates: { canonical: "/" }` for itself, Next inherits
 * it into every page that does not override it, and `/faq`, `/privacy` and
 * `/terms` never did — so all three shipped announcing they were duplicates of
 * the home page while `sitemap.ts` listed them as URLs of their own. A crawler
 * resolves that contradiction in the canonical's favour and drops the page.
 *
 * Nothing in the repository showed it. The pages' `metadata` exports looked
 * complete; the missing key was the whole defect, and it was only visible by
 * fetching production and reading the `<link rel="canonical">` it emitted.
 */
describe("public page metadata", () => {
  const canonicalOf = (metadata: Metadata) => metadata.alternates?.canonical;

  it("gives every indexable page a canonical of its own", () => {
    expect(canonicalOf(faqMetadata)).toBe("/faq");
    expect(canonicalOf(privacyMetadata)).toBe("/privacy");
    expect(canonicalOf(termsMetadata)).toBe("/terms");
  });

  /**
   * ★ `/login` is the exception, and it is a decision rather than an
   * oversight: it renders the same `PublicLanding` component as `/`, so two
   * self-canonicals would ask Google to rank one page under two URLs. It is
   * asserted here so that the rule above reads as "every page except this one,
   * for this reason" instead of being quietly incomplete.
   */
  it("keeps /login pointing at the root it duplicates", () => {
    expect(canonicalOf(loginMetadata)).toBe("/");
    expect(canonicalOf(rootMetadata)).toBe("/");
  });

  /**
   * The root's `title.template` appends `| ${BRAND} · NomadKids`, so a page
   * that spells the brand in its own title prints it twice — inside the ~60
   * characters a result line has. All three did.
   */
  it("leaves the brand to the title template", () => {
    for (const metadata of [faqMetadata, privacyMetadata, termsMetadata, loginMetadata]) {
      expect(String(metadata.title)).not.toContain(BRAND);
    }
  });

  /**
   * ★ The sitemap and the disallow list are the two files that can silently
   * disagree with the pages. A URL listed for crawling and then disallowed is
   * a page that will never be fetched — and `robots.ts` lists prefixes, so a
   * new public route added under one of them would be swallowed without a
   * word.
   */
  it("does not disallow anything it asks to be crawled", () => {
    const rules = robots().rules;
    const disallowed = (Array.isArray(rules) ? rules : [rules]).flatMap((rule) =>
      [rule.disallow ?? []].flat(),
    );

    for (const { url } of sitemap()) {
      const path = new URL(url).pathname;
      for (const prefix of disallowed) {
        expect(path.startsWith(prefix), `${path} is disallowed by ${prefix}`).toBe(false);
      }
    }
  });
});
