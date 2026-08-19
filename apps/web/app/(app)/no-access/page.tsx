"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useLogout } from "@/lib/auth/session";

/**
 * Signed in, but holding no membership.
 *
 * A real state, not a defensive branch: it is what a teacher sees the morning
 * after their membership is deactivated, and what an invited user sees before
 * an administrator assigns them to a kindergarten. Without this page the root
 * redirect has nowhere to send them and loops.
 *
 * It says what to do — contact the kindergarten — rather than "Хандах эрхгүй",
 * which reads like an accusation and offers no way forward.
 */
export default function NoAccessPage() {
  const logout = useLogout();

  return (
    <div className="mx-auto flex max-w-[520px] flex-col gap-4 py-10">
      <Card className="px-6 py-8 text-center">
        <h1 className="text-lg font-semibold text-ink">Таны бүртгэл идэвхжээгүй байна</h1>
        <p className="mt-2 text-sm text-muted">
          Таны хэрэглэгч ямар нэг цэцэрлэгт бүртгэгдээгүй эсвэл эрх нь хаагдсан байна. Цэцэрлэгийн
          удирдлагатай холбогдоно уу.
        </p>
        <div className="mt-5">
          <Button variant="secondary" onClick={() => void logout()}>
            Гарах
          </Button>
        </div>
      </Card>
    </div>
  );
}
