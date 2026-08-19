import "reflect-metadata";

// ★ Loads the repository-root `.env` before anything reads `process.env`.
//
// It must come before every other import: `loadEnv()` runs at module scope in
// several providers, so an import placed after them would parse an environment
// that is still empty. That failure is loud (the process refuses to boot with a
// list of missing keys) but its cause is not — it reads like a missing .env
// file rather than an import-order problem.
//
// In production the platform injects real environment variables and this call
// finds no file, which is exactly right: `override` is left off, so a deployed
// value is never replaced by a stray file.
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";

loadDotenv({ path: resolve(__dirname, "..", "..", "..", ".env"), quiet: true });

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module";
import { ProblemExceptionFilter } from "./common/filters/problem.filter";
import { loadEnv } from "./config/env";

async function bootstrap(): Promise<void> {
  // Validate the environment before anything else starts. A bad value should
  // stop the process here, not surface later as a malformed connection string.
  const env = loadEnv();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  app.setGlobalPrefix("v1");

  // Trust exactly one proxy hop — the platform's load balancer. Without this
  // req.ip is the balancer's address and every per-IP rate limit collapses into
  // one bucket; trusting *all* hops instead lets a client forge X-Forwarded-For
  // and escape the limit entirely. One hop is the only correct answer here.
  app.set("trust proxy", 1);

  // Express advertises `X-Powered-By: Express` on every response. It is free
  // reconnaissance — it names the framework, which narrows the set of CVEs
  // worth trying — and it buys nothing. The health endpoint is deliberately
  // uninformative for the same reason.
  app.disable("x-powered-by");

  /**
   * Security headers on every API response.
   *
   * The web app sets its own in `next.config.ts`; these cover the API, which a
   * browser also reaches directly — a presigned-URL redirect, an image, an
   * error page opened in a tab.
   *
   * ★ HSTS is set only over HTTPS. Sending it on a plain-http development
   * response would pin `localhost` to HTTPS in the developer's browser for two
   * years, and nothing on port 3000 or 3001 would load again until they cleared
   * the HSTS store — a genuinely nasty way to break a machine.
   */
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    // The API returns JSON and redirects, never HTML that could execute
    // anything. Denying everything is both correct and trivially safe here.
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");

    const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
    if (isHttps) {
      res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
    }

    next();
  });

  app.use(cookieParser());

  // Exact origins from the validated environment, never a wildcard — a wildcard
  // with credentials: true lets any site read authenticated responses.
  app.enableCors({
    origin: [...env.CORS_ORIGINS],
    credentials: true,
    // ★ PUT is not optional: the assessment and term-report endpoints are
    // idempotent upserts and use it. Omitting it fails the preflight, and the
    // browser reports a generic CORS error rather than anything resembling
    // "method not allowed" — so the symptom points at the wrong layer entirely.
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "X-CSRF-Token"],
  });

  // No global ValidationPipe: Nest's is class-validator based, and this project
  // validates with Zod schemas shared from packages/contracts. Controllers
  // apply ZodValidationPipe per route with their own schema.
  app.useGlobalFilters(new ProblemExceptionFilter());

  app.enableShutdownHooks();

  await app.listen(env.PORT);
  Logger.log(`API listening on :${env.PORT} (${env.NODE_ENV})`, "Bootstrap");
}

void bootstrap();
