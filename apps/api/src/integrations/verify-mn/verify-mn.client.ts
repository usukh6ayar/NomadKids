import { Injectable, Logger } from "@nestjs/common";
import type { ZodType } from "zod";
import { VerifyMnConfig } from "./verify-mn.config";
import {
  verifyMnCreateSessionResponseSchema,
  verifyMnSessionResponseSchema,
  type VerifyMnCreateSessionResponse,
  type VerifyMnErrorKind,
  type VerifyMnSessionResponse,
} from "./verify-mn.types";

/**
 * Every verify.mn failure, as one type — mirrors `QpayError`.
 *
 * Not an `HttpException`: an outbound failure must not forward verify.mn's
 * status code to our own caller. `PhoneVerificationService` decides what the
 * person sees.
 */
export class VerifyMnError extends Error {
  constructor(
    readonly kind: VerifyMnErrorKind,
    message: string,
    readonly detail: { status?: number; path?: string; durationMs?: number } = {},
  ) {
    super(message);
    this.name = "VerifyMnError";
  }
}

/**
 * The HTTP client for verify.mn's two session endpoints.
 *
 * ★ **No callback URL is ever registered.** verify.mn's callback is a bare GET
 * with no signature — a wake-up call, which their own reference says to
 * re-check against `GET /sessions/:id` before believing. Polling that endpoint
 * from the server is the proof either way, so the callback would add a public
 * route and a public URL setting and prove nothing. Their reference: "If you
 * plan to poll GET /sessions/{id}, leave empty."
 *
 * ★★ `GET /sessions/:id` needs no key — verify.mn's design, not ours. The
 * session id is therefore never sent to a browser: anybody holding it could
 * read the session's state. `PhoneVerification.sessionId` stays on the server.
 */
@Injectable()
export class VerifyMnClient {
  private readonly logger = new Logger(VerifyMnClient.name);

  constructor(private readonly config: VerifyMnConfig) {}

  /**
   * Opens a session: the person must text `text` from `phone` to the
   * shortcode within verify.mn's TTL (five minutes).
   */
  async createSession(input: {
    phone: string;
    text: string;
  }): Promise<VerifyMnCreateSessionResponse> {
    return this.request(
      "POST",
      "/sessions",
      { phone: input.phone, text: input.text },
      verifyMnCreateSessionResponseSchema,
    );
  }

  /** The authoritative answer to "has the SMS arrived from that phone". */
  async getSession(sessionId: string): Promise<VerifyMnSessionResponse> {
    return this.request(
      "GET",
      `/sessions/${encodeURIComponent(sessionId)}`,
      undefined,
      verifyMnSessionResponseSchema,
    );
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    schema: ZodType<T>,
  ): Promise<T> {
    if (!this.config.isConfigured) {
      throw new VerifyMnError(
        "not_configured",
        "verify.mn is not configured — set VERIFY_MN_API_KEY",
        {
          path,
        },
      );
    }

    // The path names a session id, which is a capability on verify.mn's side
    // (the GET needs no key) — logs carry the route shape only.
    const logPath = path.startsWith("/sessions/") ? "/sessions/:id" : path;
    const startedAt = Date.now();

    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (cause) {
      const durationMs = Date.now() - startedAt;
      const timedOut = cause instanceof Error && cause.name === "TimeoutError";
      this.logger.warn(
        `verify.mn ${method} ${logPath} failed (${timedOut ? "timeout" : "network"})`,
      );
      throw new VerifyMnError(
        timedOut ? "timeout" : "network",
        timedOut
          ? `verify.mn request timed out after ${this.config.timeoutMs}ms`
          : `verify.mn request failed: ${this.redact(cause instanceof Error ? cause.message : "unknown")}`,
        { path: logPath, durationMs },
      );
    }

    const durationMs = Date.now() - startedAt;
    const rawBody = await response.text().catch(() => "");

    if (!response.ok) {
      this.logger.warn(`verify.mn ${method} ${logPath} → ${response.status} (${durationMs}ms)`);
      throw new VerifyMnError("http", `verify.mn responded ${response.status}`, {
        status: response.status,
        path: logPath,
        durationMs,
      });
    }

    let data: unknown;
    try {
      data = rawBody === "" ? null : JSON.parse(rawBody);
    } catch {
      throw new VerifyMnError("invalid_response", "verify.mn returned a body that is not JSON", {
        status: response.status,
        path: logPath,
        durationMs,
      });
    }

    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      throw new VerifyMnError(
        "invalid_response",
        `verify.mn response did not match the expected shape: ${this.redact(parsed.error.message)}`,
        { status: response.status, path: logPath, durationMs },
      );
    }
    this.logger.log(`verify.mn ${method} ${logPath} → ${response.status} (${durationMs}ms)`);
    return parsed.data;
  }

  /** Removes the key from a string — the backstop, as in `QpayClient.redact`. */
  private redact(text: string): string {
    const key = this.config.apiKey;
    return key && key.length >= 8 ? text.split(key).join("[REDACTED]") : text;
  }
}
