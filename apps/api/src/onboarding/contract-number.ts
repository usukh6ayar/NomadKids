/**
 * Contract numbering — `NK-2026-000123`, the format on the operator's own
 * onboarding diagram.
 *
 * ★ A pure function beside its prefix, exactly as `invoice-math.ts` keeps
 * `nextInvoiceNumber` beside `invoiceNumberPrefix`. Splitting the two is how a
 * search prefix and the format it is meant to match drift apart, and the first
 * symptom is a numbering sequence that silently restarts at 1.
 *
 * ★★ Zero-padded to six digits so numbers sort lexically in the same order they
 * were issued. The repository's `orderBy: { number: "desc" }` depends on it:
 * without the padding, `NK-2026-9` sorts after `NK-2026-10` and the next
 * contract reuses a number.
 */
export function contractNumberPrefix(year: number): string {
  return `NK-${year}-`;
}

export function nextContractNumber(year: number, lastNumber: string | null): string {
  const prefix = contractNumberPrefix(year);
  const previous = lastNumber?.startsWith(prefix)
    ? Number.parseInt(lastNumber.slice(prefix.length), 10)
    : 0;
  const next = Number.isFinite(previous) ? previous + 1 : 1;

  return `${prefix}${String(next).padStart(6, "0")}`;
}
