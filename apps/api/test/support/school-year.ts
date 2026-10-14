/**
 * A school year running September to May — from June the coming one. Test
 * data only; sign-up no longer creates a year (the user, 2026-10-14).
 */
export function currentSchoolYear(today: Date): { name: string; startsOn: Date; endsOn: Date } {
  const year = today.getUTCFullYear();
  const start = today.getUTCMonth() >= 5 ? year : year - 1;
  return {
    name: `${start}-${start + 1}`,
    startsOn: new Date(Date.UTC(start, 8, 1)),
    endsOn: new Date(Date.UTC(start + 1, 4, 31)),
  };
}
