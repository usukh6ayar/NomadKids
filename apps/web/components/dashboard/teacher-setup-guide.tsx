"use client";

import { useQuery } from "@tanstack/react-query";
import { childSummarySchema, paginated, teacherDashboardSchema } from "@kinder/contracts";
import { get } from "@/lib/api/browser";
import { qk } from "@/lib/api/keys";
import { useSession } from "@/lib/auth/session";
import { useSoloWorkspaceId } from "@/lib/auth/solo";
import { useMyGroup } from "@/components/dashboard/use-my-group";
import { SetupGuideDialog, type SetupStep } from "@/components/onboarding/setup-guide-dialog";

const childrenSchema = paginated(childSummarySchema);

/**
 * The teacher's first-steps guide — 2026-10-18, the client: "багш болон
 * удирдлага анх нэвтрэхэд хэрхэн бүлэг үүсгэж оруулах, яаж хүн урих
 * боломжтойг харуулах". The director's is `AdminSetupGuide`; the window is the
 * same (`SetupGuideDialog`).
 *
 * ★ Two beginnings. A solo teacher makes their own year and group
 * (`/my-group`); a kindergarten's teacher is given a group by the director and
 * can only be told to ask. From there both register children and invite the
 * families the same way.
 *
 * ★★ Each step is ticked from data: the group from `GET /groups`, the
 * children from the dashboard's own count, the families from the roster's
 * `profile.guardianContact` — a guardian with a phone on the child, which is
 * what an accepted invitation leaves.
 */
export function TeacherSetupGuide() {
  const { session, primaryKindergartenId } = useSession();
  const solo = useSoloWorkspaceId() !== null;
  const { group, isLoading: groupLoading } = useMyGroup();

  const dashboard = useQuery({
    // The dashboard's own key — no second request.
    queryKey: qk.dashboard.teacher(),
    queryFn: () => get("/dashboard/teacher", teacherDashboardSchema),
  });
  const roster = useQuery({
    queryKey: ["children", "setup-guide"],
    queryFn: () => get("/children?page=1&pageSize=100", childrenSchema),
    enabled: Boolean(group),
    staleTime: 60_000,
  });

  const hasGroup = Boolean(group);
  const hasChildren = (dashboard.data?.counts.children ?? 0) > 0;
  const hasFamilies = (roster.data?.items ?? []).some((child) => child.profile?.guardianContact);
  const ready = !groupLoading && dashboard.isSuccess && (!hasGroup || !roster.isPending);

  const first: SetupStep = solo
    ? {
        title: "Хичээлийн жил, бүлэг үүсгэх",
        body: "«Бүлэг, хичээлийн жил» хуудсанд хичээлийн жилээ үүсгээд, нэг бүлгээ нэр, насны ангиллаар нь нээнэ. Бүлэг таны нэр дээр шууд бүртгэгдэнэ.",
        href: "/my-group",
        action: "Бүлэг үүсгэх",
        art: "group",
        short: "Бүлэг",
        done: hasGroup,
      }
    : {
        title: "Таны бүлэг",
        body: "Бүлгийг цэцэрлэгийн эрхлэгч үүсгэж, таныг багшаар нь хуваарилна. Бүлэг тань энд харагдахгүй байвал эрхлэгчдээ хандана уу.",
        href: "/children",
        action: "Суралцагч",
        art: "group",
        short: "Бүлэг",
        done: hasGroup,
      };

  const steps: SetupStep[] = [
    first,
    {
      title: "Хүүхэд бүртгэх",
      body: "«Суралцагч» хэсгийн «+ Хүүхэд»-ээр нэг нэгээр нь бүртгэнэ. Бүртгэхдээ бүлгээ сонгоно.",
      href: "/children",
      action: "Суралцагч",
      art: "child",
      short: "Хүүхэд",
      done: hasChildren,
    },
    {
      title: "Эцэг эх урих",
      body: solo
        ? "«Суралцагч» хэсгийн «Бүлгээр урих»-аар бүх эцэг эхийн урилгын картыг нэг дор хэвлэнэ. Эцэг эх утсаараа бүртгүүлж, хандалтын төлбөрөө төлсний дараа хүүхдийн бүртгэл танд нээгдэнэ."
        : "«Суралцагч» хэсгийн «Бүлгээр урих»-аар бүх эцэг эхийн урилгын картыг нэг дор хэвлэнэ, эсвэл хүүхдийн мөрний «⋯» › «Урих»-аар нэг гэр бүлийг урина. Эцэг эх картан дээрх холбоосоор утсаараа бүртгүүлнэ.",
      href: "/children",
      action: "Суралцагч",
      art: "navParentHome",
      short: "Эцэг эх",
      done: hasFamilies,
    },
  ];

  const storageKey =
    session?.user && primaryKindergartenId
      ? `nk.teacher-guide.${session.user.id}.${primaryKindergartenId}`
      : null;

  return (
    <SetupGuideDialog
      steps={steps}
      ready={ready}
      storageKey={storageKey}
      title="Эхлэх алхам"
      buttonLabel="Эхлэх заавар"
    />
  );
}
