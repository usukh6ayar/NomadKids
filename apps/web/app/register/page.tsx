"use client";

import { useRouter } from "next/navigation";
import { Suspense } from "react";
import { PublicLanding } from "@/components/public/landing";
import { RegisterDialog } from "@/components/public/register-dialog";

/**
 * Байгууллагын бүртгэл — `docs/CONTRACT_ONBOARDING.md` steps 1–2.
 *
 * ★ The home page with the form in a window over it, since 2026-10-08 (the
 * client: "цонхоор нээгдээд х гээд гардаг, арын зайгаар нүүр хэсэг
 * харагддаг"). Still its own address, because the ☰ menu, the price page's
 * «Гэрээ байгуулах» and older links point here; closing it goes home.
 */
export default function RegisterPage() {
  const router = useRouter();
  return (
    <Suspense fallback={<div className="min-h-dvh bg-white" />}>
      <PublicLanding />
      <RegisterDialog onClose={() => router.push("/")} />
    </Suspense>
  );
}
