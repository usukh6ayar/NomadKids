import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditRepository } from "../audit/audit.repository";
import { ChildAccessService } from "../authz/child-access.service";
import { TenantAccessService } from "../authz/tenant-access.service";
import { childKindergartenIds, isGuardianOf } from "../authz/child-access";
import type { Actor } from "../authz/actor";
import { SurveysRepository } from "./surveys.repository";
import type { CreateSurveyDto, SaveQuestionsDto, SubmitResponseDto } from "./surveys.dto";

@Injectable()
export class SurveysService {
  constructor(
    private readonly repo: SurveysRepository,
    private readonly childAccess: ChildAccessService,
    private readonly tenants: TenantAccessService,
    private readonly audit: AuditRepository,
  ) {}

  // ── Management — staff only ─────────────────────────────────────────────

  async create(actor: Actor, kindergartenId: string, dto: CreateSurveyDto) {
    this.tenants.assertStaff(actor, kindergartenId);

    const survey = await this.repo.create({
      kindergartenId,
      title: dto.title,
      description: dto.description ?? null,
      scope: dto.scope,
      createdById: actor.userId,
    });

    await this.audit.append({
      action: "CREATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "Survey",
      objectId: survey.id,
      metadata: { scope: dto.scope },
    });

    return survey;
  }

  async listForKindergarten(actor: Actor, kindergartenId: string) {
    this.tenants.assertStaff(actor, kindergartenId);
    return this.repo.findForKindergarten(kindergartenId);
  }

  async getOne(actor: Actor, surveyId: string) {
    const survey = await this.repo.findForAuthorization(surveyId);
    if (!survey) throw new NotFoundException();
    this.tenants.assertStaff(actor, survey.kindergartenId);

    const withQuestions = await this.repo.findWithQuestions(surveyId);
    if (!withQuestions) throw new NotFoundException();
    return withQuestions;
  }

  /** Replaces the whole question set. Only while DRAFT — publishing freezes
   * the question ids that responses will reference. */
  async saveQuestions(actor: Actor, surveyId: string, dto: SaveQuestionsDto) {
    const survey = await this.repo.findForAuthorization(surveyId);
    if (!survey) throw new NotFoundException();
    this.tenants.assertStaff(actor, survey.kindergartenId);

    if (survey.status !== "DRAFT") {
      throw new BadRequestException("Зөвхөн ноорог судалгааны асуултыг өөрчлөх боломжтой");
    }

    await this.repo.replaceQuestions(surveyId, survey.kindergartenId, dto.questions);

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: survey.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Survey",
      objectId: surveyId,
      metadata: { questionCount: dto.questions.length },
    });

    return this.repo.findWithQuestions(surveyId);
  }

  async publish(actor: Actor, surveyId: string) {
    const survey = await this.repo.findForAuthorization(surveyId);
    if (!survey) throw new NotFoundException();
    this.tenants.assertStaff(actor, survey.kindergartenId);

    if (survey.status !== "DRAFT") {
      throw new BadRequestException("Судалгаа аль хэдийн нийтлэгдсэн байна");
    }

    const withQuestions = await this.repo.findWithQuestions(surveyId);
    if (!withQuestions || withQuestions.questions.length === 0) {
      throw new BadRequestException("Асуулт нэмээгүй судалгааг нийтлэх боломжгүй");
    }

    const updated = await this.repo.setStatus(surveyId, "PUBLISHED", new Date());

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: survey.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Survey",
      objectId: surveyId,
      metadata: { status: "PUBLISHED" },
    });

    return updated;
  }

  async close(actor: Actor, surveyId: string) {
    const survey = await this.repo.findForAuthorization(surveyId);
    if (!survey) throw new NotFoundException();
    this.tenants.assertStaff(actor, survey.kindergartenId);

    if (survey.status !== "PUBLISHED") {
      throw new BadRequestException("Зөвхөн нийтлэгдсэн судалгааг хаах боломжтой");
    }

    const updated = await this.repo.setStatus(surveyId, "CLOSED", new Date());

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: survey.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Survey",
      objectId: surveyId,
      metadata: { status: "CLOSED" },
    });

    return updated;
  }

  // ── Reading for a child — parent + staff ────────────────────────────────

  /** Published surveys relevant to this child, each carrying whether this
   * actor has already answered — the card on `/home` shows one only when
   * this list is non-empty and unanswered. */
  async listActiveForChild(actor: Actor, childId: string) {
    const facts = await this.childAccess.assertCanAccess(actor, childId);
    const surveys = await this.repo.findActiveForKindergarten(facts.childKindergartenId);

    return Promise.all(
      surveys.map(async (survey) => {
        const responseChildId = survey.scope === "CHILD" ? childId : null;
        const existing = await this.repo.findResponse(survey.id, actor.userId, responseChildId);
        return { ...survey, respondedByMe: Boolean(existing) };
      }),
    );
  }

  // ── Responding ────────────────────────────────────────────────────────────

  async submitResponse(actor: Actor, surveyId: string, dto: SubmitResponseDto) {
    const survey = await this.repo.findForAuthorization(surveyId);
    if (!survey) throw new NotFoundException();

    if (survey.status !== "PUBLISHED") {
      throw new BadRequestException("Энэ судалгаа одоогоор хариулах боломжгүй байна");
    }

    let childId: string | null = null;

    if (survey.scope === "CHILD") {
      if (!dto.childId) throw new BadRequestException("Хүүхэд сонгоно уу");

      const facts = await this.childAccess.assertCanAccess(actor, dto.childId);
      // Only a guardian answers on a child's behalf — the same restriction
      // as a parent observation. A teacher's view of a child does not make
      // them the respondent.
      if (!isGuardianOf(actor, facts)) throw new NotFoundException();
      if (!childKindergartenIds(facts).has(survey.kindergartenId)) {
        throw new BadRequestException("Энэ хүүхэд өөр цэцэрлэгт харьяалагдана");
      }

      childId = dto.childId;
    } else {
      this.tenants.assertMember(actor, survey.kindergartenId);
      if (dto.childId) {
        throw new BadRequestException("Энэ судалгаанд хүүхэд сонгох шаардлагагүй");
      }
    }

    const existing = await this.repo.findResponse(surveyId, actor.userId, childId);
    if (existing) throw new BadRequestException("Та энэ судалгааг аль хэдийн бөглөсөн байна");

    const validQuestionIds = await this.repo.questionIds(surveyId);
    for (const answer of dto.answers) {
      if (!validQuestionIds.has(answer.questionId)) {
        throw new BadRequestException("Асуулт олдсонгүй");
      }
    }

    const response = await this.repo.createResponse(
      { kindergartenId: survey.kindergartenId, surveyId, childId, respondentId: actor.userId },
      dto.answers,
    );

    await this.audit.append({
      action: "CREATE",
      kindergartenId: survey.kindergartenId,
      actorUserId: actor.userId,
      objectType: "SurveyResponse",
      objectId: response.id,
      childId: childId ?? undefined,
      metadata: { surveyId },
    });

    return response;
  }

  // ── Results — staff only ────────────────────────────────────────────────

  async results(actor: Actor, surveyId: string) {
    const survey = await this.repo.findForAuthorization(surveyId);
    if (!survey) throw new NotFoundException();
    this.tenants.assertStaff(actor, survey.kindergartenId);

    const withQuestions = await this.repo.findWithQuestions(surveyId);
    if (!withQuestions) throw new NotFoundException();

    const [totalResponses, answers] = await Promise.all([
      this.repo.countResponses(surveyId),
      this.repo.allAnswers(surveyId),
    ]);

    const byQuestion = new Map<string, unknown[]>();
    for (const answer of answers) {
      const list = byQuestion.get(answer.questionId) ?? [];
      list.push(answer.value);
      byQuestion.set(answer.questionId, list);
    }

    const questions = withQuestions.questions.map((question) => {
      const values = byQuestion.get(question.id) ?? [];

      if (question.type === "TEXT") {
        return {
          question,
          responseCount: values.length,
          counts: null,
          responses: values as string[],
        };
      }

      const counts: Record<string, number> = {};
      if (question.type === "CHECKBOX") {
        for (const value of values) {
          for (const choice of value as string[]) counts[choice] = (counts[choice] ?? 0) + 1;
        }
      } else {
        // RATING or YES_NO — the value itself, stringified, is the bucket key.
        for (const value of values) {
          const key = String(value);
          counts[key] = (counts[key] ?? 0) + 1;
        }
      }

      return { question, responseCount: values.length, counts, responses: null };
    });

    return { survey: withQuestions, totalResponses, questions };
  }
}
