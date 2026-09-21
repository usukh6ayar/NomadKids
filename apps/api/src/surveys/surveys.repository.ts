import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type {
  SurveyCategory,
  SurveyKind,
  SurveyPeriod,
  SurveyQuestionType,
  SurveyScope,
  SurveyStatus,
} from "../domain/enums";

const questionOrder = { order: "asc" as const };

@Injectable()
export class SurveysRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Management (staff) ───────────────────────────────────────────────────

  async create(data: {
    kindergartenId: string;
    title: string;
    description: string | null;
    category: SurveyCategory;
    scope: SurveyScope;
    /** Optional so the clone path keeps compiling; the column defaults to FORM. */
    kind?: SurveyKind;
    closesAt?: Date | null;
    createdById: string;
    schoolYear?: string | null;
    period?: SurveyPeriod | null;
    /** Null is every group — see `Survey.groupId`. */
    groupId?: string | null;
    /* The wizard's settings — every one optional, and every default is the
       behaviour a survey had before the column existed. */
    opensAt?: Date | null;
    purpose?: string | null;
    termId?: string | null;
    isAnonymous?: boolean;
    allowMultipleResponses?: boolean;
    shuffleQuestions?: boolean;
    closingNote?: string | null;
    clonedFromSurveyId?: string | null;
  }) {
    return this.prisma.survey.create({ data });
  }

  /**
   * A term, only if it is this kindergarten's — the check `create` makes
   * before filing a survey against an id that came from a client.
   */
  async findTermInKindergarten(termId: string, kindergartenId: string) {
    return this.prisma.term.findFirst({
      where: { id: termId, kindergartenId, deletedAt: null },
      select: { id: true },
    });
  }

  /**
   * A group, only if it is this kindergarten's.
   *
   * ★ The tenant filter is the whole point of the method: `create` uses it to
   * refuse an audience from another kindergarten, so a bare `findUnique` by id
   * would defeat the check it exists to make.
   */
  async findGroupInKindergarten(groupId: string, kindergartenId: string) {
    return this.prisma.group.findFirst({
      where: { id: groupId, kindergartenId, deletedAt: null },
      select: { id: true },
    });
  }

  async findForKindergarten(kindergartenId: string) {
    return this.prisma.survey.findMany({
      where: { kindergartenId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      // `group` so the staff list can say which group a survey is aimed at
      // without a second request per row.
      include: {
        questions: { orderBy: questionOrder },
        group: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * How many families have answered each survey, and how many were asked.
   *
   * ★ Three queries for the whole list, never two per row (§3.4).
   *
   * The staff list draws "23 / 35 харуулсан" on every card, and the obvious
   * shape — `countResponses` and `countExpectedRespondents` per survey — is
   * seventy round trips for a screen with thirty-five surveys on it. The
   * denominators are not per-survey facts at all: they are per *audience*, and
   * a kindergarten has a handful of those (each group, plus "everyone"), so
   * they are counted once here and looked up per row by the caller.
   *
   * ★★ The two scopes count different populations, and that is not a detail.
   *
   * A CHILD-scope survey is answered once per enrolled child; a
   * KINDERGARTEN-scope one is answered once per parent, however many children
   * they have. Reusing one denominator would make a family of three look like
   * three non-responders on a survey they answered. `countExpectedRespondents`
   * makes the same distinction one survey at a time, and these two must agree
   * — they are the same question asked in bulk.
   */
  async participationCounts(kindergartenId: string) {
    const [responses, byGroup, parents] = await Promise.all([
      this.prisma.surveyResponse.groupBy({
        by: ["surveyId"],
        where: { kindergartenId, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.enrollment.groupBy({
        by: ["groupId"],
        where: { kindergartenId, status: "ACTIVE", deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.membership.findMany({
        where: { kindergartenId, role: "PARENT", deletedAt: null },
        select: { userId: true },
        distinct: ["userId"],
      }),
    ]);

    const childrenByGroup = new Map<string, number>();
    let childrenTotal = 0;
    for (const row of byGroup) {
      if (row.groupId) childrenByGroup.set(row.groupId, row._count._all);
      childrenTotal += row._count._all;
    }

    return {
      responded: new Map(responses.map((row) => [row.surveyId, row._count._all])),
      childrenByGroup,
      childrenTotal,
      /** Distinct people, not memberships — one parent of two children is one. */
      parentCount: parents.length,
    };
  }

  /** Raw row for authorization and status checks — no visibility filter. */
  async findForAuthorization(surveyId: string) {
    return this.prisma.survey.findFirst({
      where: { id: surveyId, deletedAt: null },
      /*
        `closesAt` is selected because `submitResponse` enforces the deadline
        from this row. An explicit select that omitted it would read
        `undefined`, and `undefined && …` is falsy — so every deadline would
        silently pass rather than fail loudly.
      */
      select: {
        id: true,
        kindergartenId: true,
        scope: true,
        status: true,
        closesAt: true,
        /*
          ★ Selected for the same reason `closesAt` is, and the note above
          applies word for word: `submitResponse` enforces both ends of the
          window from this row, and a column omitted from the select reads
          `undefined` — which is falsy, so every check would silently pass
          rather than fail loudly.
        */
        opensAt: true,
        allowMultipleResponses: true,
        isAnonymous: true,
        // Which group was asked. `participation` builds its roster from it,
        // and null is every group — see `Survey.groupId`.
        groupId: true,
      },
    });
  }

  async findWithQuestions(surveyId: string) {
    return this.prisma.survey.findFirst({
      where: { id: surveyId, deletedAt: null },
      include: { questions: { orderBy: questionOrder, where: { deletedAt: null } } },
    });
  }

  /** Replaces the whole question set. Only valid while the survey is DRAFT —
   * the service enforces that; replacing a published survey's questions
   * would orphan existing answers against ids that no longer exist. */
  async replaceQuestions(
    surveyId: string,
    kindergartenId: string,
    questions: {
      order: number;
      type: SurveyQuestionType;
      prompt: string;
      options?: unknown;
      indicatorKey?: string | null;
    }[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.surveyQuestion.deleteMany({ where: { surveyId } });
      await tx.surveyQuestion.createMany({
        data: questions.map((q) => ({
          kindergartenId,
          surveyId,
          order: q.order,
          type: q.type,
          prompt: q.prompt,
          options: (q.options ?? undefined) as object | undefined,
          // Round-tripped from the client so an edit does not break the
          // pairing — this delete-and-recreate is exactly why the key is a
          // value rather than a foreign key. See the schema's note.
          indicatorKey: q.indicatorKey ?? null,
        })),
      });
    });
  }

  async setStatus(surveyId: string, status: SurveyStatus, timestamp: Date) {
    const data: Record<string, unknown> = { status };
    if (status === "PUBLISHED") data.publishedAt = timestamp;
    if (status === "CLOSED") data.closedAt = timestamp;
    return this.prisma.survey.update({ where: { id: surveyId }, data });
  }

  /**
   * Re-opens a closed survey.
   *
   * ★ Not `setStatus(id, "PUBLISHED", now)` — that would rewrite `publishedAt`.
   *
   * A survey was published on a date, and that date is what a family's "sent on"
   * line and every report's range read. Re-opening it does not change when it
   * went out; it only takes the lock off, so `closedAt` is cleared and
   * `publishedAt` is left exactly where it was.
   */
  async reopen(surveyId: string) {
    return this.prisma.survey.update({
      where: { id: surveyId },
      data: { status: "PUBLISHED", closedAt: null },
    });
  }

  /** §3.2 — sets `deletedAt`; the row and its answers stay for the audit. */
  async softDelete(surveyId: string) {
    return this.prisma.survey.update({
      where: { id: surveyId },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Who a survey was asked of, and who has answered — the "Оролцоо" panel.
   *
   * ★ The roster comes from `Enrollment`, not from the responses.
   *
   * A list built from the answers can only ever show the families who replied,
   * which is the half nobody needs to chase. The children with nothing against
   * their name are the point of the panel, so the roster has to be the active
   * enrollments and the responses are matched onto it.
   *
   * `groupId` null is the whole kindergarten — the same "null is every group"
   * contract `Survey.groupId` carries.
   */
  async participation(surveyId: string, kindergartenId: string, groupId: string | null) {
    const [enrollments, responses] = await Promise.all([
      this.prisma.enrollment.findMany({
        where: {
          status: "ACTIVE",
          deletedAt: null,
          ...(groupId ? { groupId } : { group: { kindergartenId, deletedAt: null } }),
        },
        select: {
          child: { select: { id: true, lastName: true, firstName: true } },
          group: { select: { id: true, name: true } },
        },
      }),
      this.prisma.surveyResponse.findMany({
        where: { surveyId, deletedAt: null },
        select: {
          childId: true,
          submittedAt: true,
          respondent: { select: { id: true, lastName: true, firstName: true } },
        },
      }),
    ]);

    return { enrollments, responses };
  }

  // ── Reading (parent + staff) ─────────────────────────────────────────────

  /**
   * Published, still-open surveys relevant to a child's kindergarten.
   *
   * ★ Narrowed by the child's group since 2026-09-06.
   *
   * A survey with no `groupId` is for every group and is always included; one
   * naming a group reaches only that group's families. `groupId` here is the
   * child's *current* group — a family should see the questionnaire their
   * child's group is being asked, not one aimed at the group they left in
   * June. A child with no active enrollment sees only the kindergarten-wide
   * ones, which is the correct answer rather than a special case.
   */
  async findActiveForKindergarten(kindergartenId: string, groupId: string | null) {
    return this.prisma.survey.findMany({
      where: {
        kindergartenId,
        deletedAt: null,
        status: "PUBLISHED",
        OR: groupId ? [{ groupId: null }, { groupId }] : [{ groupId: null }],
      },
      orderBy: { publishedAt: "desc" },
      include: {
        questions: { orderBy: questionOrder, where: { deletedAt: null } },
        group: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * The group a child is enrolled in right now, or null.
   *
   * Read here rather than off `ChildAccessFacts`: those enrollments are the
   * whole history with no status on them, deliberately — `child-access.ts`
   * explains why authorization must read history. "Which group is this child
   * in today" is a different question and needs the current row.
   */
  async activeGroupIdForChild(childId: string): Promise<string | null> {
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { childId, status: "ACTIVE", deletedAt: null },
      orderBy: { startedOn: "desc" },
      select: { groupId: true },
    });
    return enrollment?.groupId ?? null;
  }

  /**
   * This respondent's own response, with what they answered.
   *
   * ★ `answers` added 2026-09-13, for the family's list — it says not only
   * that they replied but what they said. One query rather than a second read
   * per survey: `listActiveForChild` already calls this once per survey, and
   * asking for the answers separately would double a loop §3.4 is watching.
   *
   * Keyed on `respondentId` and the child, so the rows can only ever be the
   * asker's own. `orderBy` the question's order, so the screen renders the
   * questionnaire in the order it was asked without sorting it again.
   */
  async findResponse(surveyId: string, respondentId: string, childId: string | null) {
    return this.prisma.surveyResponse.findFirst({
      where: { surveyId, respondentId, childId, deletedAt: null },
      select: {
        id: true,
        answers: {
          select: { questionId: true, value: true },
          orderBy: { question: { order: "asc" } },
        },
      },
    });
  }

  // ── Responding ────────────────────────────────────────────────────────────

  async createResponse(
    data: {
      kindergartenId: string;
      surveyId: string;
      childId: string | null;
      respondentId: string;
    },
    answers: { questionId: string; value: unknown }[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      const response = await tx.surveyResponse.create({ data });
      await tx.surveyAnswer.createMany({
        data: answers.map((a) => ({
          kindergartenId: data.kindergartenId,
          responseId: response.id,
          questionId: a.questionId,
          value: a.value as object,
        })),
      });
      return response;
    });
  }

  /**
   * This respondent's own answers to one survey.
   *
   * ★ Their own, and only their own — this is a *parent's* read path.
   *
   * A poll shows a family how the class voted and which option they picked,
   * so the tally comes from `allAnswers` (counts, no identities) and the
   * highlight comes from here (one row, keyed by the person asking). Keeping
   * them in two queries is what stops the second becoming a way to ask which
   * of my neighbours chose what.
   */
  async findMyAnswers(surveyId: string, respondentId: string, childId: string | null) {
    return this.prisma.surveyAnswer.findMany({
      where: {
        response: { surveyId, respondentId, childId, deletedAt: null },
      },
      select: { questionId: true, value: true },
    });
  }

  /**
   * Appends one choice to a question's `options`, and answers what happened.
   *
   * ★ Read and write inside one transaction, because two parents will do this
   * at the same time.
   *
   * `options` is a `Json` column holding an array, so "add one" is a
   * read-modify-write with no database-level append. Done outside a
   * transaction, two families adding a choice in the same second each read the
   * same list and the second write silently discards the first's option — a
   * lost update that looks exactly like the feature not working.
   *
   * ★★ Returns `null` when the question is gone, and the unchanged list when
   * the label is already there. The caller needs to tell those apart: one is a
   * 404 and the other is success — a parent who adds a choice somebody else
   * added a moment ago got what they wanted.
   */
  async appendQuestionOption(
    questionId: string,
    label: string,
    max: number,
  ): Promise<{ options: string[]; added: boolean; full: boolean } | null> {
    return this.prisma.$transaction(async (tx) => {
      const question = await tx.surveyQuestion.findFirst({
        where: { id: questionId, deletedAt: null },
        select: { id: true, options: true },
      });
      if (!question) return null;

      const options = Array.isArray(question.options)
        ? question.options.filter((o): o is string => typeof o === "string")
        : [];

      // Case-insensitive, because "Тийм" and "тийм" are one choice to everyone
      // except a string comparison.
      const already = options.some((o) => o.toLowerCase() === label.toLowerCase());
      if (already) return { options, added: false, full: false };
      if (options.length >= max) return { options, added: false, full: true };

      const next = [...options, label];
      await tx.surveyQuestion.update({ where: { id: questionId }, data: { options: next } });
      return { options: next, added: true, full: false };
    });
  }

  /** Every valid question id for this survey — used to reject an answer
   * naming a question from another survey. */
  async questionIds(surveyId: string): Promise<Set<string>> {
    const rows = await this.prisma.surveyQuestion.findMany({
      where: { surveyId, deletedAt: null },
      select: { id: true },
    });
    return new Set(rows.map((r) => r.id));
  }

  // ── Results (staff) ──────────────────────────────────────────────────────

  async countResponses(surveyId: string): Promise<number> {
    return this.prisma.surveyResponse.count({ where: { surveyId, deletedAt: null } });
  }

  /** Every answer for this survey, joined to its question — aggregated in
   * application code rather than SQL, since a kindergarten's response volume
   * (dozens of families, not thousands) makes that the simpler, cheaper
   * choice over a hand-written GROUP BY per question type. */
  async allAnswers(surveyId: string) {
    return this.prisma.surveyAnswer.findMany({
      where: { response: { surveyId, deletedAt: null } },
      select: { questionId: true, value: true },
    });
  }

  /**
   * Every answer again, this time carrying the group the answer is *about*.
   *
   * ★ The group comes from the child's active enrolment, not from the
   * respondent.
   *
   * A guardian is not in a group; their child is. And a family with two
   * children in two groups answers a survey twice — once per child — so the
   * responder is the wrong key entirely: it would file both answers under one
   * person and lose which group each was about.
   *
   * ★★ Two queries, not one per response.
   *
   * The enrolments are fetched as a set and joined in memory, the same trade
   * `allAnswers` documents above: a kindergarten's response volume is dozens,
   * and a per-response lookup is the N+1 §3.4 forbids.
   *
   * A response with no child — a survey aimed at staff — carries `groupId:
   * null` and is counted under "Бүлэггүй" rather than dropped, because a
   * breakdown whose parts do not sum to the total is a breakdown nobody can
   * check.
   */
  async answersByGroup(surveyId: string, kindergartenId: string) {
    const [answers, enrollments] = await Promise.all([
      this.prisma.surveyAnswer.findMany({
        where: { response: { surveyId, deletedAt: null } },
        select: {
          questionId: true,
          value: true,
          responseId: true,
          response: { select: { childId: true } },
        },
      }),
      this.prisma.enrollment.findMany({
        where: { kindergartenId, status: "ACTIVE", deletedAt: null },
        select: { childId: true, group: { select: { id: true, name: true } } },
      }),
    ]);

    const groupOfChild = new Map(
      enrollments.map((e) => [e.childId, e.group ? { id: e.group.id, name: e.group.name } : null]),
    );

    return answers.map((answer) => ({
      questionId: answer.questionId,
      value: answer.value,
      responseId: answer.responseId,
      group: answer.response.childId ? (groupOfChild.get(answer.response.childId) ?? null) : null,
    }));
  }

  /**
   * Every answer with the child it was given about — the roster behind
   * "Хариултууд".
   *
   * ★ Two queries and a join in memory, the trade `answersByGroup` above
   * documents: a kindergarten's response volume is dozens, and a per-answer
   * child lookup is the N+1 §3.4 forbids.
   *
   * ★★ The child, not the respondent. A guardian with two children answers a
   * CHILD survey twice, and the list a teacher reads is "what was said about
   * each child" — filing both answers under one parent would lose which child
   * each was about. Responses with no child (a survey asked of the family)
   * carry a null and the caller drops them: there is no roster row to show
   * them against.
   */
  async answersWithChild(surveyId: string, questionId: string) {
    const answers = await this.prisma.surveyAnswer.findMany({
      where: { questionId, response: { surveyId, deletedAt: null } },
      select: { value: true, response: { select: { childId: true } } },
    });

    const childIds = [
      ...new Set(answers.map((row) => row.response.childId).filter((id): id is string => !!id)),
    ];
    if (childIds.length === 0) return [];

    const children = await this.prisma.child.findMany({
      where: { id: { in: childIds }, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
    });
    const byId = new Map(children.map((child) => [child.id, child]));

    return answers.flatMap((row) => {
      const child = row.response.childId ? byId.get(row.response.childId) : undefined;
      return child ? [{ child, value: row.value }] : [];
    });
  }

  /**
   * How many responses this survey *should* collect — the denominator behind
   * the client's "Бөглөөгүй".
   *
   * ★ Two different populations, because the two scopes ask two different
   * questions of two different people.
   *
   * A `CHILD` survey is answered once per child, by a guardian — so the
   * expected count is actively enrolled children, narrowed to one group when
   * the results view is. A `KINDERGARTEN` survey is answered once per person,
   * so it counts guardians with a live membership instead. Using children for
   * both would tell a family with two children that they owe two answers to a
   * survey that accepts one.
   *
   * ★★ "Active enrolment", the same condition `answersByGroup` uses. A child
   * who left in October is not someone the November survey is waiting on, and
   * counting them would make full participation permanently unreachable.
   */
  async countExpectedRespondents(
    kindergartenId: string,
    scope: SurveyScope,
    groupId: string | null,
  ): Promise<number> {
    if (scope === "CHILD") {
      return this.prisma.enrollment.count({
        where: {
          kindergartenId,
          status: "ACTIVE",
          deletedAt: null,
          ...(groupId ? { groupId } : {}),
        },
      });
    }

    /*
      Distinct users, not memberships: one person may guardian two children and
      still answers a kindergarten-wide survey once. `distinct` on the row and
      a length read rather than `count`, because Prisma's `count` ignores
      `distinct` on a non-aggregate field.
    */
    const rows = await this.prisma.membership.findMany({
      where: { kindergartenId, role: "PARENT", deletedAt: null },
      select: { userId: true },
      distinct: ["userId"],
    });

    return rows.length;
  }

  // ── Comparison and export — RFP Module 1.2, 1.3 ───────────────────────────

  /**
   * A whole wave: its questions, every answer, and who submitted each.
   *
   * ★ Three joins in one query rather than a query per response.
   *
   * The workbook needs the respondent's name and role on every raw-data row.
   * Fetching those per answer would be four thousand round trips for a
   * three-hundred-child survey — the N+1 CLAUDE.md §3.4 forbids, in a request
   * an administrator is waiting on.
   */
  async loadWave(surveyId: string) {
    return this.prisma.survey.findFirst({
      where: { id: surveyId, deletedAt: null },
      include: {
        questions: { orderBy: questionOrder, where: { deletedAt: null } },
        responses: {
          where: { deletedAt: null },
          include: {
            respondent: { select: { id: true, lastName: true, firstName: true } },
            answers: { select: { questionId: true, value: true, responseId: true } },
          },
        },
      },
    });
  }

  /**
   * The wave this one should be compared against.
   *
   * Prefers the survey it was cloned from, since that is an explicit statement
   * of "these two are the same questionnaire". Falls back to the same school
   * year's BASELINE, which is what Module 1.2 describes when nobody used the
   * clone action.
   */
  async findBaselineFor(survey: {
    id: string;
    kindergartenId: string;
    schoolYear: string | null;
    clonedFromSurveyId: string | null;
  }) {
    if (survey.clonedFromSurveyId) {
      const source = await this.prisma.survey.findFirst({
        where: { id: survey.clonedFromSurveyId, deletedAt: null },
        select: { id: true },
      });
      if (source) return source;
    }

    if (!survey.schoolYear) return null;

    return this.prisma.survey.findFirst({
      where: {
        kindergartenId: survey.kindergartenId,
        schoolYear: survey.schoolYear,
        period: "BASELINE",
        deletedAt: null,
        id: { not: survey.id },
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
  }

  /** Earlier school years' final waves — Sheet 5's year-over-year columns. */
  async findPriorYearWaves(kindergartenId: string, beforeSchoolYear: string) {
    return this.prisma.survey.findMany({
      where: {
        kindergartenId,
        deletedAt: null,
        period: "ENDLINE",
        schoolYear: { lt: beforeSchoolYear },
      },
      orderBy: { schoolYear: "desc" },
      // Two prior years is what Module 1.2's example spans ("2024-2025,
      // 2025-2026 гэх мэт"); an unbounded walk would make the sheet grow
      // without limit as the kindergarten accumulates history.
      take: 3,
      select: { id: true },
    });
  }

  /** The children a workbook names, with the group each is enrolled in. */
  async childrenForExport(kindergartenId: string, childIds: string[]) {
    if (childIds.length === 0) return [];

    return this.prisma.child.findMany({
      where: { id: { in: childIds }, kindergartenId, deletedAt: null },
      select: {
        id: true,
        lastName: true,
        firstName: true,
        dateOfBirth: true,
        sex: true,
        enrollments: {
          where: { status: "ACTIVE", deletedAt: null },
          take: 1,
          select: { group: { select: { name: true } } },
        },
      },
    });
  }

  /** The kindergarten's name, for the workbook's Summary sheet. */
  async kindergartenName(kindergartenId: string) {
    const row = await this.prisma.kindergarten.findFirst({
      where: { id: kindergartenId, deletedAt: null },
      select: { name: true },
    });

    return row?.name ?? "";
  }

  /** Copies a survey's questions onto a new survey, order and keys intact. */
  async cloneQuestions(fromSurveyId: string, toSurveyId: string, kindergartenId: string) {
    const questions = await this.prisma.surveyQuestion.findMany({
      where: { surveyId: fromSurveyId, deletedAt: null },
      orderBy: questionOrder,
    });

    if (questions.length === 0) return 0;

    await this.prisma.surveyQuestion.createMany({
      data: questions.map((q) => ({
        kindergartenId,
        surveyId: toSurveyId,
        order: q.order,
        type: q.type,
        prompt: q.prompt,
        options: q.options as object | undefined,
        // The whole point of the clone: the key travels, so the two waves'
        // questions pair even after the copy is edited.
        indicatorKey: q.indicatorKey,
      })),
    });

    return questions.length;
  }
}
