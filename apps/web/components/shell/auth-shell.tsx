import Image from "next/image";
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
        <main className="w-full max-w-[440px] rounded-[18px] border border-border bg-surface px-7 py-8 [overflow-wrap:anywhere] min-[900px]:shadow-[0_1px_2px_rgba(37,35,42,.04),0_6px_16px_rgba(37,35,42,.045)]">
          <div className="mb-[22px] flex items-center gap-3.5">
            <Image
              src="/logo-160.png"
              alt="Бяцхан нүүдэлчид"
              width={54}
              height={54}
              className="w-[54px] shrink-0"
              style={{ height: "auto" }}
              priority
            />
            <div>
              <h1 className="text-[1.05rem] font-bold uppercase leading-[1.3] tracking-[.01em] text-ink">
                Хүүхдийн хөгжлийн
                <br />
                цахим хувийн хавтас
              </h1>
              <p className="mt-1 text-[.82rem] leading-snug text-muted">
                Багш, эцэг эх, администраторт зориулсан аюулгүй нэвтрэх систем.
              </p>
            </div>
          </div>

          {children}

          <div className="mt-[22px] flex flex-wrap justify-center gap-x-3.5 gap-y-1.5 border-t border-border pt-4 text-[.78rem] text-muted">
            <span>Аюулгүй нэвтрэлт</span>
            <span aria-hidden="true">·</span>
            <span>HTTPS</span>
            <span aria-hidden="true">·</span>
            <span>Нууц үг хамгаалагдсан</span>
          </div>
        </main>
      </div>

      <aside
        aria-hidden="true"
        className="hidden place-items-center bg-[linear-gradient(160deg,#eef1fd,#e6ecfb_55%,#dfe7fa)] p-10 text-center min-[900px]:grid"
      >
        <div>
          {/*
            Capped at the source file's own width. It is 160px tall, and scaling
            it to 380 was visibly soft — a blurred logo on the first screen
            anyone sees is worse than a small sharp one.
          */}
          <Image
            src="/logo-160.png"
            alt=""
            width={210}
            height={210}
            className="mx-auto w-[210px] max-w-full"
            style={{ height: "auto" }}
          />
          <p className="mt-6 text-[1.05rem] font-bold text-ink">Хүүхэд бүрийн хөгжлийн түүх</p>
          <p className="mx-auto mt-2.5 max-w-[34ch] text-[.9rem] leading-relaxed text-muted">
            Багшийн ажиглалт, эцэг эхийн оролцоо, улирлын үнэлгээ — бүгд нэг дор, хүүхэд тус бүрийн
            цахим хувийн хавтаст.
          </p>
        </div>
      </aside>
    </div>
  );
}

/**
 * The identifier the login form asks for, chosen by the role tabs.
 *
 * ★ Presentational only, and that is a security property rather than a
 * simplification. Filtering authentication by the selected tab would turn the
 * form into a role oracle — an attacker could learn which role an address
 * belongs to by watching which tab accepts it. The API takes `identifier` and
 * `password` and nothing else; the role is resolved from `Membership` after a
 * successful login, as it is on every other request. Same reasoning, and same
 * wording, as `LOGIN_TABS` in the reference project's `accounts/views.py`.
 */
export const LOGIN_TABS = [
  { key: "teacher", label: "Багш", identifierLabel: "Нэвтрэх нэр эсвэл и-мэйл" },
  { key: "parent", label: "Эцэг эх", identifierLabel: "Утасны дугаар эсвэл и-мэйл" },
  { key: "admin", label: "Админ", identifierLabel: "Нэвтрэх нэр эсвэл и-мэйл" },
] as const;

export type LoginTab = (typeof LOGIN_TABS)[number]["key"];

/**
 * The segmented control.
 *
 * ★ 44px minimum, where the reference is 41px.
 *
 * Measured on the running reference at 390px: the three tabs render 41px tall,
 * under the thumb floor the rest of this product holds to. Matching the design
 * does not extend to reproducing a target that is hard to hit, so these are
 * `min-h-[44px]`. It is the same control, two pixels more forgiving.
 *
 * `aria-pressed` rather than tab semantics: there are no tabpanels here, only
 * one form whose label changes. Calling them tabs would promise a screen reader
 * a structure that does not exist.
 */
export function LoginTabs({
  value,
  onChange,
}: {
  value: LoginTab;
  onChange: (next: LoginTab) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Хэрэглэгчийн төрөл"
      className="mb-4 grid grid-cols-3 gap-1 rounded-[14px] bg-canvas p-1"
    >
      {LOGIN_TABS.map((tab) => {
        const active = tab.key === value;
        return (
          <button
            key={tab.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(tab.key)}
            className={
              "min-h-[44px] rounded-[12px] px-2 text-sm font-semibold transition-colors " +
              (active
                ? "bg-primary text-primary-ink"
                : "text-muted hover:bg-surface hover:text-ink")
            }
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
