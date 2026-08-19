import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

/**
 * The Prisma connection.
 *
 * ★ This is one of only two places permitted to touch the generated Prisma
 * client; the other pattern is `*.repository.ts`. The ESLint rule in
 * eslint.config.js enforces it and CI fails on a violation — and
 * test/prisma-boundary.test.ts proves the rule still fires.
 *
 * The rule exists because Prisma gives none of the safety Django's ORM gave for
 * free. `prisma.child.findMany()` returns soft-deleted rows, and returns *every
 * kindergarten's* rows, unless the call site remembers both filters. One
 * forgotten filter in one service is a cross-tenant data leak. Confining Prisma
 * to repositories keeps those filters in a handful of reviewable places instead
 * of at every call site in the codebase.
 *
 * CLAUDE.md §2.2 · docs/ARCHITECTURE.md §4.1 · docs/SECURITY.md §8
 *
 * Prisma 7 takes the connection through a driver adapter rather than a `url` in
 * schema.prisma. The URL comes from the validated environment, so a malformed
 * one has already stopped the process in main.ts.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log("Database connected");
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
