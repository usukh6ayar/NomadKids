"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { get } from "@/lib/api/browser";
import { errorMessage, isNotFound } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session";
import { materialBuyPath, materialPrice, publicMaterialSchema } from "@/lib/materials";
import { SamplePages } from "@/components/materials/teaching-materials";
import { TeacherApplyDialog } from "@/components/public/teacher-apply-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";

/**
 * `/m/:id` — one teaching material, for anyone with the link (2026-10-14, the
 * user: "холбоосоор шууд нээлттэй … линк дараад худалдаж авдаг"). Sample
 * pages only, watermarked, never the file (CLAUDE.md §1.4).
 *
 * «Авах» is a teacher's (the user: "зөвхөн багш"): a signed-in teacher goes to
 * the shop on this material and pays there by QPay; anyone signed out signs in
 * or signs up as a teacher, and comes back to it; anyone else is told it is
 * for teachers. `GET /public/materials/:id` is asked of the admin.
 */
export function SharedMaterial() {
  const { id } = useParams<{ id: string }>();
  const { session, isLoading: sessionLoading, hasRole } = useSession();
  const [signingUp, setSigningUp] = useState(false);
  const material = useQuery({
    queryKey: ["public", "material", id],
    queryFn: () => get(`/public/materials/${id}`, publicMaterialSchema),
    retry: false,
  });
  const buyPath = materialBuyPath(id);

  if (material.isLoading) return <LoadingState rows={4} />;
  if (material.isError) {
    return isNotFound(material.error) ? (
      <EmptyState
        title="Хэрэглэгдэхүүн олдсонгүй"
        description="Холбоос буруу, эсвэл энэ хэрэглэгдэхүүн одоогоор зарагдахгүй байна."
        action={
          <Button asChild variant="secondary">
            <Link href="/">Нүүр хуудас</Link>
          </Button>
        }
      />
    ) : (
      <ErrorState description={errorMessage(material.error)} />
    );
  }
  const m = material.data!;

  return (
    <article aria-label={m.title} className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <p className="text-caption font-semibold uppercase tracking-[0.12em] text-muted">
          Сургалтын хэрэглэгдэхүүн
        </p>
        <h1 className="text-heading font-bold text-ink">{m.title}</h1>
        <p className="text-caption text-muted">
          {m.fileType === "PPT" ? "PowerPoint" : "PDF"} · {m.area}
          {m.level ? ` · ${m.level} түвшин` : ""}
          {m.pages ? ` · ${m.pages} хуудас` : ""}
        </p>
      </header>

      <SamplePages material={m} />

      {m.description ? <p className="text-body text-ink">{m.description}</p> : null}
      {m.contents.length > 0 ? (
        <section aria-label="Агуулга">
          <h2 className="mb-1 text-caption font-semibold text-ink">Агуулга</h2>
          <ol className="list-decimal pl-5 text-body text-ink">
            {m.contents.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        </section>
      ) : null}

      <div
        aria-label="Авах"
        className="flex flex-col gap-3 rounded-card border border-border bg-white p-4"
      >
        <p className="text-title font-bold tabular-nums text-ink">{materialPrice(m.price)}</p>
        {sessionLoading ? null : session && hasRole("TEACHER") ? (
          <Button asChild>
            <Link href={buyPath}>Авах</Link>
          </Button>
        ) : session ? (
          <p className="text-body text-muted">
            Сургалтын хэрэглэгдэхүүнийг зөвхөн багш худалдаж авна.
          </p>
        ) : (
          <>
            <p className="text-body text-muted">
              Авахын тулд багшийн бүртгэлээрээ нэвтэрнэ үү. Бүртгэлгүй бол үнэгүй бүртгүүлээд энэ
              хуудас руу буцаж ирнэ.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link href={`/login?from=${encodeURIComponent(buyPath)}`}>Нэвтэрч авах</Link>
              </Button>
              <Button variant="secondary" onClick={() => setSigningUp(true)}>
                Багшаар бүртгүүлэх
              </Button>
            </div>
          </>
        )}
      </div>

      {signingUp ? (
        <TeacherApplyDialog initialMode="solo" next={buyPath} onClose={() => setSigningUp(false)} />
      ) : null}
    </article>
  );
}
