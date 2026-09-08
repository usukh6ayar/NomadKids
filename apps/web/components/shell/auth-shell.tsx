import Image from "next/image";
import Link from "next/link";
import { BRAND } from "@/lib/vocabulary";
import type { ReactNode } from "react";

/**
 * The shell for every signed-out screen: login, forgot-password, reset-password.
 *
 * ★ Ported from the reference project's `base_auth.html`, which is the approved
 * visual design (`docs/design/screens/auth-login-and-password-reset.jpeg`).
 *
 * A card on the left with the mark beside the title, and an illustration panel
 * on the right that folds away below 900px. The breakpoint is 900px and not
 * Tailwind's `lg` (1024px) because that is what the reference uses — at 1000px
 * the two-column split still has room, and jumping to one column early leaves a
 * conspicuously empty right half.
 *
 * The art panel is `hidden`, not shrunk: a teacher signing in on a bus needs the
 * form, not the picture. It is also `aria-hidden` — it says nothing the card
 * does not already say, and announcing a decorative logo twice is noise.
 */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh grid-cols-1 bg-canvas min-[900px]:grid-cols-2">
      <div className="grid place-items-center px-6 py-8">
        {/*
          `overflow-wrap: anywhere` is load-bearing, not defensive. Mongolian
          labels are long compounds — "Хэрэглэгчийн нэр, и-мэйл эсвэл утас" —
          and without it a single unbroken word pushes the card wider than its
          column and the inputs run off the right edge.
        */}
        <main className="w-full max-w-[440px] rounded-card border border-border bg-surface px-7 py-8 [overflow-wrap:anywhere] min-[900px]:shadow-sm">
          {/*
            ★ The drawn logo carries the name; no wordmark is set beside it.

            `logo.png` has "БЯЦХАН НҮҮДЭЛЧИД" lettered into the artwork. Setting
            another wordmark next to it would put two names for one product on the
            first screen anybody sees, so the heading below is the logo itself —
            `alt` is what a screen reader announces, and it is the only place
            the name appears in text here.

            ★★ Client's decision, 2026-09-06: keep the lettering. The
            alternative was `mark.png`, the same illustration with none.
          */}
          <div className="mb-[22px] flex items-center gap-3.5">
            {/*
              ★ 76, not the 54 this was while the name sat beside it in text.

              The lettering is part of the artwork now, so the logo has to be
              big enough for it to resolve — at 54 it was a coloured smudge over
              two grey lines. 76 is the width at which "БЯЦХАН" reads on a 1×
              display, and it is what the card's own left column can hold
              without pushing the sentence beside it onto a fourth line.
            */}
            <h1 className="shrink-0">
              <Image
                src="/logo.png"
                alt={BRAND}
                width={76}
                height={76}
                className="w-[76px]"
                style={{ height: "auto" }}
                priority
              />
            </h1>
            <p className="text-compact leading-snug text-muted">
              Багш, эцэг эх, администраторт зориулсан аюулгүй нэвтрэх систем.
            </p>
          </div>

          {children}

          <div className="mt-[22px] flex flex-wrap justify-center gap-x-3.5 gap-y-1.5 border-t border-border pt-4 text-compact text-muted">
            <span>Аюулгүй нэвтрэлт</span>
            <span aria-hidden="true">·</span>
            <span>HTTPS</span>
            <span aria-hidden="true">·</span>
            <span>Нууц үг хамгаалагдсан</span>
          </div>
          <nav
            aria-label="Нууцлал ба тусламж"
            className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-caption font-semibold text-primary"
          >
            <Link href="/privacy" className="min-h-10 content-center hover:underline">
              Нууцлал
            </Link>
            <Link href="/terms" className="min-h-10 content-center hover:underline">
              Үйлчилгээний нөхцөл
            </Link>
            <Link href="/faq" className="min-h-10 content-center hover:underline">
              Түгээмэл асуулт
            </Link>
          </nav>
        </main>
      </div>

      <aside
        aria-hidden="true"
        className="hidden place-items-center bg-[linear-gradient(160deg,#eef1fd,#e6ecfb_55%,#dfe7fa)] p-10 text-center min-[900px]:grid"
      >
        <div>
          {/*
            ★ This was capped at 210px, and the cap was a workaround, not a
            design: the old `/logo-160.png` was 149px wide, so 380 rendered
            visibly soft and a blurred logo on the first screen anyone sees is
            worse than a small sharp one. `/logo.png` is regenerated from the
            1400² original, so the cap has nothing left to protect against.
            300 on a 2× display asks for 600 source pixels; there are 1400.

            ★★ No wordmark under it either — the lettering is in the artwork,
            and this panel is `aria-hidden`, so a name repeated here would be
            decoration that says the same thing twice.
          */}
          <Image
            src="/logo.png"
            alt=""
            width={300}
            height={300}
            className="mx-auto w-[300px] max-w-full"
            style={{ height: "auto" }}
          />
          <p className="mt-6 text-title font-semibold text-ink">Хүүхэд бүрийн хөгжлийн түүх</p>
          <p className="mx-auto mt-2.5 max-w-[34ch] text-body leading-relaxed text-muted">
            Багшийн ажиглалт, эцэг эхийн оролцоо, улирлын үнэлгээ — бүгд нэг дор, хүүхэд тус бүрийн
            цахим хувийн хавтаст.
          </p>
        </div>
      </aside>
    </div>
  );
}

/*
 * ★ The role tabs were removed on 2026-08-24.
 *
 * `LOGIN_TABS` offered Багш / Эцэг эх / Админ and changed one thing: the label
 * above the identifier field. Багш and Админ were byte-identical
 * ("Нэвтрэх нэр эсвэл и-мэйл"), so two of the three did not even do that — and
 * the choice was never sent anywhere. The API takes `identifier` and `password`
 * and resolves the role from `Membership` afterwards, so someone who picked the
 * wrong tab signed in exactly as well as someone who picked the right one.
 *
 * The first control every user in this system touches asked a question, ignored
 * the answer, and in two cases out of three did not change the screen. That is a
 * false affordance in the most consequential position in the product, and the
 * support call it generates is "Би багш дээр дарах ёстой юу?".
 *
 * The docblock that stood here defended the control's *presentational* nature as
 * a security property — filtering authentication by tab would make the form a
 * role oracle — and that argument is correct and still binding. It is an
 * argument for never wiring the tabs up. Given that, the tabs had nothing left
 * to do. `login/page.tsx` asks for one identifier and names all three things it
 * accepts.
 *
 * RFP §3.1 requires "хэрэглэгчийн эрхэд суурилсан нэвтрэх систем" — role-*based
 * access* — and line 800 that all three roles can sign in. Neither asks the user
 * to declare a role at the door.
 */
