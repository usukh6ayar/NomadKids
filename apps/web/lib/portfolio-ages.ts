/**
 * RFP §4.3: "2, 3, 4, 5 нас тус бүрд тусдаа мэдээллийн хуудастай байна."
 *
 * Shared by every screen that renders or links to one of the four —
 * `child-growth-ages.tsx`, `child-birthday.tsx` and `child-overview-content.tsx`
 * — so the set itself never drifts between them.
 */
export const PORTFOLIO_AGES = [2, 3, 4, 5] as const;
