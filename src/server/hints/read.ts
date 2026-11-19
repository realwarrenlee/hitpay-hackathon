import { z } from "zod";
import { HintsSchema, type Hints } from "@/domain/hints";
import type { InvoiceId } from "@/domain/ids";
import { hintsClient, type HintsClient } from "@/server/hints/openai";

const RefWireSchema = z
  .object({
    customer: z.string().trim().min(1).max(80).nullable().optional(),
    invoiceNumbers: z.array(z.string()).max(8).optional(),
    alias: z.string().trim().min(1).max(40).nullable().optional(),
    invoiceTokens: z.array(z.string()).max(8).optional(),
  })
  .strip();

const ExplanationWireSchema = z
  .object({
    explanation: z.string().trim().min(1).max(400),
  })
  .strip();

export interface KnownAlias {
  alias: string;
  name: string;
}

export interface HintRead {
  hints: Hints;
  proposedCustomer: string | null;
  proposedInvoices: string[];
  fromModel: boolean;
  transportFailed: boolean;
}

export interface ExplainFact {
  id: string;
  amount: string;
}

export interface ExplainInput {
  rawRef: string;
  payerName: string;
  rule: "R3" | "R4" | "R5";
  reason: string;
  creditAmount: string;
  candidates: readonly ExplainFact[];
  confirmedAliases: readonly { alias: string; customerName: string }[];
}

const REF_SCHEMA = {
  type: "object",
  properties: {
    customer: { anyOf: [{ type: "string" }, { type: "null" }] },
    invoiceNumbers: { type: "array", items: { type: "string" } },
  },
  required: ["customer", "invoiceNumbers"],
  additionalProperties: false,
} as const;

const EXPLANATION_SCHEMA = {
  type: "object",
  properties: { explanation: { type: "string" } },
  required: ["explanation"],
  additionalProperties: false,
} as const;

export function regexHints(rawRef: string, knownInvoiceIds: ReadonlySet<InvoiceId | string>): Hints {
  const tokens: string[] = [];
  const add = (id: string) => {
    if (knownInvoiceIds.has(id) && !tokens.includes(id) && tokens.length < 4) tokens.push(id);
  };
  for (const match of rawRef.matchAll(/INV-(\d{3,6})/gi)) add(`INV-${match[1]}`);
  for (const match of rawRef.matchAll(/(?:^|[^0-9])(\d{1,6})(?![0-9])/g)) add(`INV-${match[1].padStart(3, "0")}`);
  return { alias: null, invoiceTokens: tokens };
}

function knownInvoice(token: string, knownInvoiceIds: ReadonlySet<InvoiceId | string>): string | null {
  const upper = token.toUpperCase().replace(/\s+/g, "");
  const direct = upper.match(/INV-(\d{1,6})/);
  const digits = direct?.[1] ?? (/^\d{1,6}$/.test(upper) ? upper : null);
  if (!digits) return null;
  const id = `INV-${digits.padStart(3, "0")}`;
  return knownInvoiceIds.has(id) ? id : null;
}

function aliasFor(customer: string | null, knownAliases: readonly KnownAlias[]): string | null {
  if (!customer) return null;
  const needle = customer.trim().toLowerCase();
  const row = knownAliases.find((item) => item.alias.toLowerCase() === needle || item.name.toLowerCase() === needle);
  return row ? row.alias.slice(0, 40) : null;
}

export function parseRefProposal(text: string, knownInvoiceIds: ReadonlySet<InvoiceId | string>, knownAliases: readonly KnownAlias[]): HintRead | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = RefWireSchema.safeParse(body);
  if (!parsed.success) return null;
  const proposedCustomer = parsed.data.customer ?? parsed.data.alias ?? null;
  const rawTokens = [...(parsed.data.invoiceNumbers ?? []), ...(parsed.data.invoiceTokens ?? [])];
  const proposedInvoices: string[] = [];
  for (const token of rawTokens) {
    const id = knownInvoice(token, knownInvoiceIds);
    if (id && !proposedInvoices.includes(id) && proposedInvoices.length < 4) proposedInvoices.push(id);
  }
  const hints = HintsSchema.safeParse({ alias: aliasFor(proposedCustomer, knownAliases), invoiceTokens: proposedInvoices });
  if (!hints.success) return null;
  return { hints: hints.data, proposedCustomer, proposedInvoices, fromModel: true, transportFailed: false };
}

function clampSentences(text: string): string | null {
  const parts = text.trim().split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 2);
  const kept = parts.join(" ").trim();
  if (!kept) return null;
  return kept.length > 400 ? kept.slice(0, 400) : kept;
}

export function parseExplanation(text: string): string | null {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = ExplanationWireSchema.safeParse(body);
  if (!parsed.success) return null;
  return clampSentences(parsed.data.explanation);
}

function invoiceIdInText(token: string): string {
  return `INV-${token.padStart(3, "0")}`;
}

export function acceptExplanation(text: string, allowedInvoiceIds: readonly string[]): string | null {
  const sentence = parseExplanation(text);
  if (!sentence) return null;
  const allowed = new Set(allowedInvoiceIds.map((id) => id.toUpperCase()));
  for (const match of sentence.matchAll(/INV-(\d{1,6})/gi)) {
    if (!allowed.has(invoiceIdInText(match[1]))) return null;
  }
  return sentence;
}

export function aliasesInText(rawRef: string, payerName: string, knownAliases: readonly KnownAlias[]): { alias: string; customerName: string }[] {
  const text = `${rawRef} ${payerName}`.toUpperCase();
  const found: { alias: string; customerName: string }[] = [];
  for (const row of knownAliases) {
    const needle = row.alias.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`(?:^|[^A-Z0-9])${needle}(?:$|[^A-Z0-9])`).test(text)) continue;
    if (found.some((item) => item.alias.toUpperCase() === row.alias.toUpperCase())) continue;
    found.push({ alias: row.alias, customerName: row.name });
  }
  return found;
}

export async function readRef(
  rawRef: string,
  payerName: string,
  knownInvoiceIds: ReadonlySet<InvoiceId | string>,
  knownAliases: readonly KnownAlias[] = [],
  client: HintsClient | null = hintsClient(),
): Promise<HintRead> {
  const fallback: HintRead = { hints: regexHints(rawRef, knownInvoiceIds), proposedCustomer: null, proposedInvoices: [], fromModel: false, transportFailed: false };
  if (!client) return fallback;
  const text = await client.complete({
    name: "bank_reference",
    schema: REF_SCHEMA,
    instructions: "Read a messy bank reference and payer. Propose which customer and which invoice numbers it likely refers to. Do not propose an amount, an allocation, or an approval.",
    user: JSON.stringify({
      rawRef,
      payerName,
      openInvoiceIds: [...knownInvoiceIds],
      customers: knownAliases.map((row) => ({ alias: row.alias, name: row.name })),
    }),
  });
  if (!text) return { ...fallback, transportFailed: true };
  const parsed = parseRefProposal(text, knownInvoiceIds, knownAliases);
  if (!parsed) return fallback;
  const invoiceTokens = [...new Set([...fallback.hints.invoiceTokens, ...parsed.hints.invoiceTokens])].slice(0, 4);
  return { ...parsed, hints: { alias: parsed.hints.alias, invoiceTokens } };
}

export async function explainUncertain(input: ExplainInput, client: HintsClient | null = hintsClient()): Promise<{ text: string | null; transportFailed: boolean }> {
  if (!client) return { text: null, transportFailed: false };
  const text = await client.complete({
    name: "match_explanation",
    schema: EXPLANATION_SCHEMA,
    instructions: "Write one or two sentences of plain English for a bookkeeper about why this bank line is uncertain. Only mention invoice ids from candidates. Write currency as S$. Do not speculate beyond the given facts. Do not set an amount, allocate money, or approve the match. If confirmedAliases is not empty, the payer is already identified by that alias: explain the uncertainty that remains in reason, such as a split a person must confirm. Do not say the payer is unknown.",
    user: JSON.stringify(input),
  });
  if (!text) return { text: null, transportFailed: true };
  return { text: acceptExplanation(text, input.candidates.map((row) => row.id)), transportFailed: false };
}
