"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useLogout, useSession } from "@/lib/auth/session";

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
  const { session } = useSession();
  // ★ The kindergarten's paid service has lapsed (2026-10-27) — not this person's account.
  const lapsed = session?.lapsed ?? [];

  return (
    <div className="mx-auto flex max-w-[520px] flex-col gap-4 py-10">
      <Card className="px-6 py-8 text-center">
        {lapsed.length > 0 ? (
          <>
            <h1 className="text-title font-semibold text-ink">
              Цэцэрлэгийн үйлчилгээний эрх дууссан байна
            </h1>
            <p className="mt-2 text-body text-muted">
              {lapsed.map((m) => m.name).join(", ")}-ийн NomadKids-ийн төлбөрийн хугацаа дууссан тул
              систем түр хаагдлаа. Эрхлэгч «Үйлчилгээний эрх»-ээс төлбөрөө төлмөгц дахин нээгдэнэ.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-title font-semibold text-ink">Таны бүртгэл идэвхжээгүй байна</h1>
            <p className="mt-2 text-body text-muted">
              Таны хэрэглэгч ямар нэг цэцэрлэгт бүртгэгдээгүй эсвэл эрх нь хаагдсан байна.
              Цэцэрлэгийн удирдлагатай холбогдоно уу.
            </p>
          </>
        )}
        <div className="mt-5">
          <Button variant="secondary" onClick={() => void logout()}>
            Гарах
          </Button>
        </div>
      </Card>
    </div>
  );
}
