"use client";

import { useQuery } from "@tanstack/react-query";
import {
  MAX_PAGE_SIZE,
  childSummarySchema,
  groupListItemSchema,
  paginated,
} from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { Checkbox, Select } from "@/components/ui/field";

/** The roster, already scoped by `canAccessChild` — see the note below. */
const childListSchema = paginated(childSummarySchema);
const groupListSchema = paginated(groupListItemSchema);

/**
 * What the form holds while somebody is choosing an audience.
 *
 * ★ `null` is "everyone", and it is not the same as every group ticked.
 *
 * The API reads an empty `targets` array as the whole kindergarten, and a
 * notice aimed that way keeps reaching families who enrol *after* it was
 * posted. Listing every current group instead would freeze the audience at the
 * moment of writing, which is a different and quieter promise.
 */
export type Audience = { groupIds: string[]; childIds: string[] } | null;

/** The API's own target shape — `{ groupId }` or `{ childId }`, never both. */
export function audienceToTargets(
  audience: Audience,
): ({ groupId: string } | { childId: string })[] {
  if (!audience) return [];
  return [
    ...audience.groupIds.map((groupId) => ({ groupId })),
    ...audience.childIds.map((childId) => ({ childId })),
  ];
}

/** The inverse, for the edit screen reading a saved notice back. */
export function targetsToAudience(
  targets: { groupId?: string | null; childId?: string | null }[],
): Audience {
  const groupIds = targets.flatMap((t) => (t.groupId ? [t.groupId] : []));
  const childIds = targets.flatMap((t) => (t.childId ? [t.childId] : []));
  return groupIds.length === 0 && childIds.length === 0 ? null : { groupIds, childIds };
}

/**
 * Who the post is for — everyone, whole groups, or named children.
 *
 * ★ Groups arrived 2026-09-06, at the client's request: "мэдээ дээр захирал
 * пост оруулахад бүх хүүхэд биш, шууд бүлэг рүү юм бичдэг болгох… бүлэг сонгох,
 * бүх бүлэг".
 *
 * The picker offered two states — everyone, or a list of individual children —
 * and a director writing to Дэлбээ had to tick twenty-four names. Worse, that
 * is not the same notice: a child enrolled next week is in the group and is not
 * in a list of twenty-four ids, so the two versions drift apart the moment the
 * roster changes.
 *
 * **The API has taken group targets since it was written.** `targetSchema` in
 * `notifications.dto.ts` accepts `{ groupId }` or `{ childId }` and the
 * repository reads both when deciding who may see a notice — only this picker
 * could not say it. So this is a control catching up with its endpoint, not a
 * new capability.
 *
 * ★★ Children stay, one level down.
 *
 * "Дэлбээгийн эцэг эхэд" and "эдгээр гурван гэр бүлд" are different messages
 * and a product that can only send the first is a product people work around
 * by writing to everyone. The group choice is the default because it is the
 * common one; the child list opens under it.
 *
 * ★★★ Both lists are the caller's own scope. `GET /children` and `GET /groups`
 * are scoped by the actor's memberships, so a teacher sees their group and a
 * director sees all of them — and no filtering happens here. A picker that
 * decided its own list would be the second place that answers "whose children
 * are these", which §1.1 exists to prevent.
 *
 * ★★★★ Shared by the compose screen and the edit screen since 2026-08-31. A
 * copied audience picker is how "Бүх хүүхэд" comes to mean two different
 * things.
 */
export function AudiencePicker({
  value,
  onChange,
  disabled,
  showSummary = true,
}: {
  value: Audience;
  onChange: (next: Audience) => void;
  disabled: boolean;
  /** The compact composer already makes the selected audience explicit. */
  showSummary?: boolean;
}) {
  const groups = useQuery({
    queryKey: qk.groups({ pageSize: 100 }),
    // The same key every register uses, so this usually reads a warm cache.
    queryFn: () => get("/groups?page=1&pageSize=100", groupListSchema),
    staleTime: 60_000,
  });

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

      ★★ Fetched only while the child list is open. Choosing a group is now the
      common path, and a roster of a hundred children was being pulled on every
      compose regardless.
    */
    queryKey: qk.children({ pageSize: MAX_PAGE_SIZE }),
    queryFn: () => get(`/children?pageSize=${MAX_PAGE_SIZE}`, childListSchema),
    enabled: value !== null,
  });

  const groupItems = groups.data?.items ?? [];
  const childItems = children.data?.items ?? [];
  const everyone = value === null;
  const groupIds = value?.groupIds ?? [];
  const childIds = value?.childIds ?? [];

  function setScope(next: "all" | "named") {
    onChange(next === "all" ? null : { groupIds: [], childIds: [] });
  }

  function toggleGroup(groupId: string) {
    const next = groupIds.includes(groupId)
      ? groupIds.filter((id) => id !== groupId)
      : [...groupIds, groupId];
    onChange({ groupIds: next, childIds });
  }

  function toggleChild(childId: string) {
    const next = childIds.includes(childId)
      ? childIds.filter((id) => id !== childId)
      : [...childIds, childId];
    onChange({ groupIds, childIds: next });
  }

  const named = groupIds.length + childIds.length;

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-body font-medium text-ink">Хэнд харагдах</legend>

      {/*
        ★ A two-option select rather than the checkbox this used to be.

        "Бүх хүүхэд" as a tick made the alternative unnamed — unticking it left
        a blank area and you had to infer that a list was about to appear. Two
        named options say what the second state is before you are in it.
      */}
      <Select
        aria-label="Хэнд харагдах"
        value={everyone ? "all" : "named"}
        disabled={disabled}
        onChange={(event) => setScope(event.target.value as "all" | "named")}
        className="max-w-[280px]"
      >
        <option value="all">Бүх хүүхэд</option>
        <option value="named">Сонгосон бүлэг, хүүхэд</option>
      </Select>

      {!everyone ? (
        <div className="flex flex-col gap-3">
          <div>
            <p className="mb-1.5 text-caption font-medium text-muted">Бүлэг</p>
            {groups.isLoading ? (
              <p className="text-caption text-muted">Ачаалж байна…</p>
            ) : groupItems.length === 0 ? (
              <p className="text-caption text-muted">Бүлэг олдсонгүй.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {groupItems.map((group) => (
                  <li key={group.id}>
                    <Checkbox
                      label={group.name}
                      checked={groupIds.includes(group.id)}
                      disabled={disabled}
                      onChange={() => toggleGroup(group.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/*
            ★ Open, not folded — 2026-09-10, at the client's request that
            choosing from all the children be visible straight away.

            It sat behind a `<details>` whose note said why: forty checkboxes
            under the group list would push the publish button off a phone
            screen. That concern is real and is answered by the height cap
            below rather than by the fold — the list scrolls inside its own
            220px, so it can be open without moving anything under it. What
            the fold cost was a teacher having to know the option existed.
          */}
          <div className="rounded-card border border-border">
            <p className="px-3.5 py-2.5 text-body text-ink">
              Тодорхой хүүхэд сонгох
              {childIds.length > 0 ? (
                <span className="text-muted"> · {childIds.length} сонгосон</span>
              ) : null}
            </p>

            <div className="max-h-[220px] overflow-y-auto border-t border-border p-3">
              {children.isLoading ? (
                <p className="text-caption text-muted">Ачаалж байна…</p>
              ) : childItems.length === 0 ? (
                <p className="text-caption text-muted">Хүүхэд олдсонгүй.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {childItems.map((child) => (
                    <li key={child.id}>
                      <Checkbox
                        label={`${child.lastName ? `${child.lastName} ` : ""}${child.firstName}`}
                        checked={childIds.includes(child.id)}
                        disabled={disabled}
                        onChange={() => toggleChild(child.id)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {showSummary ? (
        <p className="text-caption text-muted">
          {everyone
            ? "Бүх бүлгийн эцэг эхэд харагдана."
            : named === 0
              ? "Хараахан сонгоогүй байна — сонгохгүй бол бүх бүлэгт харагдана."
              : `${groupIds.length} бүлэг, ${childIds.length} хүүхдийн эцэг эхэд харагдана.`}
        </p>
      ) : null}
    </fieldset>
  );
}
