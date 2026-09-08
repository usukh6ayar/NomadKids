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
    clonedFromSurveyId?: string | null;
  }) {
    return this.prisma.survey.create({ data });
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

  async findResponse(surveyId: string, respondentId: string, childId: string | null) {
    return this.prisma.surveyResponse.findFirst({
      where: { surveyId, respondentId, childId, deletedAt: null },
      select: { id: true },
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
