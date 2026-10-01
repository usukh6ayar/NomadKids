import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomBytes, randomInt } from "node:crypto";
import type { PhoneVerificationPurpose } from "../domain/enums";
import { hashToken } from "../auth/token.service";
import { VerifyMnClient, VerifyMnError } from "../integrations/verify-mn/verify-mn.client";
import { VerifyMnConfig } from "../integrations/verify-mn/verify-mn.config";
import { PhoneVerificationRepository } from "./phone-verification.repository";

/**
 * verify.mn asks for no faster than one status call every three seconds —
 * "SMS delivery is not sub-second, tighter loops only waste requests". The
 * browser polls at that rate; this makes the server hold to it whoever polls.
 */
const CHECK_INTERVAL_MS = 3_000;

/**
 * How long a verified phone may be spent after the SMS arrived. Long enough to
 * type a password twice; short enough that a handle left in a closed tab is
 * not a standing credential.
 */
const USE_WITHIN_MS = 15 * 60 * 1000;

/** verify.mn's own TTL, used only if its `expiresAt` cannot be read. */
const FALLBACK_TTL_MS = 5 * 60 * 1000;

export type PhoneVerificationStatus = "PENDING" | "VERIFIED" | "EXPIRED";

/** What the browser needs to show the step — never verify.mn's session id. */
export interface PhoneVerificationStart {
  /** The bearer for `check` and for the flow that consumes it. Returned once. */
  handle: string;
  shortcode: string;
  code: string;
  smsUri: string;
  displayInstruction: string;
  expiresAt: string;
}

export interface PhoneVerificationCheck {
  status: PhoneVerificationStatus;
  expiresAt: string;
  /**
   * Password reset only, and only once the phone is proven. Before that it
   * would answer "does an account hold this number" for anybody who typed one.
   */
  accountFound?: boolean;
}

/** What a consuming flow binds the verification to. */
export interface PhoneVerificationExpectation {
  purpose: PhoneVerificationPurpose;
  /** The account this must have been started for. Omitted for a reset. */
  userId?: string;
  /** The number the flow is about to write. Omitted for a reset, which reads it. */
  phone?: string;
}

/**
 * Proof that a person holds a phone number, through verify.mn.
 *
 * The person texts a code **from** the phone to verify.mn's shortcode, and the
 * server asks verify.mn whether it arrived. Three flows consume a proof:
 * password reset by phone, a guardian accepting an invitation, and changing
 * one's own phone.
 *
 * ★ A proof is bound to **purpose, account and number**, and `consume`
 * checks all three. A handle verified for your own phone on the settings
 * screen must not open somebody's password reset, and one started for one
 * invitation must not complete another.
 *
 * ★★ Off unless `VERIFY_MN_API_KEY` is set (`enabled`). The consuming flows
 * ask `enabled` first and, when it is false, behave exactly as they did
 * before this existed.
 */
@Injectable()
export class PhoneVerificationService {
  private readonly logger = new Logger(PhoneVerificationService.name);

  constructor(
    private readonly repo: PhoneVerificationRepository,
    private readonly client: VerifyMnClient,
    private readonly config: VerifyMnConfig,
  ) {}

  get enabled(): boolean {
    return this.config.isConfigured;
  }

  async start(
    purpose: PhoneVerificationPurpose,
    phone: string,
    userId: string | null,
    ipAddress: string | null,
  ): Promise<PhoneVerificationStart> {
    if (!this.enabled) {
      throw new ServiceUnavailableException("Утсаар баталгаажуулах боломж идэвхжээгүй байна.");
    }

    await this.repo.retirePending(purpose, phone, userId);

    // A fresh six-digit code per session: verify.mn refuses (409) a second
    // active session with the same phone and text, and a reused code would
    // let an old SMS satisfy a new session.
    const code = String(randomInt(100_000, 1_000_000));

    let session;
    try {
      session = await this.client.createSession({ phone, text: code });
    } catch (error) {
      this.logger.warn(
        `verify.mn session not created: ${error instanceof VerifyMnError ? error.kind : "unknown"}`,
      );
      throw new ServiceUnavailableException(
        "SMS баталгаажуулалт түр ажиллахгүй байна. Хэсэг хугацааны дараа дахин оролдоно уу.",
      );
    }

    const parsedExpiry = new Date(session.expiresAt);
    const expiresAt = Number.isNaN(parsedExpiry.getTime())
      ? new Date(Date.now() + FALLBACK_TTL_MS)
      : parsedExpiry;

    const handle = randomBytes(32).toString("base64url");
    await this.repo.create({
      purpose,
      phone,
      userId,
      sessionId: session.sessionId,
      code: session.text,
      handleHash: hashToken(handle),
      expiresAt,
      requestedIp: ipAddress,
    });

    return {
      handle,
      shortcode: session.shortcode,
      code: session.text,
      smsUri: session.smsUri,
      displayInstruction: session.displayInstruction,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /** The browser's poll. Unknown handle → 404, the same for every caller. */
  async check(handle: string): Promise<PhoneVerificationCheck> {
    const row = await this.repo.findByHandleHash(hashToken(handle));
    if (!row) throw new NotFoundException();

    const status = await this.refresh(row);
    const result: PhoneVerificationCheck = { status, expiresAt: row.expiresAt.toISOString() };

    if (status === "VERIFIED" && row.purpose === "PASSWORD_RESET") {
      result.accountFound = Boolean(await this.repo.findAccountByPhone(row.phone));
    }
    return result;
  }

  /**
   * Spends a proof for the flow described by `expect`.
   *
   * Every failure reads the same — a 400 on the `phone` field with
   * `PHONE_UNVERIFIED` — so a guessed or replayed handle learns nothing about
   * why it was refused.
   */
  async consume(
    handle: string | undefined,
    expect: PhoneVerificationExpectation,
  ): Promise<{ phone: string }> {
    const row = handle ? await this.repo.findByHandleHash(hashToken(handle)) : null;

    const bound =
      row !== null &&
      row.purpose === expect.purpose &&
      (expect.userId === undefined || row.userId === expect.userId) &&
      (expect.phone === undefined || row.phone === expect.phone);
    if (!row || !bound) throw unverified();

    // A browser that submits the moment the SMS lands may beat its own poll;
    // one upstream look settles it rather than refusing a real proof.
    const status = await this.refresh(row, { force: true });
    const verifiedAt = row.verifiedAt ?? (status === "VERIFIED" ? new Date() : null);
    if (!verifiedAt || Date.now() - verifiedAt.getTime() > USE_WITHIN_MS) throw unverified();

    if (!(await this.repo.consume(row.id))) throw unverified();
    return { phone: row.phone };
  }

  /**
   * Brings a row up to date with verify.mn, at most once per
   * `CHECK_INTERVAL_MS` unless forced.
   *
   * ★ A spent row that never verified was retired by a newer attempt and
   * reads as expired. An upstream failure reads as still pending: the poll
   * tries again in three seconds, and a person mid-SMS should not see an
   * error for verify.mn's hiccup.
   */
  private async refresh(
    row: {
      id: string;
      sessionId: string;
      expiresAt: Date;
      verifiedAt: Date | null;
      consumedAt: Date | null;
    },
    options: { force?: boolean } = {},
  ): Promise<PhoneVerificationStatus> {
    if (row.verifiedAt) return "VERIFIED";
    if (row.consumedAt || row.expiresAt.getTime() < Date.now()) return "EXPIRED";

    const notAfter = new Date(Date.now() - (options.force ? 0 : CHECK_INTERVAL_MS));
    if (!(await this.repo.claimCheck(row.id, notAfter))) return "PENDING";

    try {
      const session = await this.client.getSession(row.sessionId);
      if (session.sessionStatus === "VERIFIED") {
        await this.repo.markVerified(row.id);
        return "VERIFIED";
      }
      return session.sessionStatus;
    } catch (error) {
      this.logger.warn(
        `verify.mn status check failed: ${error instanceof VerifyMnError ? error.kind : "unknown"}`,
      );
      return "PENDING";
    }
  }
}

function unverified(): BadRequestException {
  const message = "Утасны дугаараа SMS-ээр баталгаажуулна уу.";
  return new BadRequestException({
    message: [message],
    errors: { phone: [message] },
    code: "PHONE_UNVERIFIED",
  });
}
