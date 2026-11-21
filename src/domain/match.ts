import { cents, sub, type Cents } from "@/domain/money";
import { formatSgd } from "@/domain/money";
import type { CustomerId, InvoiceId, IsoDate } from "@/domain/ids";
import type { Hints, MatchResult, SuggestionBody } from "@/domain/types";
import { daysBetween, inCandidateWindow } from "@/domain/dates";
import { explainSuggestion } from "@/domain/reason";

export interface OpenInvoice {
  id: InvoiceId;
  customerId: CustomerId;
  remaining: Cents;
  issuedOn: IsoDate;
}

export interface MatchInput {
  credit: { amount: Cents; rawRef: string; payerName: string; valueDate: IsoDate };
  openInvoices: readonly OpenInvoice[];
  confirmedAliases: readonly { alias: string; customerId: CustomerId; customerName: string }[];
  hints: Hints;
}

export function subsetSums(invoices: readonly OpenInvoice[], target: Cents): readonly (readonly OpenInvoice[])[] {
  if (invoices.length > 4) return [];
  const found: OpenInvoice[][] = [];
  const n = invoices.length;
  for (let mask = 1; mask < 1 << n; mask += 1) {
    const group: OpenInvoice[] = [];
    let total = 0;
    for (let i = 0; i < n; i += 1) {
      if ((mask & (1 << i)) === 0) continue;
      group.push(invoices[i]);
      total += invoices[i].remaining as number;
    }
    if (group.length >= 2 && total === (target as number)) found.push(group);
  }
  return found;
}

function containsAlias(text: string, alias: string): boolean {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?:$|[^A-Za-z0-9])`, "i").test(text);
}

function findCustomer(input: MatchInput): { id: CustomerId; name: string; alias: string } | null {
  const texts = [input.credit.rawRef, input.credit.payerName];
  for (const row of input.confirmedAliases) {
    if (texts.some((text) => containsAlias(text, row.alias))) {
      return { id: row.customerId, name: row.customerName, alias: row.alias };
    }
  }
  if (input.hints.alias) {
    const confirmed = input.confirmedAliases.find((row) => row.alias.toLowerCase() === input.hints.alias?.toLowerCase());
    if (confirmed && texts.some((text) => containsAlias(text, confirmed.alias))) {
      return { id: confirmed.customerId, name: confirmed.customerName, alias: confirmed.alias };
    }
  }
  return null;
}

function finish(input: MatchInput, suggestion: SuggestionBody, invoiceRemaining: Cents, alias: string | null, customerName: string | null): MatchResult {
  const reason = explainSuggestion({
    rawRef: input.credit.rawRef,
    amount: input.credit.amount,
    alias,
    customerName,
    invoiceLabel: suggestion.kind === "single" ? suggestion.invoiceId : "",
    invoiceRemaining,
    suggestion: { ...suggestion, reason: "" } as SuggestionBody,
  });
  if (suggestion.kind === "single") return { kind: "suggested", suggestion: { ...suggestion, reason } };
  if (suggestion.kind === "split") return { kind: "suggested", suggestion: { ...suggestion, reason } };
  return { kind: "suggested", suggestion: { ...suggestion, reason } };
}

export function match(input: MatchInput): MatchResult {
  const literalTokens = input.openInvoices.filter((row) => containsAlias(input.credit.rawRef, row.id)).map((row) => row.id);
  const oldReferenced = input.openInvoices.filter((row) => daysBetween(row.issuedOn, input.credit.valueDate) > 60 && literalTokens.includes(row.id));
  const identities = new Set(input.confirmedAliases.filter((row) => [input.credit.rawRef, input.credit.payerName].some((text) => containsAlias(text, row.alias))).map((row) => row.customerId));
  if (oldReferenced.length && (literalTokens.length !== 1 || identities.size > 1 || (identities.size === 1 && !identities.has(oldReferenced[0].customerId)))) {
    return { kind: "unmatched", reason: "Older invoice reference is ambiguous or conflicts with the confirmed payer; review manually." };
  }
  const open = input.openInvoices.filter((row) => (row.remaining as number) > 0 &&
    (inCandidateWindow(row.issuedOn, input.credit.valueDate) ||
      (daysBetween(row.issuedOn, input.credit.valueDate) > 60 && literalTokens.length === 1 && literalTokens.includes(row.id))));
  const tokenInvoices: OpenInvoice[] = [];
  for (const token of input.hints.invoiceTokens) {
    const found = open.find((row) => row.id === token);
    if (found && !tokenInvoices.some((row) => row.id === found.id)) tokenInvoices.push(found);
  }
  if (literalTokens.length && tokenInvoices.length === 0) return { kind: "unmatched", reason: "Referenced invoice is paid or outside the eligible payment dates." };
  const customer = findCustomer(input);
  const amount = input.credit.amount;

  if (tokenInvoices.length === 1) {
    const inv = tokenInvoices[0];
    if ((amount as number) === (inv.remaining as number)) {
      return finish(input, { kind: "single", rule: "R1", tier: "A", invoiceId: inv.id, amount, preselected: true, reason: "" }, inv.remaining, customer?.alias ?? null, customer?.name ?? null);
    }
    if ((amount as number) < (inv.remaining as number)) {
      const shortfall = sub(inv.remaining, amount) ?? cents(0);
      return finish(
        input,
        { kind: "single", rule: "R3", tier: "B", invoiceId: inv.id, amount, preselected: false, shortfall, unallocated: null, reason: "" },
        inv.remaining,
        customer?.alias ?? null,
        customer?.name ?? null,
      );
    }
    const unallocated = sub(amount, inv.remaining) ?? cents(0);
    return finish(
      input,
      { kind: "single", rule: "R6", tier: "B", invoiceId: inv.id, amount: inv.remaining, preselected: false, shortfall: null, unallocated, reason: "" },
      inv.remaining,
      customer?.alias ?? null,
      customer?.name ?? null,
    );
  }

  if (tokenInvoices.length >= 2) {
    const sameCustomer = new Set(tokenInvoices.map((row) => row.customerId)).size === 1;
    const subsets = sameCustomer ? subsetSums(tokenInvoices, amount) : [];
    if (sameCustomer && subsets.length === 1) {
      const parts = subsets[0].map((row) => ({ invoiceId: row.id, amount: row.remaining }));
      return finish(input, { kind: "split", rule: "R4", tier: "B", parts, preselected: false, reason: "" }, amount, customer?.alias ?? null, customer?.name ?? null);
    }
    return finish(
      input,
      { kind: "choose_one", rule: "R5", tier: "C", candidates: tokenInvoices.map((row) => row.id), amount, preselected: false, reason: "" },
      amount,
      customer?.alias ?? null,
      customer?.name ?? null,
    );
  }

  if (customer) {
    const cust = open.filter((row) => row.customerId === customer.id);
    const exact = cust.filter((row) => (row.remaining as number) === (amount as number));
    if (exact.length === 1) {
      return finish(
        input,
        { kind: "single", rule: "R2", tier: "B", invoiceId: exact[0].id, amount, preselected: false, shortfall: null, unallocated: null, reason: "" },
        exact[0].remaining,
        customer.alias,
        customer.name,
      );
    }
    if (cust.length >= 2 && cust.length <= 4) {
      const subsets = subsetSums(cust, amount);
      if (subsets.length === 1) {
        const parts = subsets[0].map((row) => ({ invoiceId: row.id, amount: row.remaining }));
        return finish(input, { kind: "split", rule: "R4", tier: "B", parts, preselected: false, reason: "" }, amount, customer.alias, customer.name);
      }
    }
    if (cust.length === 1 && (amount as number) > (cust[0].remaining as number)) {
      const unallocated = sub(amount, cust[0].remaining) ?? cents(0);
      return finish(
        input,
        { kind: "single", rule: "R6", tier: "C", invoiceId: cust[0].id, amount: cust[0].remaining, preselected: false, shortfall: null, unallocated, reason: "" },
        cust[0].remaining,
        customer.alias,
        customer.name,
      );
    }
    const candidates = cust.filter((row) => (row.remaining as number) <= (amount as number));
    if (candidates.length > 0) {
      return finish(
        input,
        { kind: "choose_one", rule: "R5", tier: "C", candidates: candidates.map((row) => row.id), amount, preselected: false, reason: "" },
        amount,
        customer.alias,
        customer.name,
      );
    }
    return { kind: "unmatched", reason: `no candidate for customer ${customer.name}` };
  }

  const exact = open.filter((row) => (row.remaining as number) === (amount as number));
  if (exact.length >= 1) {
    return finish(
      input,
      { kind: "choose_one", rule: "R5", tier: "C", candidates: exact.map((row) => row.id), amount, preselected: false, reason: "" },
      amount,
      null,
      null,
    );
  }
  return { kind: "unmatched", reason: `no open invoice for ${formatSgd(amount)} within 60 days` };
}
