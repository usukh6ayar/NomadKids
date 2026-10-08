import type { Feedback, FeedbackRelation } from "@kinder/contracts";
import type { FeedbackRow } from "./feedback.repository";

/** «ээж», «аав», «асран хамгаалагч» — the response carries text, the request a code. */
export const FEEDBACK_RELATION_LABEL: Record<FeedbackRelation, string> = {
  MOTHER: "ээж",
  FATHER: "аав",
  GUARDIAN: "асран хамгаалагч",
};

/** «Д.Сувдаа» — the овог's initial, then the given name. */
export function shortName(person: { lastName: string; firstName: string }): string {
  const initial = Array.from(person.lastName.trim())[0];
  return initial ? `${initial}.${person.firstName}` : person.firstName;
}

/**
 * One item as `viewer` reads it.
 *
 * ★ The only place an anonymous item is redacted, for both routes. The family
 * reads their own item whole — they wrote it. The administration reads an
 * anonymous one without the author, the child, the relation or the group:
 * in a kindergarten of four groups, "Нарлаг бүлэг, Тэмүүлэн" names a family
 * as surely as a signature does.
 */
export function toFeedbackView(row: FeedbackRow, viewer: "author" | "admin"): Feedback {
  const hidden = viewer === "admin" && row.anonymous;
  const lead = row.group?.teachers[0]?.membership.user;

  return {
    id: row.id,
    category: row.category,
    body: row.body,
    anonymous: row.anonymous,
    author: hidden
      ? null
      : {
          firstName: row.author.firstName,
          lastName: row.author.lastName,
          phone: row.author.phone,
        },
    childName: hidden ? null : row.child.firstName,
    relation: hidden || !row.relation ? null : FEEDBACK_RELATION_LABEL[row.relation],
    groupId: hidden ? null : (row.group?.id ?? null),
    groupName: hidden ? null : (row.group?.name ?? null),
    teacherName: hidden || !lead ? null : shortName(lead),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
    reply:
      row.replyBody !== null && row.repliedAt
        ? { body: row.replyBody, repliedAt: row.repliedAt.toISOString(), signature: null }
        : null,
  };
}
