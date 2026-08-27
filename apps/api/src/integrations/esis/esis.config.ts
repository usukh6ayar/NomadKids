import { Injectable } from "@nestjs/common";
import { type Env } from "../../config/env";

/**
 * The ESIS credentials, and the one place that decides whether they exist.
 *
 * ★ Separate from the client so that "are we configured?" is answerable without
 * constructing anything that can make a network call. `/health/readiness` and a
 * future admin screen both need that question; neither should be able to reach
 * a `fetch` to ask it.
 *
 * ★★ Constructed through a factory in `EsisModule`, not by Nest's injector.
 *
 * The constructor takes the parsed environment so a test can supply one
 * without touching `process.env` — but `Env` is a plain type, not a provider,
 * so Nest cannot resolve it. Registering this class bare in a `providers`
 * array fails at boot with "can't resolve dependencies of the EsisConfig (?)".
 * The factory in `esis.module.ts` is what supplies it; keep them together.
 */
@Injectable()
export class EsisConfig {
  private readonly env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  /**
   * Whether a real ESIS call can be attempted.
   *
   * All three or none. `env.ts` refuses a partial set at boot in production;
   * this is the same rule expressed for the two environments where it does not
   * throw, so a developer with one variable filled in gets "not configured"
   * rather than a confusing 401 from the ministry.
   */
  get isConfigured(): boolean {
    return Boolean(this.baseUrl && this.token && this.institutionId);
  }

  /** Trailing slash removed so joining a path cannot produce `//`. */
  get baseUrl(): string {
    return this.env.ESIS_BASE_URL.replace(/\/+$/, "");
  }

  /**
   * ★ The token. Never log this, never return it, never put it in an error.
   *
   * It is a getter rather than a public field so every read is greppable — if
   * this value ever appears somewhere it should not, `\.token` finds the line.
   * `EsisClient.redact()` is the backstop for the cases a reviewer misses.
   */
  get token(): string {
    return this.env.ESIS_TOKEN;
  }

  /** Which institution this deployment acts as. Not a secret. */
  get institutionId(): string {
    return this.env.ESIS_INSTITUTION_ID;
  }

  get timeoutMs(): number {
    return this.env.ESIS_TIMEOUT_MS;
  }

  /**
   * What may safely be shown to an operator — on a health endpoint, in a log
   * line, on an admin screen.
   *
   * ★ Reports whether a token is *present*, never any part of its value. Not a
   * prefix, not a length: a length narrows a brute-force search, and a prefix
   * of a JWT is its header, which names the algorithm. Neither is worth the
   * diagnostic value.
   */
  describe(): { configured: boolean; baseUrl: string; institutionId: string; hasToken: boolean } {
    return {
      configured: this.isConfigured,
      baseUrl: this.baseUrl,
      institutionId: this.institutionId,
      hasToken: this.token !== "",
    };
  }
}
