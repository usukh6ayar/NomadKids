import { Injectable, Logger } from "@nestjs/common";
import { createTransport, type Transporter } from "nodemailer";
import { loadEnv, type Env } from "../config/env";

/**
 * Outbound email.
 *
 * ★ Exactly one message type: the password-reset link. Nothing else in the MVP
 * sends mail — announcements are read in the app, and a notification digest is
 * a Phase 2 feature. Keeping the surface to one template means one thing to get
 * right and one thing to keep out of the logs.
 *
 * ★★ The reset link is a **credential**. It is never logged, never put in an
 * audit metadata field, and never returned in an HTTP response. The only places
 * it exists are this transport and the user's inbox — and, in development, the
 * console, deliberately, so the flow is testable without a mail server.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly env: Env = loadEnv();
  private transporter: Transporter | null = null;

  /**
   * Whether mail can actually be sent.
   *
   * False when SMTP is unconfigured, which is a legitimate deployment state
   * during rollout — the API still issues valid tokens, and an administrator
   * resets passwords by hand. What must not happen is the endpoint pretending
   * to have sent something.
   */
  get isConfigured(): boolean {
    return Boolean(this.env.SMTP_HOST && this.env.MAIL_FROM);
  }

  private connection(): Transporter | null {
    if (!this.isConfigured) return null;

    this.transporter ??= createTransport({
      host: this.env.SMTP_HOST,
      port: this.env.SMTP_PORT,
      // Implicit TLS on 465; STARTTLS is negotiated on 587. Getting this
      // backwards produces a connection that hangs rather than an error.
      secure: this.env.SMTP_PORT === 465,
      ...(this.env.SMTP_USER
        ? { auth: { user: this.env.SMTP_USER, pass: this.env.SMTP_PASSWORD } }
        : {}),
    });

    return this.transporter;
  }

  /**
   * Sends the reset link.
   *
   * Returns whether it was sent. The **caller must not vary its response** on
   * the result: `POST /auth/password-reset` answers 204 for every identifier,
   * existing or not, so that it cannot be used to enumerate accounts. A failure
   * here is logged for operators, not surfaced to the requester.
   */
  async sendPasswordReset(to: string, token: string, userName: string): Promise<boolean> {
    const link = `${this.env.WEB_ORIGIN}/reset-password/${encodeURIComponent(token)}`;

    const transporter = this.connection();
    if (!transporter) {
      // Development and un-configured deployments. Printed only outside
      // production — a reset token in a production log file is a credential in
      // a production log file.
      if (this.env.NODE_ENV !== "production") {
        this.logger.warn(`[dev] password reset link for ${to}: ${link}`);
      } else {
        this.logger.error("SMTP is not configured; a password reset could not be delivered");
      }
      return false;
    }

    try {
      await transporter.sendMail({
        from: this.env.MAIL_FROM,
        to,
        subject: "Нууц үг сэргээх",
        text: passwordResetText(userName, link),
        html: passwordResetHtml(userName, link),
      });
      return true;
    } catch (error) {
      // ★ The message is logged, the link is not. A stack trace from nodemailer
      // does not contain it, but a naive `logger.error(error, { link })` would.
      this.logger.error(`Failed to send a password reset email: ${(error as Error).message}`);
      return false;
    }
  }

  /** Startup diagnostic, surfaced by /health/readiness. */
  async verify(): Promise<boolean> {
    const transporter = this.connection();
    if (!transporter) return false;

    try {
      await transporter.verify();
      return true;
    } catch (error) {
      this.logger.warn(`SMTP unreachable: ${(error as Error).message}`);
      return false;
    }
  }
}

/**
 * The plain-text body.
 *
 * Sent alongside the HTML, not instead of it: some Mongolian mail clients render
 * plain text by default, and a mail with no text part is more likely to be
 * scored as spam.
 */
function passwordResetText(name: string, link: string): string {
  return [
    `Сайн байна уу, ${name}.`,
    "",
    "Та нууц үгээ сэргээх хүсэлт илгээсэн байна. Доорх холбоосоор орж шинэ нууц үг тохируулна уу:",
    "",
    link,
    "",
    "Энэ холбоос 1 цагийн дараа хүчингүй болно.",
    "Хэрэв та энэ хүсэлтийг илгээгээгүй бол энэ захидлыг үл тоомсорлоно уу — таны нууц үг өөрчлөгдөхгүй.",
    "",
    "NomadKids",
  ].join("\n");
}

function passwordResetHtml(name: string, link: string): string {
  // Inline styles and a table-free layout: this has to survive Gmail, Outlook
  // and whatever the parent is reading it on, none of which support a
  // stylesheet.
  return `<!doctype html>
<html lang="mn">
<body style="margin:0;padding:24px;background:#F8F7F4;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#26242B;">
  <div style="max-width:480px;margin:0 auto;background:#FFFFFF;border:1px solid #E9E6E0;border-radius:16px;padding:24px;">
    <p style="margin:0 0 16px;font-size:16px;">Сайн байна уу, ${escapeHtml(name)}.</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6;">
      Та нууц үгээ сэргээх хүсэлт илгээсэн байна. Доорх товчийг дарж шинэ нууц үг тохируулна уу.
    </p>
    <p style="margin:0 0 20px;">
      <a href="${escapeHtml(link)}"
         style="display:inline-block;background:#6C63FF;color:#FFFFFF;text-decoration:none;padding:14px 24px;border-radius:12px;font-weight:600;font-size:15px;">
        Нууц үг сэргээх
      </a>
    </p>
    <p style="margin:0 0 8px;font-size:13px;color:#77737D;">
      Энэ холбоос 1 цагийн дараа хүчингүй болно.
    </p>
    <p style="margin:0;font-size:13px;color:#77737D;">
      Хэрэв та энэ хүсэлтийг илгээгээгүй бол энэ захидлыг үл тоомсорлоно уу — таны нууц үг өөрчлөгдөхгүй.
    </p>
  </div>
</body>
</html>`;
}

/** The name comes from the database and the link contains a token; both are escaped. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
