import { Injectable } from "@nestjs/common";
import { type Env } from "../../config/env";

const DEFAULT_ESIS_BASE_URL = "https://hubv2.esis.edu.mn";

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
   * The official hub URL has a safe default and institution scope belongs to
   * each tenant, so the Bearer token is the only deployment secret required.
   */
  get isConfigured(): boolean {
    return Boolean(this.baseUrl && this.token);
  }

  /** Demo mode is an explicit transport choice, not inferred from a missing token. */
  get isDemoMode(): boolean {
    return this.env.ESIS_DEMO_MODE === true;
  }

  /** Whether the shared client can serve a request in either transport mode. */
  get isAvailable(): boolean {
    return this.isDemoMode || this.isConfigured;
  }

  /** Trailing slash removed so joining a path cannot produce `//`. */
  get baseUrl(): string {
    return (this.env.ESIS_BASE_URL || DEFAULT_ESIS_BASE_URL).replace(/\/+$/, "");
  }

  /**
   * ★ The token. Never log this, never return it, never put it in an error.
   *
   * It is a getter rather than a public field so every read is greppable — if
   * this value ever appears somewhere it should not, `\.token` finds the line.
   * `EsisClient.redact()` is the backstop for the cases a reviewer misses.
   */
  get token(): string {
    return this.env.ESIS_TOKEN.trim().replace(/^Bearer\s+/i, "");
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
  describe(): {
    configured: boolean;
    demoMode: boolean;
    mode: "MOCK" | "LIVE";
    baseUrl: string;
    hasToken: boolean;
  } {
    return {
      configured: this.isConfigured,
      demoMode: this.isDemoMode,
      mode: this.isDemoMode ? "MOCK" : "LIVE",
      baseUrl: this.baseUrl,
      hasToken: this.token !== "",
    };
  }
}
