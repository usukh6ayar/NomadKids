import { z } from "zod";

/**
 * Every primary key is a UUID — docs/DATABASE.md §1.3.
 *
 * Validating the format at the edge means a malformed id is a 400 before it
 * reaches a query, and an id from another system is rejected rather than
 * quietly returning nothing.
 */
export const uuidSchema = z.uuid();

export const idParamSchema = z.object({ id: uuidSchema });

export type UUID = z.infer<typeof uuidSchema>;
