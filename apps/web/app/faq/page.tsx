import type { Metadata } from "next";
import Link from "next/link";
import { PublicInfoShell, PublicNotice } from "@/components/public/public-info-shell";
import { BRAND } from "@/lib/vocabulary";

/**
 * ★ `canonical` is set, and the reason it has to be is that it is inherited.
 *
 * The root layout declares `alternates: { canonical: "/" }` for itself, and
 * Next passes that down to every page that does not override it — so this page
 * shipped telling Google it was a duplicate of the home page while
 * `sitemap.ts` listed it as a URL of its own. That contradiction resolves in
 * the crawler's favour: the canonical wins and the page is dropped.
 *
 * `/login` canonicalises to `/` deliberately and says so — it renders the same
 * `PublicLanding`. This page does not.
 *
 * ★★ The title carries no brand. The root's `template` appends
 * `| ${BRAND} · ${BRAND_LATIN}` to whatever a page sets, so `| ${BRAND}` here
 * printed the Cyrillic name twice inside the ~60 characters Google shows.
 */
export const metadata: Metadata = {
  title: "Түгээмэл асуулт",
  description: `${BRAND} системийн бүртгэл, нэвтрэлт, мэдээллийн хамгаалалт, ESIS болон хэрэглээний түгээмэл асуултууд.`,
  alternates: { canonical: "/faq" },
};

const FAQ_GROUPS = [
  {
    title: "Эхлэх ба нэвтрэх",
    items: [
      {
        question: "Системийг хэн ашиглах боломжтой вэ?",
        answer:
          "Гэрээт цэцэрлэгийн захирал, багш, нягтлан, гал тогоо болон бусад эрх бүхий ажилтан, мөн тухайн байгууллагаас урьсан эцэг эх, асран хамгаалагч ашиглана. Хэрэглэгч бүр зөвхөн өөрт олгосон эрхийн хүрээнд мэдээлэл харна.",
      },
      {
        question: "Байгууллага яаж бүртгүүлэх вэ?",
        answer:
          "Нэвтрэх хуудасны “Байгууллагын бүртгэл” холбоосоор хүсэлт илгээнэ. Хүсэлтийг шалгаж, гэрээ баталгаажсаны дараа байгууллагын администраторын урилга үүснэ.",
      },
      {
        question: "Нууц үгээ мартсан бол яах вэ?",
        answer:
          "“Нууц үгээ мартсан?” холбоосоор бүртгэлтэй и-мэйл хаягтаа нэг удаагийн сэргээх холбоос авна. И-мэйлгүй эсхүл хаягтаа хандах боломжгүй бол байгууллагын администраторт хандана.",
      },
      {
        question: "Нэг хүн хэд хэдэн эрхтэй байж болох уу?",
        answer:
          "Болно. Нэг хэрэглэгч багш болон администратор зэрэг хэд хэдэн үүрэгтэй байж болох бөгөөд систем тухайн байгууллага дахь идэвхтэй эрхээр нь боломжуудыг харуулна.",
      },
    ],
  },
  {
    title: "Хүүхэд ба гэр бүлийн мэдээлэл",
    items: [
      {
        question: "Эцэг эх бусад хүүхдийн мэдээллийг харж чадах уу?",
        answer:
          "Үгүй. Эцэг эх зөвхөн өөртэй нь баталгаажуулан холбосон хүүхдийн зөвшөөрөгдсөн мэдээллийг харна. Багш мөн өөрийн хариуцсан бүлэг, хүүхдийн хүрээнд ажиллана.",
      },
      {
        question: "Хүүхдийн зураг, эрүүл мэндийн мэдээлэл хамгаалагдсан уу?",
        answer:
          "Эдгээрийг эмзэг, хязгаарлагдмал мэдээлэл гэж үзэж, зөвхөн шаардлагатай үүрэгтэй хэрэглэгчид үзүүлнэ. Файл богино наст хамгаалалттай холбоосоор нээгдэж, чухал үйлдэл аудитын мөртэй байна.",
      },
      {
        question: "Мэдээлэл буруу байвал хэн засах вэ?",
        answer:
          "Өдөр тутмын бүртгэлийг эрх бүхий багш эсхүл ажилтан засна. Хүүхдийн үндсэн мэдээлэл, гэр бүлийн холбоос, эрхийн алдааг байгууллагын администратор шалгаж засна. ESIS-ээс ирсэн зөрүүг эх сурвалжтай нь тулгана.",
      },
      {
        question: "Өөрийн мэдээллийн хуулбарыг авч болох уу?",
        answer:
          "Болно. Тайлан, экспортын боломжтой мэдээллийг системээс татаж авна. Нэмэлт хуулбар, засвар, устгалын хүсэлтийг эхлээд тухайн цэцэрлэгийн удирдлагад гаргана.",
      },
    ],
  },
  {
    title: "ESIS ба өдөр тутмын ажиллагаа",
    items: [
      {
        question: "ESIS-тэй ямар мэдээлэл солилцох вэ?",
        answer:
          "Байгууллага, хичээлийн жил, бүлэг, суралцагч, ажилтан, ирц, хоолны лавлах зэрэг зөвшөөрөгдсөн endpoint-ийг ашиглана. Сервис бүрийн оролт, гаралт болон ашиглах дэлгэц ESIS мэдээллийн төвд харагдана.",
      },
      {
        question: "Ирц ESIS рүү автоматаар явдаг уу?",
        answer:
          "Багш эхлээд ирцээ засаж хадгална. Бүх хүүхдийн бүртгэл бүрэн болсны дараа ESIS рүү илгээх утгыг шалгаад тусдаа “ESIS рүү илгээх” үйлдлээр баталгаажуулна.",
      },
      {
        question: "ESIS ажиллахгүй үед дотоод бүртгэл ашиглаж болох уу?",
        answer:
          "Болно. Дотоод бүртгэл тусдаа хадгалагдана. Интеграцийн алдаа, эрх, дахин оролдох төлөвийг оператор харж, холболт сэргэсний дараа илгээлтийг үргэлжлүүлнэ.",
      },
      {
        question: "Систем утас, таблет дээр ажиллах уу?",
        answer:
          "Тийм. Орчин үеийн гар утас, таблет, компьютерийн веб хөтөч дээр responsive байдлаар ажиллана. Нэмэлт апп суулгах шаардлагагүй.",
      },
    ],
  },
] as const;

export default function FaqPage() {
  return (
    <PublicInfoShell
      eyebrow="Тусламж"
      title="Түгээмэл асуулт"
      description="Бүртгэл, эрх, хүүхдийн мэдээлэл, ирц болон ESIS холболтын талаар хамгийн их асуудаг асуултын хариулт."
      updatedAt="2026 оны 9 дүгээр сарын 8"
    >
      <PublicNotice>
        Энд байхгүй асуудлыг <a href="mailto:Nomadkidsmn@gmail.com">Nomadkidsmn@gmail.com</a>{" "}
        хаягаар илгээнэ. Нууц үг, регистрийн дугаар, хүүхдийн эрүүл мэндийн мэдээллийг и-мэйлээр бүү
        явуулна уу.
      </PublicNotice>

      <div className="divide-y divide-[#e8eff6]">
        {FAQ_GROUPS.map((group) => (
          <section key={group.title} className="py-9 first:pt-8">
            <h2 className="text-heading font-extrabold text-[#102f5d]">{group.title}</h2>
            <div className="mt-6 grid gap-x-10 gap-y-7 md:grid-cols-2">
              {group.items.map((item) => (
                <article key={item.question}>
                  <h3 className="text-lead font-bold leading-6 text-[#173e70]">{item.question}</h3>
                  <p className="mt-2 text-body leading-7 text-slate-600">{item.answer}</p>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap gap-3 border-t border-[#e8eff6] pt-8 text-body font-semibold">
        <Link href="/privacy" className="text-[#2588ed] hover:underline">
          Нууцлалын бодлого
        </Link>
        <Link href="/terms" className="text-[#2588ed] hover:underline">
          Үйлчилгээний нөхцөл
        </Link>
      </div>
    </PublicInfoShell>
  );
}
