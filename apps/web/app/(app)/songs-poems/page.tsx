"use client";

import { SongsPoemsLibrary } from "@/components/songs-poems/songs-poems-library";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";

export default function SongsPoemsPage() {
  return (
    <RequireRole roles={["TEACHER"]}>
      <div className="page-band">
        <PageHeader title="Дуу, шүлэг" backHref="/dashboard" />
        <SongsPoemsLibrary mode="teacher" />
      </div>
    </RequireRole>
  );
}
