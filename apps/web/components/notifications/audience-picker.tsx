"use client";

import { useQuery } from "@tanstack/react-query";
import { MAX_PAGE_SIZE, childSummarySchema, paginated } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { Checkbox } from "@/components/ui/field";

/** The roster, already scoped by `canAccessChild` — see the note below. */
const childListSchema = paginated(childSummarySchema);

/**
 * Who the post is for — everyone, or named children.
 *
 * ★ `null` is "Бүх хүүхэд", and it is not the same as every child ticked.
 *
 * The API reads an empty `targets` array as the whole kindergarten, and a
 * notice aimed that way keeps reaching families who enrol *after* it was
 * posted. Listing every current child instead would freeze the audience at the
 * moment of writing, which is a different and quieter promise. Ticking children
 * individually is the deliberate narrowing; the default stays broad.
 *
 * ★★ The roster is the teacher's own group. `GET /children` is already scoped
 * by `canAccessChild`, so this shows exactly the children they may write about
 * and no filtering happens here — a picker that decided its own list would be
 * the second place that answers "whose children are these", which §1.1 exists
 * to prevent.
 *
 * ★★★ Shared by the compose screen and the edit screen since 2026-08-31. It
 * lived inside `notifications/new/page.tsx` while there was one caller; a
 * second one made the choice "export it or copy it", and a copied audience
 * picker is how "Бүх хүүхэд" comes to mean two different things.
 */
export function AudiencePicker({
  value,
  onChange,
  disabled,
}: {
  value: string[] | null;
  onChange: (next: string[] | null) => void;
  disabled: boolean;
}) {
  const children = useQuery({
    /*
      ★ `MAX_PAGE_SIZE`, not a number picked by eye.

      This read `?pageSize=200` and the API answered 400 every time: 100 is a
      hard ceiling, and `pagination.ts` says why — "without it,
      `?pageSize=100000` turns any list endpoint into a bulk export of a
      kindergarten's children". Importing the constant is what stops the next
      guess being 500.

      A kindergarten with more than a hundred children on one roster would need
      this picker paginated. None is close, and inventing that now would be a
      scrolling list nobody can use in place of one nobody has needed.
    */
    queryKey: qk.children({ pageSize: MAX_PAGE_SIZE }),
    queryFn: () => get(`/children?pageSize=${MAX_PAGE_SIZE}`, childListSchema),
  });

  const items = children.data?.items ?? [];
  const everyone = value === null;

  function toggle(childId: string) {
    const current = value ?? [];
    const next = current.includes(childId)
      ? current.filter((id) => id !== childId)
      : [...current, childId];
    // Unticking the last one is "everyone" again rather than "nobody", which
    // would be a post with no audience — a state the form should not be able
    // to reach.
    onChange(next.length === 0 ? null : next);
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-body font-medium text-ink">Хэнд харагдах</legend>

      <Checkbox
        label="Бүх хүүхэд"
        checked={everyone}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked ? null : [])}
      />

      {children.isLoading ? <p className="text-caption text-muted">Ачаалж байна…</p> : null}

      {!everyone && items.length > 0 ? (
        /*
          Capped and scrolled rather than a list of forty checkboxes pushing
          the publish button off the screen — the client asked for a picker
          that stays usable "олон хүүхэдтэй үед".
        */
        <div className="max-h-[220px] overflow-y-auto rounded-card border border-border p-3">
          <ul className="flex flex-col gap-2">
            {items.map((child) => (
              <li key={child.id}>
                <Checkbox
                  label={`${child.lastName ? `${child.lastName} ` : ""}${child.firstName}`}
                  checked={(value ?? []).includes(child.id)}
                  disabled={disabled}
                  onChange={() => toggle(child.id)}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!everyone && !children.isLoading && items.length === 0 ? (
        <p className="text-caption text-muted">Хүүхэд олдсонгүй.</p>
      ) : null}

      <p className="text-caption text-muted">
        {everyone
          ? "Бүх эцэг эхэд харагдана."
          : `${(value ?? []).length} хүүхдийн эцэг эхэд харагдана.`}
      </p>
    </fieldset>
  );
}
