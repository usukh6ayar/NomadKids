import { Injectable } from "@nestjs/common";
import { type Env } from "../../config/env";

/**
 * The QPay credentials, and the one place that decides whether they exist.
 *
 * ★ Separate from the client so "are we configured?" is answerable without
 * constructing anything that can make a network call — the same split
 * `EsisConfig` makes, for the same reason: a readiness probe and an admin
 * screen both need that question and neither should be able to reach a `fetch`
 * to ask it.
 *
 * ★★ Constructed through a factory in `QpayModule`, not by Nest's injector:
 * the constructor takes the parsed environment, and `Env` is a plain type
 * rather than a provider.
 *
 * ★★★ **One merchant for every kindergarten** (client, 2026-08-31). There is
 * deliberately no per-kindergarten lookup here. Which kindergarten a payment
 * belongs to is answered by the invoice it references — `Payment.invoiceId` →
 * `Invoice.kindergartenId` — never by which credentials took the money.
 */
@Injectable()
export class QpayConfig {
  private readonly env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  /**
   * Whether a real QPay call can be attempted.
   *
   * All five or none. `env.ts` refuses a partial set at boot in production;
   * this is the same rule for the environments where it does not throw, so a
   * developer with two variables filled in gets "not configured" rather than a
   * confusing 401 from the provider.
   */
  get isConfigured(): boolean {
    return Boolean(
      this.baseUrl && this.username && this.password && this.invoiceCode && this.callbackUrl,
    );
  }

  /** Trailing slash removed so joining a path cannot produce `//`. */
  get baseUrl(): string {
    return this.env.QPAY_BASE_URL.replace(/\/+$/, "");
  }

  /**
   * ★ Both of these are secrets. Never log them, never return them, never put
   * them in an error.
   *
   * Getters rather than public fields so every read is greppable — if either
   * value appears somewhere it should not, `\.password` finds the line.
   * `QpayClient.redact()` is the backstop for what review misses.
   */
  get username(): string {
    return this.env.QPAY_USERNAME;
  }

  get password(): string {
    return this.env.QPAY_PASSWORD;
  }

  /** The merchant's invoice code. Not a secret, but per-environment. */
  get invoiceCode(): string {
    return this.env.QPAY_INVOICE_CODE;
  }

  /** Where QPay notifies us. Public by necessity — see `qpay.client.ts`. */
  get callbackUrl(): string {
    return this.env.QPAY_CALLBACK_URL;
  }

  get timeoutMs(): number {
    return this.env.QPAY_TIMEOUT_MS;
  }

  /**
   * What may safely be shown to an operator.
   *
   * ★ Reports whether a password is *present*, never any part of its value —
   * not a prefix, not a length. A length narrows a brute-force search. The
   * username is also withheld: it is half of a credential pair.
   */
  describe(): { configured: boolean; baseUrl: string; invoiceCode: string; hasPassword: boolean } {
    return {
      configured: this.isConfigured,
      baseUrl: this.baseUrl,
      invoiceCode: this.invoiceCode,
      hasPassword: this.password !== "",
    };
  }
}
