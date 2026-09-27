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
import { z } from "zod";
import { mongolianErrorMap } from "./mn-locale";

/**
 * ★ Zod speaks Mongolian from here on — CLAUDE.md §5, "all user-facing UI text
 * in Mongolian", which a validation message under an input is.
 *
 * Installed at the entry point rather than in each app so there is one place
 * it can be got wrong, and **before** the `export *` lines below: those pull
 * in modules that build schemas at import time, and a schema is free to read
 * the config while it is being constructed.
 *
 * ★★ `mongolianErrorMap` is exported too, so this is a used binding rather
 * than a bare side-effect import — `tsc` emits the call either way, but a
 * side effect nothing references is the shape a future bundler is entitled to
 * drop, and the failure mode would be silent English.
 */
z.config(mongolianErrorMap());

export * from "./birth-facts";
export * from "./curriculum";
export * from "./domain";
export * from "./ids";
export * from "./local-date";
export * from "./mn-locale";
export * from "./pagination";
export * from "./password";
export * from "./working-days";
export * from "./problem";
