/**
 * Schemas shared between the NestJS API and the Next.js web app.
 *
 * Two layers:
 *
 *  - **Primitives** — pagination, the error envelope, id formats.
 *  - **Domain** (`domain.ts`) — the response shapes the web app parses. Added in
 *    Phase 11, once the API had settled them; writing these before the features
 *    existed would have been guessing.
 */
export * from "./domain";
export * from "./ids";
export * from "./pagination";
export * from "./problem";
