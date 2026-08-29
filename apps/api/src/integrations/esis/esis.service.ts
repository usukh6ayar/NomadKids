import { Injectable } from "@nestjs/common";
import { EsisClient } from "./esis.client";
import { EsisConfig } from "./esis.config";
import type { EsisRequest, EsisResponse } from "./esis.types";

/**
 * The application-facing entry point to ESIS.
 *
 * ★ It has no domain methods, and that is the point of this commit.
 *
 * There is no `syncChildren()`, no `fetchInstitution()`, no `pushAttendance()`.
 * We have not seen ESIS's API documentation, so every one of those would be an
 * invented endpoint against an invented schema — and the moment one exists, a
 * screen gets built on it and the guess spreads. What this class establishes is
 * the *boundary*: configuration, authentication, timeouts, errors and logging,
 * all of which are knowable now and none of which change when the real
 * endpoints arrive.
 *
 * ★★ Nothing calls this yet. It is wired into the module graph so the
 * configuration is validated at boot and the tests can exercise it, but no
 * existing behaviour reads from it. Adding the first real caller is a separate,
 * reviewable change — see the note at the foot of this file.
 */
@Injectable()
export class EsisService {
  constructor(
    private readonly client: EsisClient,
    private readonly config: EsisConfig,
  ) {}

  /**
   * Whether this deployment can talk to ESIS at all.
   *
   * ★ Callers must check this rather than catching `not_configured`. An
   * integration that is switched off is an ordinary state — most deployments
   * during rollout — and treating it as an exception makes ordinary operation
   * look like failure in the logs.
   */
  get isConfigured(): boolean {
    return this.config.isConfigured;
  }

  /** Safe to show an operator: no token, not even its length. */
  status(): ReturnType<EsisConfig["describe"]> {
    return this.config.describe();
  }

  /**
   * Escape hatch for a real endpoint, once we have one.
   *
   * Typed generically because the response shape is genuinely unknown until the
   * documentation exists. Pass `parse` — `schema.parse` from a Zod schema — to
   * narrow it at the boundary, so a changed payload fails here rather than
   * three layers inside the app.
   */
  async request<T = unknown>(options: EsisRequest): Promise<EsisResponse<T>> {
    return this.client.request<T>(options);
  }
}

/*
 * ★ How the first real ESIS feature should be added.
 *
 *   1. Get the documentation. Record the endpoint, its verb, its auth scheme
 *      and a real response sample in `docs/` before writing code.
 *   2. Declare the payload as a Zod schema in `esis.schemas.ts`, beside this
 *      file. Nothing outside this directory should know ESIS's field names.
 *   3. Add a domain method here that calls `this.client.request({ parse })` and
 *      returns *our* domain type, not theirs. The mapping lives at the
 *      boundary so that a rename on their side is a one-file change.
 *   4. Decide the external-ID question then, not now — see
 *      `docs/reference/нэмэлт.md` §15, which asks for source, import date,
 *      importing user, reference id and original value. That is a table, not a
 *      column, and it should not be designed against a guess.
 *   5. Any synchronisation runs on BullMQ (CLAUDE.md §6), never in a request.
 */
