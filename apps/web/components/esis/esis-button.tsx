"use client";

import { Button, type ButtonProps } from "@/components/ui/button";

/**
 * The one «ESIS татах» button — client, 2026-10-06: "ЭСИС-ээс татах энэ
 * товчнууд загвар бүх газар өөр байна ижил болго ESIS татах icon байхгүй".
 *
 * It had nine spellings across the product — «Esis татах», «ЭСИС-ээс
 * татах», «ESIS-ээс татах», «ESIS Суралцагч», «Суралцагч татах» — behind four
 * different icons (refresh, database, download, cloud) and two sizes. Every
 * screen that pulls from the ministry now draws this: the same words, no
 * icon, the same secondary button, and «Татаж байна…» while it works.
 *
 * ★ Only the look is fixed. What a press does stays with the screen, which
 * passes its own `onClick` and says when it is `pending`.
 */
export function EsisButton({
  pending = false,
  disabled,
  ...props
}: Omit<ButtonProps, "children" | "variant" | "size"> & {
  /** The pull is running: the label says so and the button rests. */
  pending?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      aria-busy={pending || undefined}
      disabled={pending || disabled}
      {...props}
    >
      {pending ? "Татаж байна…" : "ESIS татах"}
    </Button>
  );
}
