/**
 * How many photographs one chat message may carry.
 *
 * ★ Mirrors `MAX_CHAT_IMAGES` in `apps/api/src/media/upload-validation.ts`,
 * which is the one that actually enforces it — the server refuses a fifth file
 * whatever the browser does. This copy exists so the attach button can grey
 * itself out at four rather than letting somebody pick six and discover the
 * limit from a 400.
 *
 * It lives here rather than in `@kinder/contracts` because it is not part of
 * any schema: nothing is parsed against it, and putting a number in the
 * contracts package that no `z.` expression reads would invite the next person
 * to add validation there instead of in the service that owns it.
 */
export const MAX_CHAT_IMAGES = 4;
