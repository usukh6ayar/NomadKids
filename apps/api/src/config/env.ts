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

    if (problems.length > 0) {
      throw new Error(
        `Unsafe production configuration:\n${problems.map((p) => `  ${p}`).join("\n")}`,
      );
    }
  }

  return env;
}
