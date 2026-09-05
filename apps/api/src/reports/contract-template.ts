import { baseCss, esc, formatDate, reportChrome } from "./template-utils";

/**
 * The onboarding contract as PDF — `docs/CONTRACT_ONBOARDING.md` step 4.
 *
 * ★★★ **Every figure here comes from the `Contract` row, never from a live
 * settings table.** The row froze them when the operator approved the
 * application, and that is what makes this document reproducible: re-rendering
 * a contract signed in March must produce the March prices, not today's. A
 * template that resolved a tariff at render time would quietly disagree with
 * the sealed paper in the kindergarten's own file — and the paper is the one
 * that binds.
 *
 * ★★ It carries **no child**, like the finance reports and unlike every other
 * template here. There is nothing about a child in an onboarding agreement, and
 * the corresponding `ReportJob` has a null `childId` — which is what keeps
 * every `canAccessChild`-gated download path from ever serving one.
 *
 * ★ Two signature blocks with room for a seal, because steps 6–7 are a wet
 * signature and a stamp on paper. This is deliberately not an e-signature flow:
 * that is RFP Phase IV (CLAUDE.md §7) and is not in scope. A printed page with
 * space to sign is the whole point.
 */
export interface ContractData {
  number: string;
  version: number;
  kindergartenName: string;
  registrationNumber: string;
  address: string;
  directorName: string;
  phone: string;
  email: string;
  childCount: number;
  /** Decimal strings. Never numbers — see `money` below. */
  annualFee: string;
  perChildMonthlyFee: string;
  startsOn: Date;
  endsOn: Date;
  generatedAt: Date;
}

/**
 * Money, formatted from the decimal **string**.
 *
 * ★ Never `Number(value)`. Same argument as `finance-report-template.ts`,
 * restated because that file's copy cannot be imported without dragging the
 * whole report shape with it — and because this is a legal document, which is
 * the least forgiving place in the product for a rounding error.
 */
function money(value: string): string {
  const [whole = "0", cents] = value.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${cents && cents !== "00" ? `${grouped}.${cents}` : grouped}₮`;
}

function row(label: string, value: string): string {
  return `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`;
}

export function renderContractHtml(data: ContractData): string {
  return `<!doctype html>
<html lang="mn">
<head><meta charset="utf-8"><style>
${baseCss()}
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
  <div class="contract-title">
    <h1>ГЭРЭЭ №${esc(data.number)}</h1>
    <p>Цэцэрлэгийн хөгжлийн цахим бүртгэлийн үйлчилгээ · PDF version: v${data.version}.0</p>
  </div>

  <table class="terms">
    ${row("Байгууллагын нэр", data.kindergartenName)}
    ${row("Регистрийн дугаар", data.registrationNumber)}
    ${row("Хаяг", data.address)}
    ${row("Эрхлэгчийн нэр", data.directorName)}
    ${row("Утас", data.phone)}
    ${row("И-мэйл", data.email)}
    ${row("Хүүхдийн тоо", String(data.childCount))}
    ${row("Хугацаа", `${formatDate(data.startsOn)} — ${formatDate(data.endsOn)}`)}
    ${row("Суурь хураамж (жилд)", money(data.annualFee))}
    ${row("Хүүхэд/сар", money(data.perChildMonthlyFee))}
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
      <p class="caption">Захиалагч — ${esc(data.directorName)}</p>
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

export function contractChrome(number: string, kindergartenName: string) {
  return reportChrome(kindergartenName, `Гэрээ №${number}`);
}
