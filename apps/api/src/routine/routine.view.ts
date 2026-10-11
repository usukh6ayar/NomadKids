import type { AreaPlan, Club, ClubRequest, Routine, RoutineItem } from "@kinder/contracts";
import { shortName } from "../feedback/feedback.view";
import type { ClubRequestRow, ClubRow } from "./routine.repository";

export function clubView(row: ClubRow): Club {
  return {
    id: row.id,
    name: row.name,
    teacherName: row.teacherName,
    room: row.room,
    days: row.days,
    start: row.startTime,
    end: row.endTime,
    areas: row.areas,
    goal: row.goal,
  };
}

export function requestView(row: ClubRequestRow): ClubRequest {
  return {
    id: row.id,
    clubId: row.clubId,
    childId: row.childId,
    childName: shortName(row.child),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

export function routineView(
  group: { id: string; name: string },
  routine: { items: unknown; plan: unknown; updatedAt: Date } | null,
  clubs: ClubRow[],
  requests: ClubRequestRow[],
): Routine {
  return {
    group: { id: group.id, name: group.name },
    // Written only through the contract's schemas, so read back as those shapes.
    items: (routine?.items ?? []) as RoutineItem[],
    plan: (routine?.plan ?? []) as AreaPlan[],
    clubs: clubs.map(clubView),
    requests: requests.map(requestView),
    updatedAt: routine?.updatedAt.toISOString() ?? null,
  };
}
