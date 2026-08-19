import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC = "isPublic";

/**
 * Opts an endpoint out of authentication.
 *
 * Authentication is global, so this is the only way to expose a route. Making
 * "public" the explicit choice means a forgotten decorator locks an endpoint
 * rather than exposing one — a mistake that surfaces in the first test run
 * rather than in a breach.
 */
export const Public = () => SetMetadata(IS_PUBLIC, true);
