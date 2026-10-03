import { redirect } from "next/navigation";

/**
 * Сургалтын хөтөлбөр moved into «Байгууллага» on 2026-10-01, at the client's
 * request — it was the only entry in its own menu group. The route stays so a
 * bookmark or the setup guide's link still lands somewhere.
 */
export default function CurriculumPage() {
  redirect("/admin/kindergarten?tab=curriculum");
}
