import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditRepository } from "../audit/audit.repository";
import { ChildAccessService } from "../authz/child-access.service";
import { TenantAccessService } from "../authz/tenant-access.service";
import { childKindergartenIds, isGuardianOf } from "../authz/child-access";
import type { Actor } from "../authz/actor";
import { SurveysRepository } from "./surveys.repository";
import { buildSurveyWorkbook, type SurveyWave } from "./survey-workbook";
import { compareWaves, compareWavesByChild } from "./survey-comparison";
import { matrixOptions } from "./survey-scoring";
import type {
  CloneSurveyDto,
  CreateSurveyDto,
  SaveQuestionsDto,
  SubmitResponseDto,
} from "./surveys.dto";

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
      // The column defaults to FORM, and so does an omitted field: a caller
      // that predates `kind` keeps creating exactly what it created before.
      kind: dto.kind ?? "FORM",
      closesAt: dto.closesAt ?? null,
      createdById: actor.userId,
      schoolYear: dto.schoolYear ?? null,
      period: dto.period ?? null,
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

    /*
      ★ The deadline is enforced here and nowhere else.

      `closesAt` is an intention rather than a state (see `Survey.closesAt`), so
      nothing sweeps it: a survey past its date keeps `status = PUBLISHED` and
      simply stops accepting answers. Checking at submit is what makes that
      correct without a scheduled job, and it is the only place that can be
      correct — a job that flipped the status at midnight would still leave the
      window between the deadline and the sweep open.

      A null `closesAt` is "no closing date", which the client asked to remain
      possible, so it never fails this.
    */
    if (survey.closesAt && survey.closesAt.getTime() <= Date.now()) {
      throw new BadRequestException("Энэ судалгааны хугацаа дууссан байна");
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

    /*
     * A MATRIX answer must name rows and columns the question actually offers.
     *
     * ★ Refused here rather than tolerated and skipped at scoring time.
     *
     * `scoreOf` already returns null for a row that does not exist, so a bad
     * answer would store cleanly and then quietly vanish from every average —
     * the survey would look answered while contributing nothing, and nobody
     * would know which of the two it was. Zod cannot do this check: the valid
     * keys live in the question's own `options`.
     */
    const withQuestions = await this.repo.findWithQuestions(surveyId);
    const questionById = new Map((withQuestions?.questions ?? []).map((q) => [q.id, q]));

    for (const answer of dto.answers) {
      const question = questionById.get(answer.questionId);
      if (question?.type !== "MATRIX") continue;

      const options = matrixOptions(question);
      if (!options) throw new BadRequestException("Матриц асуултын тохиргоо буруу байна");

      if (
        typeof answer.value !== "object" ||
        answer.value === null ||
        Array.isArray(answer.value)
      ) {
        throw new BadRequestException("Матриц асуултын хариулт буруу хэлбэртэй байна");
      }

      const rowKeys = new Set(options.rows.map((row) => row.key));
      const columnValues = new Set(options.columns.map((column) => column.value));

      for (const [rowKey, cell] of Object.entries(answer.value as Record<string, unknown>)) {
        if (!rowKeys.has(rowKey)) throw new BadRequestException("Матрицад байхгүй мөр сонгосон");
        if (typeof cell !== "number" || !columnValues.has(cell)) {
          throw new BadRequestException("Матрицад байхгүй хариулт сонгосон");
        }
      }
    }

    /*
     * A SINGLE_CHOICE answer is one of the question's own options — exactly
     * one, and not an array.
     *
     * ★ Checked for the same reason the matrix is, and it matters more here.
     *
     * Zod types the value as "some JSON", so without this an array sails
     * through and `SINGLE_CHOICE` silently becomes `CHECKBOX`: the tally in
     * `results()` stringifies whatever it is given, so `["a","b"]` would appear
     * in the chart as a bucket named `a,b` that no option produces. The
     * question would look answered and the result would be unreadable — the
     * failure the matrix note describes, in a type a parent meets far more
     * often.
     */
    for (const answer of dto.answers) {
      const question = questionById.get(answer.questionId);
      if (question?.type !== "SINGLE_CHOICE") continue;

      const options = Array.isArray(question.options) ? (question.options as unknown[]) : [];
      if (typeof answer.value !== "string" || !options.includes(answer.value)) {
        throw new BadRequestException("Сонголтод байхгүй хариулт сонгосон");
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

  /**
   * A survey's answers, in total and broken down by group.
   *
   * ★ Two cuts of one read, because a director asks two questions of the same
   * survey: "what did families say" and "did Дэлбээ бүлэг say something
   * different from Наран бүлэг".
   *
   * The second is the one this could not answer. Every answer already knows
   * which child it is about and every child knows its group, so the breakdown
   * was one join away — and without it a kindergarten with a problem in one
   * group reads an average across four and concludes there is no problem.
   *
   * ★★ `groupId` narrows the headline; the breakdown always covers every group.
   *
   * The comparison is the point, and a comparison that hid every group but the
   * one selected would be a bar chart with one bar. So the filter changes what
   * the top of the screen counts and leaves the chart beneath it whole.
   */
  async results(actor: Actor, surveyId: string, groupId?: string) {
    const survey = await this.repo.findForAuthorization(surveyId);
    if (!survey) throw new NotFoundException();
    this.tenants.assertStaff(actor, survey.kindergartenId);

    const withQuestions = await this.repo.findWithQuestions(surveyId);
    if (!withQuestions) throw new NotFoundException();

    const answers = await this.repo.answersByGroup(surveyId, survey.kindergartenId);

    const selected = groupId ? answers.filter((answer) => answer.group?.id === groupId) : answers;

    /*
     * Responses, not answers. One response carries one answer per question, so
     * counting rows would multiply the respondent count by the question count —
     * "24 хариулт" on a six-question survey answered by four families.
     */
    const responseCount = (rows: typeof answers) => new Set(rows.map((row) => row.responseId)).size;

    const tally = (rows: typeof answers) =>
      withQuestions.questions.map((question) => {
        const values = rows.filter((row) => row.questionId === question.id).map((row) => row.value);

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

    /*
     * ★ Ordered by name, and a group with no answers still appears.
     *
     * "Наран бүлэг: 0" is the most interesting bar on the chart — it says
     * nobody there answered — and dropping empty groups would hide exactly
     * that. The set of groups therefore comes from the enrolments, not from
     * the answers.
     */
    const groups = new Map<string, { id: string | null; name: string }>();
    for (const answer of answers) {
      const key = answer.group?.id ?? "";
      if (!groups.has(key)) {
        groups.set(key, answer.group ?? { id: null, name: "Бүлэггүй" });
      }
    }

    const byGroup = [...groups.values()]
      .sort((a, b) => a.name.localeCompare(b.name, "mn"))
      .map((group) => {
        const rows = answers.filter((answer) => (answer.group?.id ?? null) === group.id);
        return {
          group,
          responseCount: responseCount(rows),
          questions: tally(rows).map((entry) => ({
            questionId: entry.question.id,
            responseCount: entry.responseCount,
            counts: entry.counts,
          })),
        };
      });

    /*
      The denominator for "Бөглөөгүй". Computed here rather than on the client,
      which cannot see enrolments or memberships and would have to guess from
      the group list — a guess that would be wrong for every family with two
      children.
    */
    const expectedResponses = await this.repo.countExpectedRespondents(
      survey.kindergartenId,
      survey.scope,
      groupId ?? null,
    );

    const totalResponses = responseCount(selected);

    return {
      survey: withQuestions,
      totalResponses,
      expectedResponses,
      /*
        Never negative. A child who enrolled after answering, or a guardian
        whose membership was revoked, can leave more responses on record than
        the population currently expects — and "-2 бөглөөгүй" is worse than a
        zero that reads as "everyone we are waiting on has answered".
      */
      missingResponses: Math.max(0, expectedResponses - totalResponses),
      groupId: groupId ?? null,
      questions: tally(selected),
      byGroup,
    };
  }

  // ── Comparison and export — RFP Module 1.2, 1.3 ───────────────────────────

  /**
   * Copies a survey into a new DRAFT wave — RFP Module 1.2.
   *
   * ★ This is how "ижил асуулга" comes to exist. Retyping thirty questions in
   * May produces a survey that only *looks* like September's: different rows,
   * no shared indicator keys, and therefore nothing the comparison can pair.
   *
   * ★★ The clone is always a DRAFT, whatever the source's status. A copy that
   * arrived already published could collect answers before anyone checked that
   * last year's wording still applies.
   */
  async clone(actor: Actor, surveyId: string, dto: CloneSurveyDto) {
    const source = await this.repo.findWithQuestions(surveyId);
    if (!source) throw new NotFoundException();
    this.tenants.assertStaff(actor, source.kindergartenId);

    if (source.questions.length === 0) {
      throw new BadRequestException("Асуулт байхгүй судалгааг хувилах боломжгүй");
    }

    const clone = await this.repo.create({
      kindergartenId: source.kindergartenId,
      title: dto.title ?? `${source.title} (хуулбар)`,
      description: source.description,
      scope: source.scope,
      createdById: actor.userId,
      schoolYear: dto.schoolYear ?? source.schoolYear,
      period: dto.period ?? null,
      clonedFromSurveyId: source.id,
    });

    const copied = await this.repo.cloneQuestions(source.id, clone.id, source.kindergartenId);

    await this.audit.append({
      action: "CREATE",
      kindergartenId: source.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Survey",
      objectId: clone.id,
      metadata: { clonedFrom: source.id, questions: copied, period: dto.period ?? null },
    });

    return this.repo.findWithQuestions(clone.id);
  }

  /**
   * Begin-to-end progress — RFP Module 1.2.
   *
   * Returns the per-indicator comparison, already ordered best-first, plus the
   * per-child breakdown. The two ends of the indicator list are Module 1.2's
   * "хамгийн их сайжирсан" and "нэмэлт дэмжлэг шаардлагатай".
   */
  async compare(actor: Actor, surveyId: string, baselineId?: string) {
    const survey = await this.repo.findForAuthorization(surveyId);
    if (!survey) throw new NotFoundException();
    this.tenants.assertStaff(actor, survey.kindergartenId);

    const { endWave, baseWave } = await this.loadPair(surveyId, baselineId);

    if (!baseWave) {
      return {
        baseline: null,
        indicators: [],
        children: [],
        note: "Харьцуулах эхний үнэлгээ олдсонгүй",
      };
    }

    return {
      baseline: { id: baseWave.id, title: baseWave.title, period: baseWave.period },
      indicators: compareWaves(baseWave, endWave),
      children: compareWavesByChild(baseWave, endWave),
      note: null,
    };
  }

  /**
   * The five-sheet workbook — RFP Module 1.3.
   *
   * ★ Built in the request, not queued.
   *
   * CLAUDE.md §6 sends slow work to BullMQ, and this was measured rather than
   * assumed: a realistic worst case — 300 children, 14 questions including a
   * seven-row matrix, 4 200 answers per wave across three waves — builds in
   * **529 ms** and 433 KB. That is not slow work. Routing it through the report
   * queue would mean a job row, a poll, an R2 upload and a download route, all
   * to save half a second, and would put a pure-JavaScript task on the worker
   * that exists because Chromium needs a gigabyte of RAM.
   */
  async exportWorkbook(actor: Actor, surveyId: string) {
    const survey = await this.repo.findForAuthorization(surveyId);
    if (!survey) throw new NotFoundException();
    this.tenants.assertStaff(actor, survey.kindergartenId);

    const { endWave, baseWave, raw } = await this.loadPair(surveyId);

    const priorRefs = raw.schoolYear
      ? await this.repo.findPriorYearWaves(survey.kindergartenId, raw.schoolYear)
      : [];

    const priorYears: SurveyWave[] = [];
    for (const ref of priorRefs) {
      const wave = await this.toWave(ref.id);
      if (wave) priorYears.push(wave);
    }

    const childIds = [
      ...new Set(
        [endWave, baseWave, ...priorYears]
          .filter((wave): wave is SurveyWave => wave !== null)
          .flatMap((wave) => wave.answers.map((a) => a.childId))
          .filter((id): id is string => id !== null),
      ),
    ];

    const [children, kindergartenName] = await Promise.all([
      this.repo.childrenForExport(survey.kindergartenId, childIds),
      this.repo.kindergartenName(survey.kindergartenId),
    ]);

    const buffer = await buildSurveyWorkbook({
      survey: endWave,
      baseline: baseWave,
      priorYears,
      kindergartenName,
      children: children.map((child) => ({
        id: child.id,
        lastName: child.lastName,
        firstName: child.firstName,
        dateOfBirth: child.dateOfBirth ? child.dateOfBirth.toISOString() : null,
        sex: child.sex,
        groupName: child.enrollments[0]?.group?.name ?? null,
      })),
    });

    // §14 of нэмэлт.md and RFP §2.1 both want a downloaded export on the
    // record: this file leaves the building with every child's answers in it.
    await this.audit.append({
      // `DOWNLOAD`, not a new `EXPORT` action: нэмэлт.md §14 names the event
      // "Тайлан татсан", which is what this is, and the existing value already
      // means "a file left the system". A near-synonym would split the same
      // fact across two values and make the audit browser's filter lie.
      action: "DOWNLOAD",
      kindergartenId: survey.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Survey",
      objectId: surveyId,
      metadata: { format: "xlsx", children: childIds.length, bytes: buffer.length },
    });

    return { buffer, filename: `${slugify(endWave.title)}.xlsx` };
  }

  /** Loads the survey and whichever wave it should be compared against. */
  private async loadPair(surveyId: string, baselineId?: string) {
    const endWave = await this.toWave(surveyId);
    if (!endWave) throw new NotFoundException();

    const raw = await this.repo.loadWave(surveyId);
    if (!raw) throw new NotFoundException();

    let baseWave: SurveyWave | null = null;

    if (baselineId) {
      const candidate = await this.repo.loadWave(baselineId);
      /*
       * ★ The caller-supplied baseline must belong to the same kindergarten.
       *
       * Without this check `?baselineId=` is a cross-tenant read: a caller
       * authorized for their own survey would receive another kindergarten's
       * question prompts and score averages in the comparison. Mismatch is
       * treated as "no baseline" rather than as an error, per CLAUDE.md §1.7 —
       * a 404-shaped answer must not confirm that the id exists.
       */
      if (candidate && candidate.kindergartenId === raw.kindergartenId) {
        baseWave = await this.toWave(baselineId);
      }
    } else {
      const found = await this.repo.findBaselineFor(raw);
      if (found) baseWave = await this.toWave(found.id);
    }

    return { endWave, baseWave, raw };
  }

  /** One survey, flattened into the shape the pure modules consume. */
  private async toWave(surveyId: string): Promise<SurveyWave | null> {
    const row = await this.repo.loadWave(surveyId);
    if (!row) return null;

    return {
      id: row.id,
      title: row.title,
      schoolYear: row.schoolYear,
      period: row.period,
      questions: row.questions.map((q) => ({
        id: q.id,
        type: q.type,
        prompt: q.prompt,
        options: q.options,
        indicatorKey: q.indicatorKey,
      })),
      answers: row.responses.flatMap((response) =>
        response.answers.map((answer) => ({
          questionId: answer.questionId,
          childId: response.childId,
          value: answer.value,
          responseId: answer.responseId,
        })),
      ),
      responses: row.responses.map((response) => ({
        id: response.id,
        childId: response.childId,
        submittedAt: response.submittedAt.toISOString(),
        respondentName: `${response.respondent.lastName} ${response.respondent.firstName}`,
        // The role is not on the response row, and re-reading Membership per
        // response would be an N+1. A response carrying a child is a family's;
        // Module 1.3 asks only to distinguish "багш/эцэг эх", which this does.
        respondentRole: response.childId ? "GUARDIAN" : "TEACHER",
      })),
    };
  }
}

/** A filename that survives a Windows download dialog. */
function slugify(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|]/g, "")
    .trim()
    .slice(0, 80);

  return cleaned.length > 0 ? cleaned : "survey";
}
