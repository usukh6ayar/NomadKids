"use client";

import { ArrowDown, FileCheck2, Search } from "lucide-react";
import { EsisDataPanel } from "@/components/esis/esis-data-panel";
import { PageHeader } from "@/components/shell/app-shell";
import { RequireRole } from "@/components/shell/require-role";
import { Card, SectionHeader } from "@/components/ui/card";

/**
 * One working surface for the approved ESIS qualification services.
 *
 * API 119 is deliberately first: it converts a teacher's register number into
 * the `requestId` required by APIs 167 and 170. API 165 is a real ministry
 * write, so this screen documents the dependency but does not submit an
 * invented payload before its complete contract is confirmed.
 */
export default function AdminQualificationsPage() {
  return (
    <RequireRole roles={["ADMIN"]}>
      <div className="flex w-full flex-col gap-6">
        <PageHeader
          title="Мэргэшлийн зэрэг"
          lede="ЭСИС-ийн хүсэлтийн дугаар, шийдвэрлэлт болон өөрчлөлтийн түүхийг нэг дор шалгана."
        />

        <Card pad="roomy" className="flex flex-col gap-4">
          <SectionHeader
            title="Хүсэлтийн дугаар хаанаас авах вэ?"
            lede="Хүсэлтийн дугаар нь гараар зохиодог утга биш. API 119-д багшийн РД-г өгч ESIS-ээс авна."
          />
          <ol className="grid gap-3 text-body text-muted md:grid-cols-[1fr_auto_1fr] md:items-center">
            <li className="flex items-start gap-3 rounded-row bg-canvas p-4">
              <Search className="mt-0.5 shrink-0 text-primary" size={20} aria-hidden />
              <span>
                <strong className="block font-semibold text-ink">1. РД-гаар хайх</strong>
                Доорх API 119 хэсэгт багшийн регистрийн дугаарыг оруулна.
              </span>
            </li>
            <ArrowDown className="mx-auto text-faint md:-rotate-90" size={20} aria-hidden />
            <li className="flex items-start gap-3 rounded-row bg-canvas p-4">
              <FileCheck2 className="mt-0.5 shrink-0 text-primary" size={20} aria-hidden />
              <span>
                <strong className="block font-semibold text-ink">2. requestId ашиглах</strong>
                ESIS-ийн буцаасан дугаарыг шийдвэрлэлт болон түүхийн талбарт оруулна.
              </span>
            </li>
          </ol>
        </Card>

        <EsisDataPanel
          resource="degreeRequest"
          title="Хүсэлтийн дугаар авах"
          description="API 119 · Багшийн РД-гаар мэргэшлийн зэргийн requestId авна"
          autoRead={false}
          actionLabel="Хүсэлтийн дугаар авах"
        />

        <div className="grid min-w-0 gap-6 xl:grid-cols-2">
          <EsisDataPanel
            resource="degreeDecisions"
            title="Хүсэлтийн шийдвэрлэлт"
            description="API 167 · requestId-аар шийдвэрлэлтийн төлөв шалгана"
            autoRead={false}
          />
          <EsisDataPanel
            resource="degreeHistory"
            title="Хүсэлтийн түүх"
            description="API 170 · requestId-аар хүсэлтийн өөрчлөлтийн түүх харна"
            autoRead={false}
          />
        </div>

        <Card pad="roomy">
          <SectionHeader
            title="Хүсэлтийн үндсэн мэдээлэл хадгалах"
            lede="API 165 нь ESIS-д бодит хүсэлт хадгалдаг POST сервис. Энд ашиглах requestId-г API 119-өөс авна. Бүрэн хүсэлтийн талбарын гэрээ батлагдсаны дараа илгээх үйлдлийг идэвхжүүлнэ."
          />
        </Card>
      </div>
    </RequireRole>
  );
}
