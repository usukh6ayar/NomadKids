"use client";

import { SongsPoemsLibrary } from "@/components/songs-poems/songs-poems-library";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";

export default function ChildSongsPoemsPage() {
  return (
    <RequireRole roles={["PARENT"]}>
      <div className="page-band">
        <PageHeader
          title="Дуу, шүлэг"
          backHref="/home"
          lede="Хүүхдийн тань тухайн сард сурсан дуу, шүлгийг багшийн оруулснаар үзнэ."
        />
        <SongsPoemsLibrary mode="parent" />
      </div>
    </RequireRole>
  );
}
