import { closeTestDb } from "./support/db";

/**
 * Global teardown — runs once, after every test file.
 *
 * The Prisma client is a module-level singleton that test files capture at
 * import time, so disconnecting it belongs here rather than in each file's
 * `afterAll`. Doing it per-file meant the first file to finish disconnected the
 * client every later file was still holding, producing failures that moved
 * around depending on execution order.
 */
export default async function teardown(): Promise<void> {
  await closeTestDb();
}
