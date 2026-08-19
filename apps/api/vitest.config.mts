import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    globals: true,
    setupFiles: ["./test/setup.ts"],
    // One disconnect after all files — see test/support/db.ts for why this
    // cannot live in each file's afterAll.
    globalTeardown: ["./test/teardown.ts"],
    // Integration tests share one Postgres and truncate between cases, so two
    // files running concurrently would delete each other's fixtures mid-test.
    // Single-fork keeps the database deterministic; the suite is fast enough
    // that serialising costs little.
    pool: "forks",
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,
  },
  plugins: [
    // Vitest transpiles with esbuild, which supports experimentalDecorators but
    // NOT emitDecoratorMetadata. NestJS resolves constructor dependencies from
    // that metadata, so without SWC every injected provider arrives undefined
    // and the failure looks like a DI bug rather than a build-config one.
    swc.vite({
      module: { type: "es6" },
      jsc: {
        target: "es2022",
        parser: { syntax: "typescript", decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
});
