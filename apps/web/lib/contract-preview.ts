import { formatDate } from "@/lib/format";

/**
 * The contract, drawn before it exists — «Гэрээ харах» on the approval dialog
 * (the user, 2026-10-14: what is approved cannot be changed, so it is read and
 * printed first).
 *
 * ★ A copy of the PDF's layout, `apps/api/src/reports/contract-template.ts`:
 * the same rows, clauses and signature block, so the draft reads as the
 * contract will. The number is given on approval, so the draft says «ТӨСӨЛ».
 * If that template changes, change this with it.
 */
export interface ContractDraft {
  kindergartenName: string;
  registrationNumber: string;
  address: string | null;
  directorName: string;
  phone: string;
  email: string;
  startsOn: string;
  endsOn: string;
  groupCount: number;
  billingPeriod: "term" | "year";
  perGroupMonthlyFee: string;
  periodFee: string;
}

const PERIOD_LABEL = { term: "Улирал", year: "Хичээлийн жил" } as const;

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** «1 400 000₮», from the decimal string — as the PDF does it. */
function money(value: string): string {
  const [whole = "0", cents] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${cents && cents !== "00" ? `${grouped}.${cents}` : grouped}₮`;
}

function row(label: string, value: string): string {
  return `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`;
}

export function renderContractDraftHtml(draft: ContractDraft): string {
  return `<!doctype html>
<html lang="mn">
<head><meta charset="utf-8"><title>Гэрээний төсөл — ${esc(draft.kindergartenName)}</title><style>
@page { size: A4; margin: 18mm 16mm; }
body { font-family: "Noto Sans", Arial, sans-serif; color: #0f172a; margin: 0; padding: 8mm; position: relative; }
.draft { position: fixed; top: 40%; left: 0; right: 0; text-align: center; font-size: 72pt; font-weight: 800; color: rgba(148, 163, 184, 0.18); transform: rotate(-18deg); pointer-events: none; }
.contract-title { text-align: center; margin-bottom: 4mm; }
.contract-title h1 { font-size: 16pt; margin: 0 0 2mm; }
.contract-title p { margin: 0; color: #64748b; font-size: 10pt; }
table.terms { width: 100%; border-collapse: collapse; margin: 6mm 0; }
table.terms th, table.terms td { border: 1px solid #cbd5e1; padding: 2.5mm 3mm; font-size: 10pt; text-align: left; vertical-align: top; }
table.terms th { width: 42%; background: #f8fafc; font-weight: 600; }
h2.clause { font-size: 11pt; margin: 6mm 0 2mm; }
ol.clauses { margin: 0; padding-left: 6mm; font-size: 10pt; line-height: 1.6; }
.signatures { display: flex; gap: 10mm; margin-top: 14mm; }
.signature { flex: 1; }
.signature .line { border-bottom: 1px solid #334155; height: 14mm; }
.signature .caption { font-size: 9pt; color: #475569; margin-top: 1.5mm; }
.seal { margin-top: 6mm; border: 1px dashed #94a3b8; height: 22mm; display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 9pt; }
</style></head>
<body>
  <div class="draft" aria-hidden="true">ТӨСӨЛ</div>
  <div class="contract-title">
    <h1>ГЭРЭЭ № (батлахад олгоно)</h1>
    <p>Цэцэрлэгийн хөгжлийн цахим бүртгэлийн үйлчилгээ · Төсөл</p>
  </div>

  <table class="terms">
    ${row("Байгууллагын нэр", draft.kindergartenName)}
    ${row("Регистрийн дугаар", draft.registrationNumber)}
    ${draft.address ? row("Хаяг", draft.address) : ""}
    ${row("Эрхлэгчийн нэр", draft.directorName)}
    ${row("Утас", draft.phone)}
    ${row("И-мэйл", draft.email)}
    ${row("Хугацаа", `${formatDate(draft.startsOn)} — ${formatDate(draft.endsOn)}`)}
    ${row("Бүлгийн тоо", String(draft.groupCount))}
    ${row("Төлбөрийн хугацаа", PERIOD_LABEL[draft.billingPeriod])}
    ${row("Бүлэг/сар", money(draft.perGroupMonthlyFee))}
    ${row("Нийт төлбөр", money(draft.periodFee))}
  </table>

  <h2 class="clause">Гэрээний нөхцөл</h2>
  <ol class="clauses">
    <li>Гүйцэтгэгч нь захиалагчид цэцэрлэгийн хүүхдийн хөгжлийн цахим бүртгэлийн системийг гэрээний хугацаанд ашиглуулна.</li>
    <li>Захиалагч нь дээрх хураамжийг гэрээнд заасан хугацаанд төлнө.</li>
    <li>Хүүхдийн хувийн мэдээллийг Хүний хувийн мэдээлэл хамгаалах тухай хуулийн дагуу хамгаална.</li>
    <li>Гэрээ дуусгавар болоход захиалагчийн өгөгдлийг гүйцэтгэгч устгах үүрэгтэй.</li>
    <li>Дээрх дүнгүүд нь гэрээ байгуулах өдрийн байдлаар тогтоогдсон бөгөөд гэрээний хугацаанд өөрчлөгдөхгүй.</li>
  </ol>

  <div class="signatures">
    <div class="signature">
      <div class="line"></div>
      <p class="caption">Захиалагч — ${esc(draft.directorName)}</p>
      <div class="seal">Тамга</div>
    </div>
    <div class="signature">
      <div class="line"></div>
      <p class="caption">Гүйцэтгэгч</p>
      <div class="seal">Тамга</div>
    </div>
  </div>
</body>
</html>`;
}
