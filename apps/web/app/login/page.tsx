import { Suspense } from "react";
import { PublicLanding } from "@/components/public/landing";

/**
 * `/login` — the same page as `/`, reached by the URL people bookmark.
 *
 * ★ The content lives in `PublicLanding` because the root renders it too; see
 * that file for why. This route stays because it is what every invitation
 * e-mail, every "sign in" link and every browser autofill entry points at, and
 * because `#login-card` is the anchor the landing's own buttons scroll to.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-white" />}>
      <PublicLanding />
    </Suspense>
  );
}
