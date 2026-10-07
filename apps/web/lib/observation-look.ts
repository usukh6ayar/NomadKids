/**
 * How the observation forms look — shared by «… шинээр бичих» and «… засах»
 * so the two cannot drift apart (client, 2026-10-07: the edit dialog was
 * still the old design after the compose page changed).
 */

/** Small, round pickers. 44px still, the tap floor. */
export const PICK = "h-11 rounded-pill px-3.5 text-compact";
export const PICK_FIELD = "gap-1 [&>label]:text-caption [&>label]:text-muted";

/**
 * Each kind under its own name and colour — the hub's (`observation-hub.tsx`
 * `KINDS`): Ажиглалт green, Ярилцлага blue, Бүтээл orange, on the chosen
 * level and on Хадгалах.
 */
export const KIND_LOOK: Record<string, { title: string; edit: string; fill: string }> = {
  daily: {
    title: "Ажиглалт шинээр бичих",
    edit: "Ажиглалт засах",
    fill: "bg-mint-bright text-white hover:bg-mint-solid",
  },
  conversation: {
    title: "Ярилцлага шинээр бичих",
    edit: "Ярилцлага засах",
    fill: "bg-sky-bright text-white hover:bg-sky-solid",
  },
  artwork: {
    title: "Бүтээл шинээр нэмэх",
    edit: "Бүтээл засах",
    fill: "bg-peach-bright text-white hover:bg-peach-solid",
  },
};
