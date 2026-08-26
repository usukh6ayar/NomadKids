import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { SurveyPeriod, SurveyQuestionType, SurveyScope, SurveyStatus } from "../domain/enums";

const questionOrder = { order: "asc" as const };

@Injectable()
export class SurveysRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Management (staff) ───────────────────────────────────────────────────

  async create(data: {
    kindergartenId: string;
    title: string;
    description: string | null;
    scope: SurveyScope;
    createdById: string;
    schoolYear?: string | null;
    period?: SurveyPeriod | null;
    clonedFromSurveyId?: string | null;
  }) {
    return this.prisma.survey.create({ data });
  }

  async findForKindergarten(kindergartenId: string) {
    return this.prisma.survey.findMany({
      where: { kindergartenId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: { questions: { orderBy: questionOrder } },
    });
  }

  /** Raw row for authorization and status checks — no visibility filter. */
  async findForAuthorization(surveyId: string) {
    return this.prisma.survey.findFirst({
      where: { id: surveyId, deletedAt: null },
      select: { id: true, kindergartenId: true, scope: true, status: true },
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

  /** Published, still-open surveys relevant to a child's kindergarten. */
  async findActiveForKindergarten(kindergartenId: string) {
    return this.prisma.survey.findMany({
      where: { kindergartenId, deletedAt: null, status: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
      include: { questions: { orderBy: questionOrder, where: { deletedAt: null } } },
    });
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
