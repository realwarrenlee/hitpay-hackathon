import { afterEach, expect, test, vi } from "vitest";
import type { InvoiceId } from "@/domain/ids";
import { importBytes, ensureReviewHints } from "@/server/flow";
import { loadHintCache, loadSnapshot } from "@/server/ledger";
import { acceptExplanation, parseRefProposal, readRef } from "@/server/hints/read";
import { readEnv } from "@/server/env";
import { reviewModel } from "@/server/views";
import { fixture, freshDb, NOW } from "../helpers";

const HERO = 'Ref "104" -> INV-104 (open, S$500.00). Payer "ABC CAT" -> ABC Catering (confirmed alias). No other combination of ABC Catering\'s open invoices sums to S$461.60. Amount is S$38.40 below the balance -> possible short payment.';
const EXPLANATION = "The reference looks like ABC Catering paying invoice 104, and the amount is short of the open balance.";

const originalFetch = globalThis.fetch;
const originalKey = process.env.HINTS_API_KEY;
const originalModel = process.env.HINTS_MODEL;
const originalTimeout = process.env.HINTS_TIMEOUT_MS;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.HINTS_API_KEY;
  else process.env.HINTS_API_KEY = originalKey;
  if (originalModel === undefined) delete process.env.HINTS_MODEL;
  else process.env.HINTS_MODEL = originalModel;
  if (originalTimeout === undefined) delete process.env.HINTS_TIMEOUT_MS;
  else process.env.HINTS_TIMEOUT_MS = originalTimeout;
  vi.restoreAllMocks();
});

function modelResponse(text: string) {
  return new Response(JSON.stringify({ output_text: text }), { status: 200, headers: { "content-type": "application/json" } });
}

test("the default hints model is gpt-6.1-terra and can be overridden", () => {
  delete process.env.HINTS_MODEL;
  delete process.env.HINTS_TIMEOUT_MS;
  expect(readEnv().hintsModel).toBe("gpt-6.1-terra");
  expect(readEnv().hintsApiUrl).toBe("https://api.openai.com/v1");
  expect(readEnv().hintsTimeoutMs).toBe(20000);
  process.env.HINTS_MODEL = "desk-model";
  process.env.HINTS_TIMEOUT_MS = "1500";
  expect(readEnv().hintsModel).toBe("desk-model");
  expect(readEnv().hintsTimeoutMs).toBe(1500);
});

test("a valid hint is shown beside the deterministic reason and is not requested twice", async () => {
  process.env.HINTS_API_KEY = "test-key";
  delete process.env.HINTS_MODEL;
  let calls = 0;
  globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    const body = JSON.parse(String(init?.body)) as { model?: string; temperature?: unknown; text?: { format?: { type?: string; name?: string } } };
    expect(body.model).toBe("gpt-6.1-terra");
    expect(body.temperature).toBeUndefined();
    expect(body.text?.format?.type).toBe("json_schema");
    expect(JSON.stringify(body)).not.toMatch(/temperature|top_p|frequency_penalty|presence_penalty/);
    const text = body.text?.format?.name === "match_explanation" ? JSON.stringify({ explanation: EXPLANATION }) : JSON.stringify({ customer: "ABC Catering", invoiceNumbers: ["104"] });
    return modelResponse(text);
  }) as typeof fetch;
  const db = freshDb();
  const imported = await importBytes(db, fixture("fixtures/dbs/demo.csv"), "demo.csv", undefined, NOW);
  expect(imported.ok).toBe(true);
  const firstCalls = calls;
  expect(firstCalls).toBeGreaterThan(0);
  await ensureReviewHints(db, NOW);
  expect(calls).toBe(firstCalls);
  const card = reviewModel(loadSnapshot(db), loadHintCache(db)).cards.find((row) => row.fileLine === 17);
  expect(card?.reason).toBe(HERO);
  expect(card?.ai).toBe(EXPLANATION);
  expect(card?.rule).toBe("R3");
});

test("invalid model JSON falls back to the deterministic reason", async () => {
  process.env.HINTS_API_KEY = "test-key";
  globalThis.fetch = vi.fn(async () => modelResponse("not json")) as typeof fetch;
  const db = freshDb();
  const imported = await importBytes(db, fixture("fixtures/dbs/demo.csv"), "demo.csv", undefined, NOW);
  expect(imported.ok).toBe(true);
  const card = reviewModel(loadSnapshot(db), loadHintCache(db)).cards.find((row) => row.fileLine === 17);
  expect(card?.reason).toBe(HERO);
  expect(card?.ai).toBeNull();
  expect(card?.state).toBe("Suggested");
});

test("a hint that proposes a different amount is ignored", async () => {
  process.env.HINTS_API_KEY = "test-key";
  globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { text?: { format?: { name?: string } } };
    const text = body.text?.format?.name === "match_explanation"
      ? JSON.stringify({ explanation: EXPLANATION, amount: 99999 })
      : JSON.stringify({ customer: "ABC Catering", invoiceNumbers: ["104"], amount: 99999 });
    return modelResponse(text);
  }) as typeof fetch;
  const parsed = parseRefProposal(JSON.stringify({ customer: "ABC Catering", invoiceNumbers: ["104"], amount: 99999 }), new Set(["INV-104"]), [{ alias: "ABC CAT", name: "ABC Catering" }]);
  expect(parsed?.hints).toEqual({ alias: "ABC CAT", invoiceTokens: ["INV-104"] });
  expect(parsed?.hints).not.toHaveProperty("amount");
  const db = freshDb();
  await importBytes(db, fixture("fixtures/dbs/demo.csv"), "demo.csv", undefined, NOW);
  const snap = loadSnapshot(db);
  const credit = [...snap.credits.values()].find((row) => row.source.kind === "bank_csv" && row.source.fileLine === 17)!;
  const suggestion = [...snap.suggestions.values()].find((row) => row.creditId === credit.id)!;
  expect(suggestion.body.kind === "single" && suggestion.body.amount).toBe(credit.amount);
  expect(credit.amount).toBe(46160);
  expect(suggestion.body.kind === "single" && suggestion.body.invoiceId).toBe("INV-104");
});

test("no hints key keeps the deterministic path and does not call the model", async () => {
  delete process.env.HINTS_API_KEY;
  globalThis.fetch = vi.fn(async () => {
    throw new Error("hints should not be called");
  }) as typeof fetch;
  const db = freshDb();
  const imported = await importBytes(db, fixture("fixtures/dbs/demo.csv"), "demo.csv", undefined, NOW);
  expect(imported.ok).toBe(true);
  expect(globalThis.fetch).not.toHaveBeenCalled();
  const card = reviewModel(loadSnapshot(db), loadHintCache(db)).cards.find((row) => row.fileLine === 17);
  expect(card?.reason).toBe(HERO);
  expect(card?.ai).toBeNull();
  const direct = await readRef("ABC CAT 104", "ABC CATERING PTE LTD", new Set<InvoiceId | string>(["INV-104"]));
  expect(direct.fromModel).toBe(false);
  expect(direct.hints.invoiceTokens).toEqual(["INV-104"]);
});

test("HINTS_TIMEOUT_MS aborts a slow hint call and keeps the regex tokens", async () => {
  process.env.HINTS_API_KEY = "test-key";
  process.env.HINTS_TIMEOUT_MS = "40";
  globalThis.fetch = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error("missing signal"));
        return;
      }
      signal.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
    });
  }) as typeof fetch;
  const started = Date.now();
  const result = await readRef("ABC CAT 104", "ABC CATERING PTE LTD", new Set(["INV-104"]));
  expect(Date.now() - started).toBeLessThan(2000);
  expect(result.transportFailed).toBe(true);
  expect(result.fromModel).toBe(false);
  expect(result.hints.invoiceTokens).toEqual(["INV-104"]);
});

test("an explanation that names an invoice outside the candidate list is dropped", async () => {
  const r5 = ["INV-104", "INV-105", "INV-041"];
  const live = "The S$500.00 credit matches INV-104, INV-105, and INV-041, so a person chooses one.";
  expect(acceptExplanation(JSON.stringify({ explanation: live }), r5)).toBe(live);
  expect(acceptExplanation(JSON.stringify({ explanation: "Choose INV-104, INV-105, or INV-110." }), r5)).toBeNull();

  process.env.HINTS_API_KEY = "test-key";
  const seen: { r4: { creditAmount?: string; candidates?: { id: string; amount: string }[]; confirmedAliases?: { alias: string; customerName: string }[] } | null } = { r4: null };
  globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { text?: { format?: { name?: string } }; input?: string };
    if (body.text?.format?.name !== "match_explanation") return modelResponse(JSON.stringify({ customer: null, invoiceNumbers: [] }));
    const payload = JSON.parse(String(body.input)) as { rule?: string; creditAmount?: string; candidates?: { id: string; amount: string }[]; confirmedAliases?: { alias: string; customerName: string }[] };
    if (payload.rule === "R4") {
      seen.r4 = payload;
      return modelResponse(JSON.stringify({ explanation: "TAN BK is Tan BK Café. INV-041 S$500.00 and INV-042 S$300.00 add up, and a person confirms that split." }));
    }
    if (payload.rule === "R5") return modelResponse(JSON.stringify({ explanation: "Choose INV-104, INV-105, or INV-110." }));
    return modelResponse(JSON.stringify({ explanation: EXPLANATION }));
  }) as typeof fetch;
  const db = freshDb();
  await importBytes(db, fixture("fixtures/dbs/demo.csv"), "demo.csv", undefined, NOW);
  const model = reviewModel(loadSnapshot(db), loadHintCache(db));
  const line20 = model.cards.find((row) => row.fileLine === 20);
  expect(line20?.rule).toBe("R5");
  expect(line20?.candidates).toEqual(r5);
  expect(line20?.ai).toBeNull();
  expect(line20?.reason).toContain("INV-104");
  expect(model.cards.find((row) => row.fileLine === 19)?.ai).toContain("INV-041");
  expect(seen.r4?.creditAmount).toBe("S$800.00");
  expect(seen.r4?.candidates).toEqual([
    { id: "INV-041", amount: "S$500.00" },
    { id: "INV-042", amount: "S$300.00" },
  ]);
  expect(seen.r4?.confirmedAliases).toEqual([{ alias: "TAN BK", customerName: "Tan BK Café" }]);
});

test("reference reads run together and stay within four at a time", async () => {
  process.env.HINTS_API_KEY = "test-key";
  let current = 0;
  let peak = 0;
  globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    current += 1;
    peak = Math.max(peak, current);
    await new Promise((resolve) => setTimeout(resolve, 20));
    current -= 1;
    const body = JSON.parse(String(init?.body)) as { text?: { format?: { name?: string } } };
    const text = body.text?.format?.name === "match_explanation" ? JSON.stringify({ explanation: EXPLANATION }) : JSON.stringify({ customer: null, invoiceNumbers: [] });
    return modelResponse(text);
  }) as typeof fetch;
  const db = freshDb();
  await importBytes(db, fixture("fixtures/dbs/demo.csv"), "demo.csv", undefined, NOW);
  expect(peak).toBeGreaterThan(1);
  expect(peak).toBeLessThanOrEqual(4);
});
