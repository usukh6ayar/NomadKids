import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import { AppModule } from "../../src/app.module";
import { ProblemExceptionFilter } from "../../src/common/filters/problem.filter";
import { QpayService } from "../../src/integrations/qpay/qpay.service";
import { EsisService } from "../../src/integrations/esis/esis.service";

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
export async function createTestApp(options: TestAppOptions = {}): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] });

  /*
   * ★ Provider overrides are narrow and transport-only on purpose.
   *
   * Everything in this suite runs against the real guards and the real
   * database. QPay is overridden because the alternative is a test that
   * spends money: verifying a payment means an authenticated call to a payment
   * provider, and there is no sandbox available to us (docs/reference/QPAY_INTEGRATION.md
   * §5). The *client* is stubbed, never the authorization around it — the
   * callback route, its guards and `QpayPaymentsService` are all the real ones,
   * which is what the security tests need to be worth anything. ESIS follows
   * the same boundary: only the remote transport is replaced; tenant checks,
   * persistence, audit logging, and HTTP authorization remain real.
   */
  if (options.qpay) {
    builder = builder.overrideProvider(QpayService).useValue(options.qpay);
  }
  if (options.esis) {
    builder = builder.overrideProvider(EsisService).useValue(options.esis);
  }

  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  app.setGlobalPrefix("v1");
  app.set("trust proxy", 1);
  app.use(cookieParser());
  app.useGlobalFilters(new ProblemExceptionFilter());

  await app.init();
  await app.listen(0);
  return app;
}

export interface TestAppOptions {
  /** A stand-in for the payment provider. See the note above. */
  qpay?: Partial<QpayService>;
  /** ESIS transport stand-in. Authorization and persistence stay real. */
  esis?: Partial<EsisService>;
}
