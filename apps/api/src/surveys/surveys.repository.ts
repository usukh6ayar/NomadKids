import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import type { SurveyQuestionType, SurveyScope, SurveyStatus } from "../domain/enums";

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
}
