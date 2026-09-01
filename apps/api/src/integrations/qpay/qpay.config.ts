import { Injectable } from "@nestjs/common";
import { type Env } from "../../config/env";

/**
 * The QPay credentials, and the one place that decides whether they exist.
 *
 * ★ Mirrors `esis.config.ts` exactly, including the reason it exists apart
 * from the client: "are we configured?" has to be answerable — for
 * `/health/readiness` and for the parent-facing "QPay-ээр төлөх" button —
 * without constructing anything that can make a network call.
 *
 * ★★ Constructed through a factory in `QpayModule`, not by Nest's injector —
 * same reason as `EsisConfig`: it takes the parsed `Env`, which is a type, not
 * a provider.
 */
@Injectable()
export class QpayConfig {
  private readonly env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  /** All five or none — `env.ts` refuses a partial set at boot in production. */
  get isConfigured(): boolean {
    return Boolean(
      this.baseUrl && this.username && this.password && this.invoiceCode && this.callbackUrl,
    );
  }

  /** Trailing slash removed so joining a path cannot produce `//`. */
  get baseUrl(): string {
    return this.env.QPAY_BASE_URL.replace(/\/+$/, "");
  }

  get username(): string {
    return this.env.QPAY_USERNAME;
  }

  /**
   * ★ The password. Never log this, never return it, never put it in an
   * error — same discipline `EsisConfig.token` documents. `QpayClient.redact()`
   * is the backstop for the cases a reviewer misses.
   */
  get password(): string {
    return this.env.QPAY_PASSWORD;
  }

  get invoiceCode(): string {
    return this.env.QPAY_INVOICE_CODE;
  }

  get callbackUrl(): string {
    return this.env.QPAY_CALLBACK_URL;
  }

  get timeoutMs(): number {
    return this.env.QPAY_TIMEOUT_MS;
  }

  /** What may safely be shown to an operator — never any part of the password. */
  describe(): { configured: boolean; baseUrl: string; invoiceCode: string; hasPassword: boolean } {
    return {
      configured: this.isConfigured,
      baseUrl: this.baseUrl,
      invoiceCode: this.invoiceCode,
      hasPassword: this.password !== "",
    };
  }
}
