import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import { AppModule } from "../../src/app.module";
import { ProblemExceptionFilter } from "../../src/common/filters/problem.filter";

/**
 * Boots the real application for integration tests.
 *
 * The whole AppModule, the real guards, the real database. Nothing is mocked,
 * because the thing under test is whether an *endpoint* enforces authorization
 * — and a mocked guard would prove only that the mock works. CLAUDE.md §4.1.
 *
 * ★ The app **listens on an ephemeral port**.
 *
 * `request(app.getHttpServer())` on a non-listening server makes supertest bind
 * a fresh listener for every single request. At this suite's volume — the
 * children file alone performs several hundred logins — that exhausts ephemeral
 * ports and starts reusing sockets mid-response. The failures look like
 * anything but the cause: `Parse Error: Expected HTTP/`, a login returning 400,
 * a `beforeEach` timing out. They move between tests on every run, which is the
 * signature of a resource problem rather than a logic one.
 *
 * Listening once means supertest reuses the open server, and the suite is
 * deterministic.
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  app.setGlobalPrefix("v1");
  app.set("trust proxy", 1);
  app.use(cookieParser());
  app.useGlobalFilters(new ProblemExceptionFilter());

  await app.init();
  await app.listen(0);
  return app;
}
