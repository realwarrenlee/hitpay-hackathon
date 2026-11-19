import { formatSgd, type Cents } from "@/domain/money";
import type { InvoiceId } from "@/domain/ids";
import type { SuggestionBody } from "@/domain/types";

export function tokenLabel(rawRef: string, invoiceId: InvoiceId): string {
  if (rawRef.toUpperCase().includes(String(invoiceId).toUpperCase())) return String(invoiceId);
  const digits = String(invoiceId).slice(4).replace(/^0+/, "") || "0";
  const bare = new RegExp(`(^|[^0-9])${digits}([^0-9]|$)`);
  if (bare.test(rawRef)) return digits;
  const padded = String(invoiceId).slice(4);
  if (rawRef.includes(padded)) return padded;
  return String(invoiceId);
}

export function explainSuggestion(input: {
  rawRef: string;
  amount: Cents;
  alias: string | null;
  customerName: string | null;
  invoiceLabel: string;
  invoiceRemaining: Cents;
  suggestion: SuggestionBody;
}): string {
  const suggestion = input.suggestion;
  if (suggestion.kind === "single" && suggestion.rule === "R3" && input.alias && input.customerName) {
    const token = tokenLabel(input.rawRef, suggestion.invoiceId);
    return `Ref "${token}" -> ${suggestion.invoiceId} (open, ${formatSgd(input.invoiceRemaining)}). Payer "${input.alias}" -> ${input.customerName} (confirmed alias). No other combination of ${input.customerName}'s open invoices sums to ${formatSgd(input.amount)}. Amount is ${formatSgd(suggestion.shortfall ?? (0 as Cents))} below the balance -> possible short payment.`;
  }
  if (suggestion.kind === "single" && suggestion.rule === "R1") {
    return `Ref "${tokenLabel(input.rawRef, suggestion.invoiceId)}" matches ${suggestion.invoiceId} for ${formatSgd(suggestion.amount)}. Exact amount, pre-ticked.`;
  }
  if (suggestion.kind === "single" && suggestion.rule === "R2") {
    const who = input.alias && input.customerName ? `Alias "${input.alias}" -> ${input.customerName}. ` : "";
    return `${who}Exactly one open invoice equals ${formatSgd(input.amount)}: ${suggestion.invoiceId}.`;
  }
  if (suggestion.kind === "single" && suggestion.rule === "R6") {
    return `${suggestion.invoiceId} is open for ${formatSgd(input.invoiceRemaining)}. The credit is ${formatSgd(suggestion.unallocated ?? (0 as Cents))} above that balance.`;
  }
  if (suggestion.kind === "single" && suggestion.rule === "R3") {
    return `${suggestion.invoiceId} is open for ${formatSgd(input.invoiceRemaining)}. Amount is ${formatSgd(suggestion.shortfall ?? (0 as Cents))} below the balance -> possible short payment.`;
  }
  if (suggestion.kind === "split") {
    const parts = suggestion.parts.map((part) => `${part.invoiceId} ${formatSgd(part.amount)}`).join(" and ");
    return `Exactly one combination sums to ${formatSgd(input.amount)}: ${parts}.`;
  }
  if (suggestion.kind === "choose_one") {
    const names = suggestion.candidates.join(", ");
    return `Amount ${formatSgd(suggestion.amount)} matches more than one open invoice and no single alias decides it. Choose one of ${names}. None pre-ticked.`;
  }
  return suggestion.reason;
}
