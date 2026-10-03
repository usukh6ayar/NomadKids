import { Injectable } from "@nestjs/common";
import { type Env } from "../../config/env";

/**
 * The verify.mn key, and the one place that decides whether phone
 * verification is on.
 *
 * ★ Mirrors `QpayConfig`: "are we configured?" has to be answerable — for the
 * forgot-password screen and for the invitation and profile rules — without
 * constructing anything that can make a network call.
 *
 * Constructed through a factory in `PhoneVerificationModule`, same reason as
 * `QpayConfig`: it takes the parsed `Env`, which is a type, not a provider.
 */
@Injectable()
export class VerifyMnConfig {
  constructor(private readonly env: Env) {}

  /** The key alone: the base URL has a default and the timeout always does. */
  get isConfigured(): boolean {
    return this.apiKey !== "";
  }

  /** Trailing slash removed so joining a path cannot produce `//`. */
  get baseUrl(): string {
    return this.env.VERIFY_MN_BASE_URL.replace(/\/+$/, "");
  }

  /**
   * ★ The key. Never log this, never return it, never put it in an error —
   * `VerifyMnClient.redact()` is the backstop.
   */
  get apiKey(): string {
    return this.env.VERIFY_MN_API_KEY;
  }

  get timeoutMs(): number {
    return this.env.VERIFY_MN_TIMEOUT_MS;
  }
}
