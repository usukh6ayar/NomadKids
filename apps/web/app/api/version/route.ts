/**
 * The build this server is running — what an open page compares its own
 * build with (`components/shell/update-banner.tsx`). Never cached: the
 * answer changes with every deploy.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { build: process.env.NEXT_PUBLIC_BUILD_ID ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
