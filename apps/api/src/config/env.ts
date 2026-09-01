import { z } from "zod";

/**
 * Environment validation.
 *
 * Every setting the API reads is declared here and parsed once, at boot. A
 * missing or malformed value stops the process with a readable list of what is
 * wrong — rather than surfacing hours later as `undefined` in a database URL or
 * a JWT signed with the string "undefined".
 *
 * Adding a setting here means adding a line to .env.example. CLAUDE.md §1.5.
 */

const csv = z
  .string()
  .transform((s) =>
    s
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.url()).min(1));

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),

  /**
   * Exact origins only. A wildcard here plus `credentials: true` would let any
   * site read authenticated responses — docs/SECURITY.md §3.4.
   */
  CORS_ORIGINS: csv,

  DATABASE_URL: z.string().startsWith("postgresql://"),
  REDIS_URL: z.string().startsWith("redis://"),

  /**
   * 32 characters is the floor, not a target. Generate with
   * `openssl rand -base64 48`.
   */
  JWT_SECRET: z.string().min(32),
  REFRESH_SECRET: z.string().min(32),

  /**
   * Almost always empty — including in production.
   *
   * The web app is https://nomadkids.mn and the API is
   * https://api.nomadkids.mn. Same registrable domain, therefore same-site,
   * therefore a host-only cookie set by the API is already sent on the web
   * app's credentialed requests. Setting `Domain=.nomadkids.mn` would only
   * widen it — every present and future subdomain would receive the session
   * cookie, for no benefit.
   *
   * Set this only if a deployment genuinely needs the cookie readable across
   * subdomains. docs/SECURITY.md §3.1.
   */
  COOKIE_DOMAIN: z.string().default(""),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL: z.string().default("30d"),

  STORAGE_ENDPOINT: z.url(),
  STORAGE_REGION: z.string().default("auto"),
  STORAGE_BUCKET: z.string().min(1),
  STORAGE_ACCESS_KEY_ID: z.string().min(1),
  STORAGE_SECRET_ACCESS_KEY: z.string().min(1),
  STORAGE_PRESIGN_TTL: z.coerce.number().int().min(60).max(3600).default(300),

  /**
   * Where the web app lives. Used to build the password-reset link.
   *
   * Separate from CORS_ORIGINS, which may list several: a link has to name
   * exactly one, and picking the first of a list would be a silent guess.
   */
  WEB_ORIGIN: z.url().default("http://localhost:3000"),

  /**
   * SMTP. Optional as a set — an unconfigured deployment still issues valid
   * reset tokens, it simply cannot deliver them, and `MailService.isConfigured`
   * reports that honestly rather than pretending mail was sent.
   */
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().default(""),
  SMTP_PASSWORD: z.string().default(""),
  /** e.g. `NomadKids <noreply@nomadkids.mn>` */
  MAIL_FROM: z.string().default(""),

  /**
   * ESIS — the ministry's education information system.
   *
   * ★ Optional as a set, exactly like SMTP above, and for the same reason: a
   * deployment with no ESIS credentials is a legitimate state. Every existing
   * feature works without it; only the integration boundary reports itself
   * unconfigured, and it does so honestly rather than failing at the first
   * call with `undefined` in a URL.
   *
   * ★★ `ESIS_TOKEN` is a **credential**. It is read here, held on the server,
   * and never crosses into a response, a log line or a client bundle. It is
   * deliberately not prefixed `NEXT_PUBLIC_`, and `apps/web` has no reason to
   * name it — see `esis.client.ts` for the redaction that backs this up.
   */
  ESIS_BASE_URL: z.string().default(""),
  ESIS_TOKEN: z.string().default(""),
  ESIS_INSTITUTION_ID: z.string().default(""),
  /**
   * Milliseconds before an ESIS request is abandoned.
   *
   * A ministry endpoint that stops answering must not hold a request open
   * until the platform's own proxy times out — that turns their outage into a
   * pool of stuck connections here.
   */
  ESIS_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(15_000),

  /**
   * QPay — нэмэлт.md §8's online payment.
   *
   * ★ Optional as a set, exactly like ESIS above and for the same reason: a
   * deployment with no QPay merchant credentials is a legitimate state, every
   * existing feature keeps working, and the "QPay-ээр төлөх" button on a
   * parent's invoice simply does not render — see `QpayConfig.isConfigured`.
   *
   * `QPAY_PASSWORD` is a credential with the same handling `ESIS_TOKEN` gets:
   * read only here and in `qpay.client.ts`, never logged, never
   * `NEXT_PUBLIC_`. `docs/reference/QPAY_INTEGRATION.md` records the assumed
   * request/response shape — it has not been exercised against a live sandbox,
   * for lack of credentials to test with.
   *
   * ★★ **One merchant serves every kindergarten**, confirmed by the client on
   * 2026-08-31. That is why these are deployment-level settings rather than
   * columns on `Kindergarten`: every payment lands in the operator's own
   * account, and which kindergarten a payment belongs to is answered by the
   * invoice it references, not by which credentials took it. If a kindergarten
   * ever needs its own merchant, this becomes a table and `QpayConfig` grows a
   * lookup — do not sprinkle a second set of variables to special-case one.
   */
  QPAY_BASE_URL: z.string().default(""),
  QPAY_USERNAME: z.string().default(""),
  QPAY_PASSWORD: z.string().default(""),
  /** The invoice code QPay assigns the merchant. Not secret, but per-environment. */
  QPAY_INVOICE_CODE: z.string().default(""),
  /**
   * Where QPay calls back after a payment. Must be a public HTTPS URL — QPay's
   * servers call it, not the browser.
   *
   * Publicly reachable is exactly why its body is never trusted. The callback
   * is a *notification* naming a `qpay_invoice_id`; the payment is then
   * verified against QPay's own API (`checkPayment`) before anything is
   * credited — see `QpayService.reconcile`.
   */
  QPAY_CALLBACK_URL: z.string().default(""),
  /**
   * The portal access fee — one child, one school year, in tögrög.
   *
   * ★ **"0" means the gate is off**, and that is the default on purpose. A
   * deployment that has not been told a price must not lock every family out
   * of their own children's records; it serves the portal exactly as it did
   * before this feature existed. The gate only exists once somebody sets a
   * number.
   *
   * ★★ Priced per deployment, not per kindergarten. One QPay merchant serves
   * every kindergarten (client, 2026-08-31), so the money lands in one
   * account; prices set in many places against one account is a reconciliation
   * problem nobody asked for.
   *
   * A decimal string, never a number — `docs/FINANCE_MODULE.md` §2.1.
   */
  ACCESS_FEE_AMOUNT: z
    .string()
    .regex(/^\d{1,10}(\.\d{1,2})?$/, "ACCESS_FEE_AMOUNT нь мөнгөн дүн байна (жишээ: 15000.00)")
    .default("0"),

  QPAY_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(15_000),

  /**
   * Whether this instance consumes the report queue.
   *
   * On by default: one container is the right shape for a kindergarten's
   * volume. Set it to `false` on API instances once PDF generation moves to its
   * own deployment — a 1 GB Chromium floor (docs/PDF_SPIKE.md §3) is a poor
   * reason to size every web instance for it.
   *
   * ★ Off in tests. A worker draining the queue in the background would race
   * every assertion about a job's status; the tests call
   * `ReportGeneratorService.run()` directly instead, which exercises the same
   * code with none of the timing.
   */
  REPORTS_WORKER_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parses and returns the environment, or throws with every problem listed at
 * once. Reporting one failure per restart turns a five-minute setup into
 * twenty.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(
      `Invalid environment configuration:\n${lines.join("\n")}\n\n` +
        `Copy .env.example to .env and fill in the missing values.`,
    );
  }

  const env = result.data;

  // Production-only invariants. These are correct in development and dangerous
  // in production, so the check belongs here rather than in the schema.
  if (env.NODE_ENV === "production") {
    const problems: string[] = [];

    if (env.CORS_ORIGINS.some((o) => o.includes("localhost"))) {
      problems.push("CORS_ORIGINS contains localhost");
    }
    if (env.CORS_ORIGINS.some((o) => o.startsWith("http://"))) {
      problems.push("CORS_ORIGINS contains a plaintext http:// origin");
    }
    // Deliberately NOT requiring COOKIE_DOMAIN. A host-only cookie is the
    // correct default for nomadkids.mn + api.nomadkids.mn; requiring a value
    // here would push a wider cookie than the deployment needs.
    if (env.COOKIE_DOMAIN && !env.COOKIE_DOMAIN.startsWith(".")) {
      problems.push(
        `COOKIE_DOMAIN "${env.COOKIE_DOMAIN}" must begin with a dot to be shared ` +
          "across subdomains, or be left empty for a host-only cookie",
      );
    }
    if (env.JWT_SECRET === env.REFRESH_SECRET) {
      problems.push("JWT_SECRET and REFRESH_SECRET are identical");
    }
    // Half-configured SMTP is worse than none: it looks configured, and the
    // failure appears only when a parent cannot get a reset link.
    if (env.SMTP_HOST && !env.MAIL_FROM) {
      problems.push("SMTP_HOST is set but MAIL_FROM is empty");
    }
    if (env.MAIL_FROM && !env.SMTP_HOST) {
      problems.push("MAIL_FROM is set but SMTP_HOST is empty");
    }
    if (env.WEB_ORIGIN.startsWith("http://")) {
      problems.push("WEB_ORIGIN is a plaintext http:// origin");
    }
    /*
     * Half-configured ESIS, refused for the same reason as half-configured
     * SMTP: it looks configured. `isConfigured` would report true on a base
     * URL alone and every call would then fail unauthenticated, which reads as
     * "the ministry is rejecting us" rather than "we never set the token".
     */
    const esis = [
      ["ESIS_BASE_URL", env.ESIS_BASE_URL],
      ["ESIS_TOKEN", env.ESIS_TOKEN],
      ["ESIS_INSTITUTION_ID", env.ESIS_INSTITUTION_ID],
    ] as const;
    const esisSet = esis.filter(([, value]) => value !== "");

    if (esisSet.length > 0 && esisSet.length < esis.length) {
      const missing = esis.filter(([, value]) => value === "").map(([name]) => name);
      // Names only. The values of the ones that *are* set include the token.
      problems.push(`ESIS is partly configured — missing ${missing.join(", ")}`);
    }
    if (env.ESIS_BASE_URL && env.ESIS_BASE_URL.startsWith("http://")) {
      problems.push("ESIS_BASE_URL is a plaintext http:// origin — the token would cross it");
    }

    /*
     * Half-configured QPay, refused for the same reason as half-configured
     * ESIS: `QpayConfig.isConfigured` would report true on a base URL alone,
     * and every call would then fail unauthenticated — which reads as "QPay
     * is rejecting us" rather than "we never set the password". The stakes are
     * higher here than for ESIS: the failure surfaces to a parent trying to pay.
     */
    const qpay = [
      ["QPAY_BASE_URL", env.QPAY_BASE_URL],
      ["QPAY_USERNAME", env.QPAY_USERNAME],
      ["QPAY_PASSWORD", env.QPAY_PASSWORD],
      ["QPAY_INVOICE_CODE", env.QPAY_INVOICE_CODE],
      ["QPAY_CALLBACK_URL", env.QPAY_CALLBACK_URL],
    ] as const;
    const qpaySet = qpay.filter(([, value]) => value !== "");

    if (qpaySet.length > 0 && qpaySet.length < qpay.length) {
      const missing = qpay.filter(([, value]) => value === "").map(([name]) => name);
      // Names only — the values of the ones that *are* set include the password.
      problems.push(`QPay is partly configured — missing ${missing.join(", ")}`);
    }
    if (env.QPAY_BASE_URL && env.QPAY_BASE_URL.startsWith("http://")) {
      problems.push("QPAY_BASE_URL is a plaintext http:// origin — the password would cross it");
    }
    /*
     * ★ The callback URL must be https in production, and for a sharper reason
     * than the base URL: it is the address a payment confirmation arrives at.
     * Over plaintext it can be read and rewritten in flight, and a rewritten
     * confirmation is a free invoice.
     */
    if (env.QPAY_CALLBACK_URL && env.QPAY_CALLBACK_URL.startsWith("http://")) {
      problems.push("QPAY_CALLBACK_URL is a plaintext http:// origin");
    }
    if (env.QPAY_CALLBACK_URL && env.QPAY_CALLBACK_URL.includes("localhost")) {
      problems.push("QPAY_CALLBACK_URL is localhost — QPay's servers cannot reach it");
    }

    if (problems.length > 0) {
      throw new Error(
        `Unsafe production configuration:\n${problems.map((p) => `  ${p}`).join("\n")}`,
      );
    }
  }

  return env;
}
