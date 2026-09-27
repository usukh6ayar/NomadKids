"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Bell,
  BriefcaseBusiness,
  Building2,
  ChevronRight,
  Database,
  GraduationCap,
  IdCard,
  KeyRound,
  Link2,
  LogOut,
  Mail,
  MessageCircleQuestion,
  Pencil,
  Phone,
  Settings,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { z } from "zod";
import {
  esisMyProfileSchema,
  PASSWORD_RULES,
  ROLE_LABEL,
  userProfileSchema,
  validatePasswordStrength,
} from "@kinder/contracts";
import { get, mutate } from "@/lib/api/browser";
import { EsisDataPanel } from "@/components/esis/esis-data-panel";
import { EsisRowValues, esisSampleColumns } from "@/components/esis/esis-rows";
import { PageHeader } from "@/components/shell/app-shell";
import { qk } from "@/lib/api/keys";
import { errorMessage, fieldErrors } from "@/lib/api/errors";
import { useLogout, useSession } from "@/lib/auth/session";
import { buildEsisDemoProfile, type EsisDemoField } from "@/lib/esis/demo-profile";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input, PasswordInput } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { TabButton, Tabs } from "@/components/ui/tabs";
import { TONE_SURFACE } from "@/components/ui/tone";
import { useToast } from "@/components/ui/toast";
import { useMyGroup } from "@/components/dashboard/use-my-group";
import { fullName, groupLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ErrorState, FormError, LoadingState } from "@/components/ui/states";
import { ChildAvatar } from "@/components/media/media-image";
import { PhotoBadgeButton } from "@/components/media/photo-badge-button";
import { MyStaffRecords } from "@/components/staff/my-staff-records";

const profileSchema = userProfileSchema.extend({
  specialization: z.string().nullish(),
  education: z.string().nullish(),
});

/**
 * Own profile and password.
 *
 * The profile record is read-only; photo, password and sign-out remain the
 * signed-in person's account controls.
 */
export default function SettingsPage() {
  const { hasRole } = useSession();
  const [tab, setTab] = useState<SettingsTab>("professional");
  const isStaffWithEsis = hasRole("TEACHER") || hasRole("ADMIN");

  return (
    /*
      ★ Redesigned 2026-09-27, to the client's drawing: a profile card with
      the person's contacts under it, the rest behind four tabs, and three
      cards down the right — security, notifications, help. It replaces one
      long column where a teacher scrolled past two ESIS tables to find the
      password form.

      ★★ Profile editing is back. The client took it away on 2026-09-08
      («профайлыг засдаг байх хэрэггүй») and the drawing puts «Мэдээлэл
      засах» back on the card; the drawing is the newer instruction.
    */
    <div className="flex w-full flex-col gap-6 lg:gap-8">
      <div className="relative">
        <PageHeader
          title="Хувийн тохиргоо"
          lede="Хувийн мэдээлэл, аюулгүй байдал, мэдэгдэл болон бусад тохиргоогоо эндээс удирдаарай."
        />
        <Image
          src="/illustrations/audience-teacher.png"
          alt=""
          width={180}
          height={180}
          className="pointer-events-none absolute -top-6 right-0 hidden size-[150px] object-contain xl:block"
        />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          <ProfileCard />

          <Card className="flex flex-col gap-5 p-0">
            <div className="overflow-x-auto px-4 sm:px-5">
              <Tabs label="Тохиргооны хэсгүүд">
                {SETTINGS_TABS.filter((t) => isStaffWithEsis || !t.staffOnly).map((t) => (
                  <TabButton key={t.key} active={tab === t.key} onClick={() => setTab(t.key)}>
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                      <t.icon size={18} aria-hidden="true" />
                      {t.label}
                    </span>
                  </TabButton>
                ))}
              </Tabs>
            </div>
            <div className="px-4 pb-5 sm:px-5">
              {tab === "professional" ? <MyStaffRecords /> : null}
              {tab === "work" ? <EsisProfileSection /> : null}
              {tab === "systems" ? (
                <div className="flex flex-col gap-6">
                  <EsisDataPanel
                    resource="teacherAcademicOrg"
                    title="Заах аргын нэгдэл"
                    description="ЭСИС-д бүртгэлтэй заах аргын нэгдэл, албан тушаал"
                  />
                  <EsisDataPanel
                    resource="teachers"
                    title="Багшийн жагсаалт"
                    description="ESIS-д бүртгэлтэй багш нарын томилгоо"
                  />
                </div>
              ) : null}
              {tab === "other" ? <SignOutCard /> : null}
            </div>
          </Card>
        </div>

        <aside aria-label="Тохиргооны товчлол" className="flex flex-col gap-4">
          <SideCard
            tone="cornflower"
            icon={<ShieldCheck size={22} aria-hidden="true" />}
            title="Аюулгүй байдал"
            text="Бүртгэлийн аюулгүй байдлаа хамгаалан, нууц үгээ шинэчлээрэй."
          >
            <PasswordFromProfile />
          </SideCard>
          <SideCard
            tone="mint"
            icon={<Bell size={22} aria-hidden="true" />}
            title="Мэдэгдэл"
            text="Цэцэрлэгийн мэдээ, мэдэгдлээ нэг дор харна."
          >
            <SideLink href="/notifications">Мэдэгдэл харах</SideLink>
          </SideCard>
          <SideCard
            tone="peach"
            icon={<MessageCircleQuestion size={22} aria-hidden="true" />}
            title="Тусламж хэрэгтэй юу?"
            text="Асуудал гарвал цэцэрлэгийн удирдлага эсвэл системийн оператортой холбогдоно уу."
          >
            {hasRole("COOK") || hasRole("ACCOUNTANT") ? null : (
              <SideLink href="/chat">Холбоо барих</SideLink>
            )}
          </SideCard>
        </aside>
      </div>
    </div>
  );
}

type SettingsTab = "professional" | "work" | "systems" | "other";

const SETTINGS_TABS: {
  key: SettingsTab;
  label: string;
  icon: typeof GraduationCap;
  staffOnly?: boolean;
}[] = [
  { key: "professional", label: "Мэргэжлийн мэдээлэл", icon: GraduationCap },
  { key: "work", label: "Ажлын мэдээлэл", icon: BriefcaseBusiness },
  { key: "systems", label: "Холбоотой систем", icon: Link2, staffOnly: true },
  { key: "other", label: "Бусад тохиргоо", icon: Settings },
];

/** A right-column card: a tinted panel, an icon chip, a line, and one action. */
function SideCard({
  tone,
  icon,
  title,
  text,
  children,
}: {
  tone: "cornflower" | "mint" | "peach";
  icon: ReactNode;
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <Card pad="roomy" tone={tone} className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "grid size-11 shrink-0 place-items-center rounded-pill",
            TONE_SURFACE[tone],
          )}
        >
          {icon}
        </span>
        <div className="min-w-0">
          <h2 className="text-lead font-semibold text-ink">{title}</h2>
          <p className="mt-0.5 text-body text-ink/80">{text}</p>
        </div>
      </div>
      {children}
    </Card>
  );
}

function SideLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="flex min-h-11 items-center justify-between rounded-pill border border-border bg-surface px-4 text-body font-medium text-ink transition-colors hover:border-primary/40 hover:text-primary"
    >
      {children}
      <ChevronRight size={18} aria-hidden="true" />
    </Link>
  );
}

/** The password form, fed the account's own identifier. */
function PasswordFromProfile() {
  const { data } = useQuery({
    queryKey: qk.profile(),
    queryFn: () => get("/me/profile", profileSchema),
  });
  return (
    <div className="rounded-card bg-surface p-3">
      <PasswordSection identifier={data?.email || data?.username || ""} email={data?.email} />
    </div>
  );
}

/**
 * The signed-in person's employment record, on their own settings screen.
 *
 * ★ No "ESIS мэдээлэл" heading and no `Demo ESIS` badge — 2026-09-08, at the
 * client's instruction, the same one that took them off the director's screens:
 * the record is to read as this screen's own, not as a labelled import. Where
 * the values come from is recorded here and on `/platform/[id]/esis`,
 * which keeps its badges because it exists to answer exactly that question.
 *
 * ★★ It has always been built from the signed-in account — see
 * `buildEsisDemoProfile`. The name, the e-mail and the position are the
 * person's own; only the ESIS identifiers are illustrative, and no civil id,
 * register number or credential is ever represented.
 */
function EsisProfileSection() {
  const { roles, primaryKindergartenId } = useSession();
  const { data, isLoading, isError } = useQuery({
    queryKey: qk.profile(),
    queryFn: () => get("/me/profile", profileSchema),
  });
  const esisQuery = useQuery({
    queryKey: ["esis", "my-profile", primaryKindergartenId],
    queryFn: () =>
      get(`/kindergartens/${primaryKindergartenId}/esis/my-profile`, esisMyProfileSchema),
    enabled: Boolean(primaryKindergartenId),
    retry: false,
  });

  if (isLoading || esisQuery.isLoading || isError || !data) return null;
  if (esisQuery.isError) {
    return (
      <section aria-label="Ажлын мэдээлэл">
        <Card pad="compact" tone="sun">
          <p className="font-medium text-ink">Ажлын мэдээлэл түр татагдсангүй.</p>
          <p className="mt-1 text-body text-muted">{errorMessage(esisQuery.error)}</p>
        </Card>
      </section>
    );
  }

  const esis = buildEsisDemoProfile(data, roles);
  const live = esisQuery.data?.mode === "LIVE" ? esisQuery.data : null;
  if (!esis && !live) return null;

  if (live) {
    return (
      <section aria-label="Ажлын мэдээлэл">
        <Card pad="roomy" className="flex flex-col gap-5">
          <div className="flex flex-wrap items-start gap-3 border-b border-border-soft pb-5">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-control bg-primary-soft text-primary">
              <BriefcaseBusiness size={21} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lead font-semibold text-ink">
                {live.resource === "teachers" ? "Багшийн бүртгэл" : "Ажилтны бүртгэл"}
              </h2>
              <p className="mt-0.5 text-caption text-muted">ESIS-ээс ирсэн ажлын мэдээлэл</p>
              <p className="mt-2 text-caption text-muted">
                Сүүлд татсан: {new Date(live.syncedAt).toLocaleString("mn-MN")}
              </p>
            </div>
          </div>
          <EsisRowValues columns={esisSampleColumns(live.fields)} rows={[live.row]} />
        </Card>
      </section>
    );
  }

  if (!esis) return null;

  return (
    <section aria-labelledby="esis-profile-heading">
      <SectionHeader id="esis-profile-heading" title="ESIS мэдээлэл" />

      <Card pad="roomy" className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start gap-3 border-b border-border-soft pb-5">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-control bg-sky text-sky-ink">
            <Database size={21} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold text-ink">{esis.resourceLabel}</h2>
              <Badge tone="sun">Жинхэнэ ESIS синк биш</Badge>
            </div>
            <p className="mt-0.5 text-body text-muted">
              Эх сурвалж: ESIS schema-тай mock fixture · {esis.resource}
            </p>
          </div>
          <p className="shrink-0 text-caption text-muted">Шинэчилсэн: {esis.syncedAt}</p>
        </div>

        <EsisFieldGroup
          icon={Building2}
          title="Байгууллага ба үндсэн мэдээлэл"
          fields={[
            { label: "Байгууллагын нэр", value: esis.institutionName },
            { label: "Байгууллагын код", value: esis.institutionId },
            ...esis.summary,
          ]}
        />
        <EsisFieldGroup icon={BriefcaseBusiness} title="Томилгоо" fields={esis.employment} />
        <EsisFieldGroup icon={Mail} title="Холбоо барих мэдээлэл" fields={esis.contact} />

        <p className="border-t border-border-soft pt-4 text-caption text-muted">
          Татахгүй талбар: регистр, иргэний бүртгэлийн дугаар, нэвтрэх мэдээлэл.
        </p>
      </Card>
    </section>
  );
}

function EsisFieldGroup({
  icon: Icon,
  title,
  fields,
}: {
  icon: typeof Building2;
  title: string;
  fields: EsisDemoField[];
}) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-body font-semibold text-ink">
        <Icon size={17} className="text-primary" aria-hidden="true" />
        <h3>{title}</h3>
      </div>
      <dl className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
        {fields.map((field) => (
          <ReadField key={field.label} label={field.label} value={field.value} />
        ))}
      </dl>
    </div>
  );
}

/**
 * Who is signed in, and their picture.
 *
 * ★ No editing — 2026-09-08, at the client's instruction: "цаанаасаа шууд
 * оруулж мэдээлэл авах болохоор edit гэсэн хэсэгт байгаа edit-үүдийг арилга".
 *
 * The form this card used to open — овог, нэр, и-мэйл, утас, мэргэжил,
 * боловсрол, танилцуулга — is gone, and `PATCH /me/profile` has no caller left
 * in this product. What the panel below shows is what ESIS holds about this
 * person, and the client's position is that it is not a thing to hand-correct
 * here.
 *
 * ★★ Two profile controls live together here, and each is deliberate:
 *
 *   The **picture**, because ESIS supplies none. Removing its badge would mean
 *   nobody could ever set a profile photo again, which is not information
 *   arriving from anywhere — it saves on selection, against its own endpoint.
 *
 *   The **password**, which was the last section of that form (see
 *   `PasswordSection`'s own note for the two arrangements the client rejected
 *   before it landed there). Changing a password is not correcting a record;
 *   losing it with the form would have left an account with no way to rotate
 *   its own credentials. It sits on the page now, folded shut, which is the
 *   shape it already had inside the form.
 *
 * ★★★ **Sign-out is not one of them any more** — 2026-09-10, at the client's
 * request that it sit at the very foot of this screen. It was moved *into*
 * this card in the shell redesign, on the argument that routing every role
 * here made it "intentional and immediately reachable"; that argument holds
 * for the screen and not for the card, and inside the card it sat above the
 * ESIS panels, which put a destructive action in the middle of a page of
 * read-only records. `SignOutCard` is the last thing on the page instead.
 */
function ProfileCard() {
  const { session } = useSession();
  const { group } = useMyGroup();
  const [editing, setEditing] = useState(false);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: qk.profile(),
    queryFn: () => get("/me/profile", profileSchema),
  });

  if (isLoading) return <LoadingState rows={2} shape="text" />;
  if (isError) return <ErrorState description={errorMessage(error)} />;

  const role = session?.memberships?.[0]?.role;
  const roleLabel = role ? ROLE_LABEL[role] : "Эцэг эх";

  return (
    <section aria-label="Хувийн мэдээлэл">
      <Card pad="roomy" className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start gap-4 sm:gap-5">
          {/*
            ★ The picture is the control — 2026-09-06, the client: "камерын
            зурагтай тэнд нь дардаг болгоё".
          */}
          <span className="relative shrink-0">
            <ChildAvatar child={data ?? {}} size={96} />
            <PhotoBadgeButton
              endpoint={`/users/${data?.id}/photo`}
              label="Профайл зураг солих"
              invalidateKeys={[qk.profile(), qk.session()]}
            />
          </span>

          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <p className="truncate text-title font-semibold text-ink">{fullName(data)}</p>
            <p className="truncate text-body text-muted">{data?.email || "И-мэйл оруулаагүй"}</p>
            <div className="flex flex-wrap gap-2">
              {group ? (
                <Badge tone="primary">
                  <UsersRound size={14} aria-hidden="true" /> {groupLabel(group.name)}
                </Badge>
              ) : null}
              <Badge tone="neutral">
                <IdCard size={14} aria-hidden="true" /> {roleLabel}
              </Badge>
            </div>
          </div>

          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            <Pencil size={16} aria-hidden="true" />
            Мэдээлэл засах
          </Button>
        </div>

        <dl className="grid gap-4 border-t border-border-soft pt-5 sm:grid-cols-3">
          <ContactItem
            icon={<Phone size={18} aria-hidden="true" />}
            label="Утас"
            value={data?.phone}
          />
          <ContactItem
            icon={<Mail size={18} aria-hidden="true" />}
            label="И-мэйл"
            value={data?.email}
          />
          <ContactItem
            icon={<BriefcaseBusiness size={18} aria-hidden="true" />}
            label="Албан тушаал"
            value={roleLabel}
          />
        </dl>
      </Card>

      {data ? <EditProfileDialog open={editing} onOpenChange={setEditing} profile={data} /> : null}
    </section>
  );
}

function ContactItem({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value?: string | null;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        aria-hidden="true"
        className="grid size-10 shrink-0 place-items-center rounded-pill bg-primary-soft text-primary"
      >
        {icon}
      </span>
      <div className="min-w-0">
        <dt className="text-caption text-muted">{label}</dt>
        <dd className="truncate text-body font-medium text-ink">{value?.trim() || "—"}</dd>
      </div>
    </div>
  );
}

/**
 * «Мэдээлэл засах» — the fields `PATCH /me/profile` accepts that a person
 * owns: their name, phone and e-mail. Toast on save (§5); the server's field
 * errors land under the field they are about.
 */
function EditProfileDialog({
  open,
  onOpenChange,
  profile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: z.infer<typeof profileSchema>;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    lastName: profile.lastName ?? "",
    firstName: profile.firstName ?? "",
    phone: profile.phone ?? "",
    email: profile.email ?? "",
  });

  const save = useMutation({
    mutationFn: () =>
      mutate("/me/profile", z.unknown(), {
        method: "PATCH",
        body: {
          lastName: form.lastName.trim(),
          firstName: form.firstName.trim(),
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success("Мэдээлэл хадгалагдлаа.");
      void queryClient.invalidateQueries({ queryKey: qk.profile() });
      void queryClient.invalidateQueries({ queryKey: qk.session() });
      onOpenChange(false);
    },
  });
  const errors = save.isError ? fieldErrors(save.error) : {};
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Мэдээлэл засах"
      busy={save.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Болих
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Хадгалж байна…" : "Хадгалах"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Овог" error={errors.lastName} required>
          {({ id }) => <Input id={id} value={form.lastName} onChange={set("lastName")} />}
        </Field>
        <Field label="Нэр" error={errors.firstName} required>
          {({ id }) => <Input id={id} value={form.firstName} onChange={set("firstName")} />}
        </Field>
        <Field label="Утас" error={errors.phone}>
          {({ id }) => (
            <Input id={id} inputMode="numeric" value={form.phone} onChange={set("phone")} />
          )}
        </Field>
        <Field label="И-мэйл" error={errors.email}>
          {({ id }) => <Input id={id} type="email" value={form.email} onChange={set("email")} />}
        </Field>
      </div>
      <FormError
        message={save.isError && Object.keys(errors).length === 0 ? errorMessage(save.error) : null}
      />
    </FormDialog>
  );
}

/**
 * The way out of the system — the last thing on this screen, for every role.
 *
 * ★ It is the *only* way out, which is what makes its position worth a note.
 *
 * The shell carries no sign-out control of its own: the sidebar's foot is an
 * identity row that links here (`WhoAmI`), the phone's header holds one bell,
 * and every role's menu names this screen "Тохиргоо". So this card is the end
 * of the only path there is, and it sits at the end of the page — below the
 * account, the password and the ESIS panels — because a sign-out button in the
 * middle of a page of read-only records is one a reader presses by accident on
 * the way to something else.
 */
function SignOutCard() {
  const logout = useLogout();

  return (
    <Card pad="roomy" className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="font-medium text-ink">Системээс гарах</p>
        <p className="text-body text-muted">Энэ төхөөрөмжөөс гарч, нэвтрэх хуудас руу буцна.</p>
      </div>
      {/*
        ★ Red since 2026-09-11 — the client asked for it in the menu, and this
        is the same action. Painting one of them as a neutral secondary and the
        other as a warning would be two answers to "is this dangerous?".
      */}
      <Button variant="danger" onClick={() => void logout()}>
        <LogOut aria-hidden="true" />
        Системээс гарах
      </Button>
    </Card>
  );
}

/** One label-and-value pair of the read view. */
function ReadField({
  label,
  value,
  className,
}: {
  label: string;
  value?: string | null;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-caption text-muted">{label}</dt>
      {/* An em dash, not an empty node: a blank line under a label reads as a
          rendering fault rather than as "nothing recorded". */}
      <dd className="mt-0.5 whitespace-pre-wrap text-body text-ink">{value?.trim() || "—"}</dd>
    </div>
  );
}

/**
 * Changing your own password — `POST /auth/password`.
 *
 * ★ The last section of the profile's edit form, folded shut. See the note at
 * its call site for the two attempts this replaces.
 *
 * ★★ The fields exist only while the section is open.
 *
 * Not `hidden`, not disabled — unmounted. A "current password" input sitting
 * in the DOM of a page somebody left open is a credential a password manager
 * will offer to fill and a shoulder will read; there is no reason for it to be
 * there before somebody has said they are changing their password, and closing
 * the section clears whatever was typed.
 *
 * ★★★ The success line stays until the section is closed, deliberately. It
 * says every other device has been signed out, which is a consequence somebody
 * needs to read *after* the change rather than a toast that slides away.
 */
function PasswordSection({
  identifier,
  email,
}: {
  /** What `POST /auth/password-reset` is asked about — this account. */
  identifier: string;
  /** Where the link would land, or nothing. */
  email?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const change = useMutation({
    mutationFn: () =>
      mutate("/auth/password", z.unknown(), {
        method: "POST",
        body: { currentPassword, newPassword },
      }),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
    },
  });

  /**
   * "Мартсан уу?" — the same reset `/forgot-password` requests, from here.
   *
   * ★ 2026-09-08, at the client's request: "одоогийн нууц үгээ мэдэхгүй ч
   * байж болишд". `POST /auth/password` needs the current password, so
   * somebody who has forgotten it could change nothing from this screen and
   * had to sign out to reach the recovery they were already signed in beside.
   *
   * ★★ It sends this account's own identifier rather than asking for one.
   * `/forgot-password` asks because it serves a stranger and must not confirm
   * whether an identifier exists; here the caller is authenticated and it is
   * their own account, so the neutral wording that page needs would be
   * evasive rather than careful. It says what happened.
   */
  const forgot = useMutation({
    mutationFn: () =>
      mutate("/auth/password-reset", z.unknown(), {
        method: "POST",
        body: { identifier },
      }),
  });

  const errors = fieldErrors(change.error);

  function close() {
    setOpen(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirm("");
    setLocalError(null);
    change.reset();
    forgot.reset();
  }

  return (
    <div className="mt-5 border-t border-border-soft pt-5">
      {/*
        The row that is always there: what this section is, and one control.
        Under a rule, so it reads as a second subject rather than a seventh
        field of the profile above it.
      */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-body font-medium text-ink">Нэвтрэх нууц үг</p>
          <p className="text-caption text-muted">
            Солисны дараа бусад төхөөрөмжөөс автоматаар гарна.
          </p>
        </div>

        {open ? (
          <Button type="button" variant="ghost" size="sm" onClick={close}>
            Болих
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-expanded={false}
            onClick={() => setOpen(true)}
          >
            <KeyRound size={16} aria-hidden="true" />
            Нууц үг солих
          </Button>
        )}
      </div>

      {open ? (
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (change.isPending) return;

            // Same rules the API runs, from the same module — see
            // `@kinder/contracts/password`.
            const weaknesses = validatePasswordStrength(newPassword);
            if (weaknesses.length > 0) {
              setLocalError(`${weaknesses.join(". ")}.`);
              return;
            }
            if (newPassword !== confirm) {
              setLocalError("Хоёр нууц үг таарахгүй байна.");
              return;
            }

            setLocalError(null);
            change.mutate();
          }}
          noValidate
        >
          <FormError message={localError ?? (change.isError ? errorMessage(change.error) : null)} />

          {change.isSuccess ? (
            <p
              role="status"
              className="rounded-control bg-mint px-3.5 py-2.5 text-body text-mint-ink"
            >
              Нууц үг солигдлоо. Бусад төхөөрөмжөөс гарсан байна.
            </p>
          ) : null}

          {/*
            ★ The rules, before anything is typed — 2026-09-04.

            This form has always *checked* `validatePasswordStrength` and never
            *shown* what it checks, so the only way to learn the rules was to
            fail them: type a password, submit, read a red line naming what was
            wrong, try again. The client's report was exactly that — "алдаа
            байнга гараад байна".

            `/invitation/:token` and `/reset-password/:token` already listed
            them (`password-policy.test.tsx` pins both). This screen is the
            third place a password is set and was the one that did not — which
            is why it is where the errors came from.

            Same `PASSWORD_RULES` the server enforces, so the list cannot drift
            from the check.
          */}
          <ul className="list-disc space-y-1 pl-5 text-body text-muted">
            {PASSWORD_RULES.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>

          <Field label="Одоогийн нууц үг" error={errors.currentPassword} required>
            {({ id, describedBy, invalid }) => (
              <PasswordInput
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            )}
          </Field>

          {/*
            Under the field it rescues, because that is where somebody
            discovers they cannot fill it in.
          */}
          {forgot.isSuccess ? (
            <p role="status" className="text-body text-mint-ink">
              Сэргээх холбоосыг {email} хаяг руу илгээлээ. И-мэйлээ шалгана уу.
            </p>
          ) : email ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2 self-start"
              disabled={forgot.isPending}
              onClick={() => forgot.mutate()}
            >
              {forgot.isPending ? "Илгээж байна…" : "Одоогийн нууц үгээ мартсан уу?"}
            </Button>
          ) : (
            /*
              No e-mail, so no link can be sent. Saying so is the honest answer
              and it is not an enumeration leak: this is the signed-in person's
              own account, and they can act on it.
            */
            <p className="text-caption text-muted">
              Нууц үгээ мартсан бол эрхлэгчид хандана уу — бүртгэлд и-мэйл бүртгээгүй тул сэргээх
              холбоос илгээх боломжгүй.
            </p>
          )}
          {forgot.isError ? (
            <p role="alert" className="text-body text-danger">
              {errorMessage(forgot.error)}
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Шинэ нууц үг" error={errors.newPassword} required>
              {({ id, describedBy, invalid }) => (
                <PasswordInput
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              )}
            </Field>

            <Field label="Шинэ нууц үг давтах" required>
              {({ id, describedBy }) => (
                <PasswordInput
                  id={id}
                  aria-describedby={describedBy}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              )}
            </Field>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={change.isPending}>
              {change.isPending ? "Солиж байна…" : "Нууц үг шинэчлэх"}
            </Button>
            {/*
              "Хаах" once it has worked, "Болих" before: the same control, and
              the word says which of the two it is. The success line above stays
              on screen until this is pressed — see the docblock.
            */}
            <Button type="button" variant="ghost" onClick={close} disabled={change.isPending}>
              {change.isSuccess ? "Хаах" : "Болих"}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
