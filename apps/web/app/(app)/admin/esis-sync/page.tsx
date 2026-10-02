import { redirect } from "next/navigation";

/**
 * ЭСИС холболт moved into «Байгууллага» on 2026-10-01, at the client's request
 * — it was the only entry in its own «Интеграц» menu group. The route stays so
 * bookmarks and links still land; the content is `EsisHub`.
 */
export default function AdminEsisSyncPage() {
  redirect("/admin/kindergarten?tab=esis");
}
