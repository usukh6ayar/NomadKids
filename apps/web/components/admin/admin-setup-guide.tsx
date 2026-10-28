"use client";

import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { adminDashboardSchema, schoolYearSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { useEsisLinked } from "@/lib/use-esis-linked";
import { SetupGuideDialog, type SetupStep } from "@/components/onboarding/setup-guide-dialog";

const yearsSchema = z.array(schoolYearSchema);

/**
 * "Хэрхэн хичээлийн жил, бүлэг, багш нэмэх" — the client, 2026-09-22:
 * "Удирдлага хэсэг рүү нэвтрэхэд цонх нээгдэж хэрхэн хичээлийн жил бүлэг багш
 * нэмэх. Step guide зураглал оруулах."
 *
 * ★ **It reads the kindergarten's real state rather than being a slideshow.**
 *
 * A static three-panel walkthrough would say "create a school year" to a
 * director who created one in August, which is the fastest way to teach
 * somebody to dismiss a dialog without reading it. Each step here is ticked
 * from data, so the guide is also the answer to "what is left to do".
 *
 * ★★ **The order is a dependency, not a preference.** A group belongs to a
 * school year — `@@unique([schoolYearId, name])` — and `/admin/groups` answers
 * 409 naming this screen when no current year exists (the ESIS roster import
 * does the same). Then the order splits on ESIS: «ESIS татах» makes groups
 * with no teacher, so a teacher is assigned *to* one afterwards; by hand, a
 * group needs its teacher at creation, so staff come first. Saying which order
 * applies here is most of the guide's value — see `steps` below.
 *
 * ★★★ **It opens itself only while something is unfinished.**
 *
 * "цонх нээгдэж" asks for a window on the way in. A window that opens every
 * time on a kindergarten that finished setting up in August is a nag, and the
 * client's complaint about this product has twice been that screens waste the
 * reader's space. So: auto-open while a step is unmet and undismissed, a button
 * to reopen it afterwards, and the dismissal is remembered per kindergarten —
 * two kindergartens on one deployment are two different setups.
 */
export function AdminSetupGuide() {
  const { primaryKindergartenId } = useSession();

  const overview = useQuery({
    // The same key `AdminOverview` uses, so this costs no second request.
    queryKey: qk.dashboard.admin(),
    queryFn: () => get("/dashboard/admin", adminDashboardSchema),
    staleTime: 60_000,
  });

  /*
   * ★ The school years themselves, not `currentTerm` from the dashboard.
   *
   * They are different facts and the difference matters here: a kindergarten
   * can have a school year with no term inside it yet, and `currentTerm` is
   * null for both that and "no year at all". Telling a director to create a
   * year they already have is exactly the misleading state this guide exists to
   * clear up, so it asks the question it actually wants answered.
   */
  const years = useQuery({
    queryKey: qk.adminSchoolYears(primaryKindergartenId ?? ""),
    queryFn: () => get(`/kindergartens/${primaryKindergartenId}/school-years`, yearsSchema),
    enabled: Boolean(primaryKindergartenId),
    staleTime: 60_000,
  });

  const storageKey = primaryKindergartenId ? `nk.setup-guide.${primaryKindergartenId}` : null;

  /*
   * ★ Two orders, by whether the kindergarten has ESIS — client, 2026-10-06.
   *
   * With ESIS, «ESIS татах» brings the school year and the groups together, and
   * staff can register themselves with the kindergarten's ESIS number. Without
   * it (a private kindergarten) none of that exists: the year is made by hand,
   * staff can only be invited — `/staff-register` checks the ESIS roster — and
   * a group cannot be created without its teacher («Бүлгийн багш» is required
   * on «Бүлэг нэмэх»), so staff come before groups. Only this guide differs;
   * the screens it points at are the same for both.
   */
  const esisLinked = useEsisLinked();
  const ready = overview.isSuccess && years.isSuccess && esisLinked !== undefined;

  const yearDone = (years.data?.length ?? 0) > 0;
  const groupsDone = (overview.data?.counts.groups ?? 0) > 0;
  const staffDone = (overview.data?.counts.staff ?? 0) > 0;
  /*
   * ★ Children and their families — 2026-10-18, the client: "анх нэвтрэхэд
   * хэрхэн бүлэг үүсгэж оруулах, яаж хүн урих боломжтойг харуулах". Setting
   * the kindergarten up was three steps; using it starts with these two, the
   * same for a kindergarten with ESIS or without.
   */
  const familySteps: SetupStep[] = [
    {
      title: "Хүүхэд бүртгэх",
      body: "«Суралцагч» хэсгийн «+ Суралцагч»-аар нэг нэгээр нь бүртгэж, бүлэгт нь оруулна.",
      href: "/children",
      action: "Суралцагч",
      art: "child",
      short: "Хүүхэд",
      done: (overview.data?.counts.children ?? 0) > 0,
    },
    {
      title: "Эцэг эх урих",
      body: "Хүүхдийн мөрний «⋯» › «Урих»-аар нэг гэр бүлийг, бүлгийн хуудсаас «Бүх эцэг эхийг урих»-аар бүлгийг тэр чигээр нь урина. Хэвлэсэн урилгын картыг эцэг эхэд өгөхөд тэд утсаараа бүртгүүлнэ.",
      href: "/children",
      action: "Суралцагч",
      art: "navParentHome",
      short: "Эцэг эх",
      done: (overview.data?.counts.guardians ?? 0) > 0,
    },
  ];

  const setupSteps: SetupStep[] = esisLinked
    ? [
        {
          title: "Хичээлийн жил",
          body: "Бүлгүүд хэсгийн «ESIS татах» товч хичээлийн жилийг бүлэгтэй хамт автоматаар үүсгэнэ. Бүлэг, ирц, үнэлгээ бүгд хичээлийн жилд харьяалагдана.",
          href: "/admin/groups",
          action: "Бүлгүүд",
          art: "adminSchoolYear",
          short: "Хичээлийн жил",
          done: yearDone,
        },
        {
          title: "Бүлэг татах",
          body: "«ESIS татах»-аар бүлэг, хүүхдийг нэг товчоор татна. Бүлэг тус бүрд нас, хөтөлбөрийн төрөл, ирцийн хэлбэрийг заана.",
          href: "/admin/groups",
          action: "Бүлгүүд",
          art: "group",
          short: "Бүлэг",
          done: groupsDone,
        },
        {
          title: "Багш, ажилтан бүртгэх",
          body: "Ажилтан цэцэрлэгийн ESIS дугаараар өөрөө бүртгүүлнэ, эсвэл та урина. Дараа нь бүлэг рүү үндсэн багш, багшийн туслахаар хуваарилна.",
          href: "/admin/users",
          action: "Багш, ажилтан",
          art: "teacher",
          short: "Багш",
          done: staffDone,
        },
      ]
    : [
        {
          title: "Хичээлийн жил үүсгэх",
          body: "«Жил нэмэх»-ээр хичээлийн жилээ үүсгэнэ. Бүлэг, ирц, үнэлгээ бүгд хичээлийн жилд харьяалагдана.",
          href: "/admin/school-years",
          action: "Хичээлийн жил",
          art: "adminSchoolYear",
          short: "Хичээлийн жил",
          done: yearDone,
        },
        {
          title: "Багш, ажилтан урих",
          body: "«Хэрэглэгч нэмэх»-ээр багш, ажилтнаа урина. Урилга хүлээн авсан хүн нууц үгээ өөрөө үүсгэнэ. Бүлэг үүсгэхэд бүлгийн багш хэрэгтэй тул бүлгээс өмнө урина.",
          href: "/admin/users",
          action: "Багш, ажилтан",
          art: "teacher",
          short: "Багш",
          done: staffDone,
        },
        {
          title: "Бүлэг нэмэх",
          body: "«Бүлэг нэмэх»-ээр бүлгээ үүсгэж, нас, хөтөлбөрийн төрөл болон бүлгийн багшийг сонгоно. Дараа нь туслах багшийг хуваарилна.",
          href: "/admin/groups",
          action: "Бүлгүүд",
          art: "group",
          short: "Бүлэг",
          done: groupsDone,
        },
      ];

  const steps = [...setupSteps, ...familySteps];

  return (
    <SetupGuideDialog
      steps={steps}
      ready={ready}
      storageKey={storageKey}
      title="Цэцэрлэгийг тохируулах"
      buttonLabel="Тохиргооны заавар"
    />
  );
}
