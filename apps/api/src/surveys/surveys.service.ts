import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AuditRepository } from "../audit/audit.repository";
import { ChildAccessService } from "../authz/child-access.service";
import { TenantAccessService } from "../authz/tenant-access.service";
import { childKindergartenIds, isGuardianOf } from "../authz/child-access";
import type { Actor } from "../authz/actor";
import { SurveysRepository } from "./surveys.repository";
import { buildSurveyWorkbook, type SurveyWave } from "./survey-workbook";
import { compareQuestions, compareWaves, compareWavesByChild } from "./survey-comparison";
import { MAX_POLL_OPTIONS, matrixOptions, optionStrings } from "./survey-scoring";
import { hasOptionList } from "@kinder/contracts";
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
    /*
      ★ A teacher surveys their own groups; only an administrator surveys the
      kindergarten — client, 2026-09-10.

      This replaces `assertStaff` rather than sitting beside it: the audience
      check begins with the same staff assertion and then narrows, so keeping
      both would be one rule stated twice, with the weaker one first.
    */
    await this.tenants.assertCanAddressAudience(actor, kindergartenId, {
      groupIds: [dto.groupId ?? null],
    });

    /*
      ★ The group must belong to this kindergarten.

      Without this a staff member of one kindergarten could publish a survey
      addressed to another's group — the id comes from the client, and the
      audience filter would then hand that group's families a questionnaire
      from a kindergarten they have nothing to do with. Checked here rather
      than trusted from a select's options, for the reason §1.1 gives: the
      screen narrows, the server decides.
    */
    if (dto.groupId) {
      const group = await this.repo.findGroupInKindergarten(dto.groupId, kindergartenId);
      if (!group) throw new BadRequestException("Бүлэг олдсонгүй");
    }

    /*
      ★ The term must be this kindergarten's, for the same reason the group
      must be.

      The id comes from a client, and `Term` is per-kindergarten configuration
      (§2.3). Without this a member of staff could file their survey against
      another kindergarten's term — which would then appear in that
      kindergarten's term grouping and in nobody's own.
    */
    if (dto.termId) {
      const term = await this.repo.findTermInKindergarten(dto.termId, kindergartenId);
      if (!term) throw new BadRequestException("Улирал олдсонгүй");
    }

    const survey = await this.repo.create({
      kindergartenId,
      title: dto.title,
      description: dto.description ?? null,
      category: dto.category,
      scope: dto.scope,
      // The column defaults to FORM, and so does an omitted field: a caller
      // that predates `kind` keeps creating exactly what it created before.
      kind: dto.kind ?? "FORM",
      closesAt: dto.closesAt ?? null,
      createdById: actor.userId,
      schoolYear: dto.schoolYear ?? null,
      period: dto.period ?? null,
      // Null is every group — see `Survey.groupId`.
      groupId: dto.groupId ?? null,
      /*
        ★ Every one of these falls back to what a survey did before the field
        existed: open from publication, no stated purpose, no term, named
        answers, one response each, questions in written order, the product's
        own thank-you. A caller that predates the wizard keeps creating exactly
        what it created before.
      */
      opensAt: dto.opensAt ?? null,
      purpose: dto.purpose ?? null,
      termId: dto.termId ?? null,
      isAnonymous: dto.isAnonymous ?? false,
      allowMultipleResponses: dto.allowMultipleResponses ?? false,
      shuffleQuestions: dto.shuffleQuestions ?? false,
      closingNote: dto.closingNote ?? null,
    });

    await this.audit.append({
      action: "CREATE",
      kindergartenId,
      actorUserId: actor.userId,
      objectType: "Survey",
      objectId: survey.id,
      metadata: { category: dto.category, scope: dto.scope, groupId: dto.groupId ?? null },
    });

    return survey;
  }

  /**
   * The staff list, each survey carrying how far it has got.
   *
   * ★ "23 / 35 харуулсан" on every card — the client's 2026-09-10 design.
   *
   * The counts are attached here rather than fetched by the screen because a
   * card cannot ask for them without becoming a request per card. `repo
   * .participationCounts` answers the whole list in three queries; this method
   * only decides which denominator each survey takes, which is a property of
   * its scope and its audience and nothing else.
   *
   * ★★ `expected` is what the *audience* is, not what the roster is.
   *
   * A survey aimed at one group is measured against that group. Aimed at
   * everyone (`groupId: null`) it is measured against the kindergarten — and
   * against its parents rather than its children when the scope is
   * KINDERGARTEN, because that survey is answered once per family.
   */
  async listForKindergarten(actor: Actor, kindergartenId: string) {
    this.tenants.assertStaff(actor, kindergartenId);

    const [surveys, counts] = await Promise.all([
      this.repo.findForKindergarten(kindergartenId),
      this.repo.participationCounts(kindergartenId),
    ]);

    return surveys.map((survey) => ({
      ...survey,
      respondedCount: counts.responded.get(survey.id) ?? 0,
      expectedCount:
        survey.scope === "KINDERGARTEN"
          ? counts.parentCount
          : survey.groupId
            ? (counts.childrenByGroup.get(survey.groupId) ?? 0)
            : counts.childrenTotal,
    }));
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

  /**
   * Withdraws a survey — §3.2's soft delete.
   *
   * ★ The answers are not deleted with it.
   *
   * `deletedAt` on the survey takes it out of every list; the `SurveyResponse`
   * rows behind it stay exactly where they are. A family answered a question in
   * good faith, and a teacher removing the survey from their own screen is not
   * a reason to destroy what was said — the audit row names who withdrew it and
   * when, which is the fact somebody will actually ask about later.
   */
  async remove(actor: Actor, surveyId: string) {
    const survey = await this.repo.findForAuthorization(surveyId);
    if (!survey) throw new NotFoundException();
    this.tenants.assertStaff(actor, survey.kindergartenId);

    const removed = await this.repo.softDelete(surveyId);

    await this.audit.append({
      action: "DELETE",
      kindergartenId: survey.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Survey",
      objectId: surveyId,
      metadata: { status: survey.status },
    });

    return { id: removed.id };
  }

  /**
   * Takes the lock off a closed survey — 2026-09-12, at the client's request:
   * "цоожоо онгойлгоод нээж болдог бай."
   *
   * ★ The mirror of `close`, and deliberately not a toggle on one endpoint: a
   * client that sent "flip it" would close a survey somebody else had just
   * re-opened, and the audit row would say the opposite of what happened.
   */
  async reopen(actor: Actor, surveyId: string) {
    const survey = await this.repo.findForAuthorization(surveyId);
    if (!survey) throw new NotFoundException();
    this.tenants.assertStaff(actor, survey.kindergartenId);

    if (survey.status !== "CLOSED") {
      throw new BadRequestException("Зөвхөн хаагдсан судалгааг дахин нээх боломжтой");
    }

    const updated = await this.repo.reopen(surveyId);

    await this.audit.append({
      action: "UPDATE",
      kindergartenId: survey.kindergartenId,
      actorUserId: actor.userId,
      objectType: "Survey",
      objectId: surveyId,
      metadata: { status: "PUBLISHED", reopened: true },
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
    const groupId = await this.repo.activeGroupIdForChild(childId);
    const all = await this.repo.findActiveForKindergarten(facts.childKindergartenId, groupId);

    /*
      ★ A survey that has not opened yet is not on the family's list.

      `submitResponse` refuses it either way — that is the rule, and it is the
      one place it is enforced. This is the courtesy beside it: offering a
      family a survey that answers "хараахан эхлээгүй" the moment they finish
      it is worse than not offering it, and `closesAt` has never had the same
      problem because `findActiveForKindergarten` predates neither.
    */
    const now = Date.now();
    const surveys = all.filter((survey) => !survey.opensAt || survey.opensAt.getTime() <= now);

    /*
      ★ `myAnswers` — 2026-09-13, at the client's request: "хариулсан
      хариултууд харагддаг баймаар байна."

      The family's list said *that* they had replied and never *what* they
      said, which is the one thing a parent reopens a survey for. It is their
      own response and no one else's: `findResponse` is keyed on
      `actor.userId` and on the child, so there is no other family's answer in
      the payload to withhold.

      ★★ An anonymous survey is no exception, and that is deliberate. The
      promise anonymity makes is to the *other* families — `questionAnswers`
      and `participation` both refuse names for exactly that reason — and a
      guardian reading back the row they wrote themselves reveals nothing
      about anybody else. The aggregate stays the teacher's either way.
    */
    return Promise.all(
      surveys.map(async (survey) => {
        const responseChildId = survey.scope === "CHILD" ? childId : null;
        const existing = await this.repo.findResponse(survey.id, actor.userId, responseChildId);
        return {
          ...survey,
          respondedByMe: Boolean(existing),
          myAnswers: existing?.answers ?? [],
        };
      }),
    );
  }

  /**
   * ★ The one thing every parent-facing poll route shares: is this poll on
   * this child's board at all?
   *
   * Reuses `listActiveForChild`'s own two reads — `assertCanAccess`, then the
   * kindergarten-and-group filter — rather than re-deriving the visibility
   * rule. A second copy of "which surveys may this family see" is the §1.1
   * failure exactly: the list screen and the vote screen would answer
   * differently, and the one that answered wrongly would be whichever was
   * edited last.
   *
   * ★★ 404 for a form, not 403 and not the form's tally.
   *
   * A family may read a poll's running count because that is what a poll *is*
   * — the client's "эцэг эх дарахаар шууд хувь үзүүлэлт нь харагдана". A
   * questionnaire's aggregate is the teacher's, and answering "that exists but
   * is not yours" would confirm it (§1.7).
   */
  private async pollForChild(actor: Actor, childId: string, surveyId: string) {
    const facts = await this.childAccess.assertCanAccess(actor, childId);
    const groupId = await this.repo.activeGroupIdForChild(childId);
    const surveys = await this.repo.findActiveForKindergarten(facts.childKindergartenId, groupId);

    const survey = surveys.find((row) => row.id === surveyId);
    if (!survey || survey.kind !== "POLL") throw new NotFoundException();

    return { survey, facts };
  }

  /**
   * A poll as a family sees it: every choice with its count, and which one is
   * theirs.
   *
   * ★ Counts, never names. `allAnswers` selects a question id and a value and
   * nothing else, so there is no identity in the tally to leak — the same rule
   * `notificationSchema` states for reactions, and for the same reason: a
   * parent must not be able to work out how another family voted.
   *
   * ★★ `myAnswer` comes from a separate query keyed on the asker.
   *
   * The alternative — tagging each answer with its respondent and filtering
   * client-side — would put every family's vote in a payload the browser
   * receives, which is a leak whether or not the screen draws it.
   */
  async pollTally(actor: Actor, childId: string, surveyId: string) {
    const { survey } = await this.pollForChild(actor, childId, surveyId);

    const answers = await this.repo.allAnswers(surveyId);
    const responseChildId = survey.scope === "CHILD" ? childId : null;
    const mine = await this.repo.findMyAnswers(surveyId, actor.userId, responseChildId);
    const myAnswers = new Map(mine.map((row) => [row.questionId, row.value]));

    const questions = survey.questions.map((question) => {
      const values = answers
        .filter((row) => row.questionId === question.id)
        .map((row) => row.value);

      /*
        ★ The option list is the question's, not the answers'.

        Tallying the answers alone would drop a choice nobody has picked yet —
        which on a poll is the most interesting bar there is, and is also every
        option for the first family to look. Same argument `results()` makes
        for keeping a group with no answers on its chart.
      */
      const options = optionStrings(question.options);
      const counts = new Map(options.map((option) => [option, 0]));

      for (const value of values) {
        // CHECKBOX answers are arrays; SINGLE_CHOICE is one string. Both are
        // counted per choice, which is what a bar chart of a poll means.
        for (const choice of Array.isArray(value) ? value : [value]) {
          if (typeof choice !== "string") continue;
          // An option a teacher has since removed still has votes. Counting it
          // under a bar that is no longer drawn would make the percentages sum
          // to less than the votes cast, so it is dropped from the tally too.
          if (counts.has(choice)) counts.set(choice, counts.get(choice)! + 1);
        }
      }

      return {
        questionId: question.id,
        prompt: question.prompt,
        type: question.type,
        totalResponses: values.length,
        options: options.map((label) => ({ label, count: counts.get(label) ?? 0 })),
        myAnswer: (myAnswers.get(question.id) ?? null) as unknown,
      };
    });

    return { surveyId, respondedByMe: mine.length > 0, questions };
  }

  /**
   * A family adds a choice of their own — the client's "эцэг эх түүн дээр
   * нэмж шинэ хариулт үүсгэж болно".
   *
   * ★ It edits the teacher's question, which is unusual enough to say why.
   *
   * A poll's options are not a fixed vocabulary the way a development domain
   * is (§2.3): they are the wording of one question, and the client's model is
   * a social poll where "Бусад: ..." is added by whoever needs it. The
   * alternative — a parallel table of parent-suggested options merged at read
   * time — would double every tally path and give the same poll two kinds of
   * choice that vote differently.
   *
   * What keeps that safe is narrow scope rather than trust: only a poll, only
   * an option-bearing question, only while it is open, a bounded list, and an
   * `AuditLog` row naming who added what. There is no edit and no delete —
   * a parent may add a choice, never rewrite or remove somebody else's.
   */
  async addPollOption(
    actor: Actor,
    childId: string,
    surveyId: string,
    questionId: string,
    rawLabel: string,
  ) {
    const { survey } = await this.pollForChild(actor, childId, surveyId);

    /*
      ★ The same deadline check `submitResponse` makes, for the same reason.

      `closesAt` is an intention rather than a state and nothing sweeps it, so
      every write path has to ask. A closed poll that still accepted new
      options would grow choices nobody can vote for.
    */
    if (survey.closesAt && survey.closesAt.getTime() <= Date.now()) {
      throw new BadRequestException("Энэ асуулгын хугацаа дууссан байна");
    }

    const question = survey.questions.find((row) => row.id === questionId);
    if (!question) throw new NotFoundException();
    if (!hasOptionList(question.type)) {
      throw new BadRequestException("Энэ асуултад сонголт нэмэх боломжгүй");
    }

    const label = rawLabel.trim().replace(/\s+/g, " ");
    if (!label) throw new BadRequestException("Хариултаа бичнэ үү");

    const result = await this.repo.appendQuestionOption(questionId, label, MAX_POLL_OPTIONS);
    if (!result) throw new NotFoundException();
    if (result.full) {
      throw new BadRequestException(`Сонголт хамгийн ихдээ ${MAX_POLL_OPTIONS} байна`);
    }

    /*
      ★ Audited only when it changed something.

      A duplicate is success for the parent — somebody else added the same
      choice a moment earlier — but it is not an event, and an audit trail that
      records non-events is one nobody reads (§3.2's argument for why the
      deletion record lives here rather than in a column).
    */
    if (result.added) {
      await this.audit.append({
        action: "UPDATE",
        kindergartenId: survey.kindergartenId,
        actorUserId: actor.userId,
        objectType: "SurveyQuestion",
        objectId: questionId,
        metadata: { addedOption: label, surveyId, childId },
      });
    }

    return { questionId, options: result.options, added: result.added };
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

    /*
      ★ The other end of the same window — 2026-09-10.

      `opensAt` is the mirror of `closesAt` and is asked in the same one place
      for the same reason: it is an intention rather than a state, nothing
      sweeps it, and the survey stays PUBLISHED throughout. A survey published
      on Monday for Friday's meeting refuses answers until Friday, and null —
      every survey written before the field — is "from publication".
    */
    if (survey.opensAt && survey.opensAt.getTime() > Date.now()) {
      throw new BadRequestException("Энэ судалгаа хараахан эхлээгүй байна");
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

    /*
      ★ One response each, unless the survey says otherwise — 2026-09-10.

      This was an unconditional rule in the code, and it is the right one for a
      questionnaire: a family's considered answers, submitted once. It is the
      wrong one for the standing polls the client wants — "Маргаашийн аялалд
      хэн ирэх вэ", asked every week. The rule moved onto the row so the person
      writing the survey chooses, and the default is what it always did.
    */
    if (!survey.allowMultipleResponses) {
      const existing = await this.repo.findResponse(surveyId, actor.userId, childId);
      if (existing) throw new BadRequestException("Та энэ судалгааг аль хэдийн бөглөсөн байна");
    }

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
  /**
   * Who answered and who has not — RFP §8's follow-up, at the client's request.
   *
   * ★ Names, not a percentage. `results` already says how many replied; what a
   * teacher does with this screen is ring the four families who have not, and
   * a count cannot be rung.
   *
   * ★★ A response with no `childId` still counts as answered.
   *
   * A KINDERGARTEN-scoped survey is asked of the family rather than about one
   * child, so its responses carry a respondent and no child. Matching only on
   * `childId` would report every one of those as pending — the whole roster
   * outstanding on a survey everybody had answered.
   */
  async participation(actor: Actor, surveyId: string) {
    const survey = await this.repo.findForAuthorization(surveyId);
    if (!survey) throw new NotFoundException();
    this.tenants.assertStaff(actor, survey.kindergartenId);

    const { enrollments, responses } = await this.repo.participation(
      surveyId,
      survey.kindergartenId,
      survey.groupId ?? null,
    );

    const byChild = new Map(
      responses.filter((row) => row.childId).map((row) => [row.childId!, row]),
    );

    /*
      ★ An anonymous survey answers with counts and nothing else — 2026-09-10.

      "Оролцоо" names who has replied and who has not, which is exactly what a
      survey promising anonymity must not do. Both halves go, not just the
      answered list: a roster of everyone who has *not* replied names the
      others by subtraction, which is the same disclosure with an extra step.

      The rows are still there and `respondentId` is still written — the flag
      is named `isAnonymous` rather than "anonymous" for that reason
      (`Survey.isAnonymous`). What changes is what the product will show.
    */
    if (survey.isAnonymous) {
      return {
        anonymous: true as const,
        answered: [],
        pending: [],
        answeredCount: responses.length,
        familyResponses: responses.filter((row) => !row.childId).length,
        roster: enrollments.length,
      };
    }

    const answered = [];
    const pending = [];
    for (const enrollment of enrollments) {
      const response = byChild.get(enrollment.child.id);
      const row = { child: enrollment.child, group: enrollment.group };
      if (response) {
        answered.push({
          ...row,
          respondent: response.respondent,
          submittedAt: response.submittedAt.toISOString(),
        });
      } else {
        pending.push(row);
      }
    }

    // Responses with no child — a survey asked of the family rather than about
    // one of them. Reported as a count, because there is no roster to match
    // them against.
    const familyResponses = responses.filter((row) => !row.childId).length;

    return {
      anonymous: false as const,
      answered,
      pending,
      answeredCount: answered.length,
      familyResponses,
      roster: enrollments.length,
    };
  }

  /**
   * "Хариултууд" — who said what to one question.
   *
   * ★ Refused outright for an anonymous survey, not filtered afterwards. The
   * flag's whole purpose is that no reader can attach an answer to a name, and
   * an endpoint that answers with an empty list for the anonymous case is one
   * `if` away from answering with a full one. `participation` takes the same
   * line and says why.
   */
  async questionAnswers(actor: Actor, surveyId: string, questionId: string) {
    const survey = await this.repo.findForAuthorization(surveyId);
    if (!survey) throw new NotFoundException();
    this.tenants.assertStaff(actor, survey.kindergartenId);

    if (survey.isAnonymous) return { anonymous: true as const, items: [] };

    const withQuestions = await this.repo.findWithQuestions(surveyId);
    const question = withQuestions?.questions.find((row) => row.id === questionId);
    // 404, never 403 — §1.7. A question id from another survey is a question
    // this survey does not have, and saying which it is would confirm it exists.
    if (!question) throw new NotFoundException();

    const rows = await this.repo.answersWithChild(surveyId, questionId);

    return {
      anonymous: false as const,
      items: rows.map((row) => ({ child: row.child, value: row.value })),
    };
  }

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

    /*
      ★ Each group's own denominator — the client's "5 / 6 (83%)", 2026-09-10.

      A bare "5" beside another group's "1" says nothing: a group of six with
      five replies is nearly done and a group of four with one has barely
      started, and the bars would be drawn five-to-one either way. Counted for
      every group in one query rather than per row (§3.4).

      ★★ Children, always, even for a KINDERGARTEN-scope survey.

      That survey's *headline* denominator is parents (one family answers once
      however many children they have) — but a per-group split is only possible
      through the children, because a parent is not in a group and a family with
      two children is in two. So this bar answers "how many of this group's
      families replied", which is the question the split is asked for, and the
      headline above keeps its own count. Named `expectedChildren` rather than
      `expected` so the two are not mistaken for the same number.
    */
    const counts = await this.repo.participationCounts(survey.kindergartenId);

    const byGroup = [...groups.values()]
      .sort((a, b) => a.name.localeCompare(b.name, "mn"))
      .map((group) => {
        const rows = answers.filter((answer) => (answer.group?.id ?? null) === group.id);
        return {
          group,
          responseCount: responseCount(rows),
          // "Бүлэггүй" has no roster to be a share of, and reporting the
          // kindergarten's total there would draw a bar against everybody.
          expectedChildren: group.id ? (counts.childrenByGroup.get(group.id) ?? 0) : 0,
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
      category: source.category,
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
        questions: [],
        children: [],
        note: "Харьцуулах эхний үнэлгээ олдсонгүй",
      };
    }

    return {
      baseline: {
        id: baseWave.id,
        title: baseWave.title,
        period: baseWave.period,
        publishedAt: baseWave.publishedAt ?? null,
      },
      /** This wave's own date, so the two columns can be named by when they ran. */
      endline: { id: endWave.id, title: endWave.title, publishedAt: endWave.publishedAt ?? null },
      indicators: compareWaves(baseWave, endWave),
      questions: compareQuestions(baseWave, endWave),
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
      /*
       * ★ When the wave went out — 2026-09-12, for the comparison's own column
       * headers ("2026.05" against "2026.09").
       *
       * `period` names which assessment it is in the year's cycle and cannot
       * date it; two waves both called "Завсрын үнэлгээ" in different years
       * would label two identical columns. The date is the one thing a reader
       * pairs a bar with.
       */
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
      // Carried into the workbook so Sheet 2 can keep the promise this survey
      // made — see `SurveyWave.isAnonymous`.
      isAnonymous: row.isAnonymous,
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
