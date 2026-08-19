import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Proves the Prisma boundary rule actually fires.
 *
 * A lint rule nobody has seen fail is indistinguishable from a lint rule that
 * silently stopped matching — a changed path glob, a renamed file, an `ignores`
 * entry that grew too broad. Since this particular rule is what stands between
 * a hurried service and a cross-tenant data leak, its failure mode should not
 * be "quietly stops applying".
 *
 * These tests lint source text in memory. No fixture files are written, so
 * there is nothing to accidentally ship.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function lintAs(filePath: string, code: string) {
  const eslint = new ESLint({ cwd: repoRoot });
  return eslint.lintText(code, { filePath: resolve(repoRoot, filePath) });
}

const restricted = (result: ESLint.LintResult) =>
  result.messages.filter((m) => m.ruleId === "no-restricted-imports");

/** Under Prisma 7 the real query surface is the generated client. */
const IMPORT_GENERATED = `import { PrismaClient } from "../generated/prisma/client";\nexport const c = PrismaClient;\n`;
const IMPORT_PACKAGE = `import { PrismaClient } from "@prisma/client";\nexport const c = PrismaClient;\n`;
const INJECT_SERVICE = `import { PrismaService } from "../prisma/prisma.service";\nexport class S { constructor(readonly p: PrismaService) {} }\n`;

describe("Prisma repository boundary", () => {
  it("rejects the generated client in a service", async () => {
    const [result] = await lintAs("apps/api/src/children/children.service.ts", IMPORT_GENERATED);
    const errors = restricted(result!);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain("repository");
  });

  it("rejects the generated client in a controller", async () => {
    const [result] = await lintAs("apps/api/src/children/children.controller.ts", IMPORT_GENERATED);
    expect(restricted(result!)).toHaveLength(1);
  });

  it("rejects the @prisma/client package in a service", async () => {
    const [result] = await lintAs("apps/api/src/children/children.service.ts", IMPORT_PACKAGE);
    expect(restricted(result!)).toHaveLength(1);
  });

  it("rejects injecting PrismaService into a service", async () => {
    // The subtler bypass: not importing Prisma, but injecting the service that
    // wraps it — same unfiltered access, different import line.
    const [result] = await lintAs("apps/api/src/children/children.service.ts", INJECT_SERVICE);
    expect(restricted(result!)).toHaveLength(1);
  });

  it("allows the generated client in a repository", async () => {
    const [result] = await lintAs("apps/api/src/children/children.repository.ts", IMPORT_GENERATED);
    expect(restricted(result!)).toHaveLength(0);
  });

  it("allows PrismaService injection in a repository", async () => {
    const [result] = await lintAs("apps/api/src/children/children.repository.ts", INJECT_SERVICE);
    expect(restricted(result!)).toHaveLength(0);
  });

  it("allows the generated client in the Prisma service itself", async () => {
    const [result] = await lintAs("apps/api/src/prisma/prisma.service.ts", IMPORT_GENERATED);
    expect(restricted(result!)).toHaveLength(0);
  });
});
