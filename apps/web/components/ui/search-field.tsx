"use client";

import { Search } from "lucide-react";
import { Input } from "@/components/ui/field";

/**
 * The search box, once — Order А/261, шалгуур 21.
 *
 * ★ The API half of this criterion was a shared `searchTermSchema`; this is its
 * counterpart on the screen, and it is here for the same reason.
 *
 * Six lists had a search box before 2026-09-05 and each had written one out by
 * hand: two carried the magnifying glass and four did not, the placeholders
 * disagreed about whether they described the fields being searched, and one
 * `aria-label` said "Нэрээр хайх" on a control that also matched a username.
 * None of that is a bug in any one screen — it is the thing criterion 21 calls
 * "жигд биш", and a person who has to relearn the control on every page has
 * been given six features rather than one.
 *
 * ★★ It is deliberately **not** debounced here.
 *
 * `useDebounced` is the caller's, because the delay belongs with the query: a
 * list that resets to page 1 on every keystroke needs the debounce *before*
 * the reset, and a component that debounced internally would make that
 * impossible to express. `documents/page.tsx` is the worked example.
 */
export function SearchField({
  label,
  placeholder,
  value,
  onChange,
  className,
}: {
  /**
   * What the control is, for a screen reader — and it should name the fields
   * that are actually searched. "Нэрээр хайх" on a box that also matches a
   * registration number tells a blind reader the search failed when it did
   * not.
   */
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={`relative min-w-[200px] flex-1 ${className ?? ""}`}>
      <Search
        size={18}
        aria-hidden="true"
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
      />
      <Input
        type="search"
        aria-label={label}
        placeholder={placeholder ?? label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-11"
      />
    </div>
  );
}
