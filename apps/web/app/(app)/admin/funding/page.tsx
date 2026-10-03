import { redirect } from "next/navigation";

/**
 * «Төлбөрийн тайлан» became «Санхүү» → «Жилийн тайлан» on 2026-10-01, at the
 * client's request to gather the finance screens into one. The route stays so
 * bookmarks still land; the content is `PaymentReport`.
 */
export default function AdminPaymentReportPage() {
  redirect("/finance?tab=annual");
}
