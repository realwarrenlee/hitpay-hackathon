import { createHash } from "node:crypto";
import { asIsoDate, type ImportBatchId, type IsoDate } from "@/domain/ids";
import { parseSgd, type Result } from "@/domain/money";
import type { ParsedBatch, ParsedRow, ReviewFlag } from "@/domain/types";

export type ImportError = { code: "no_header" | "bad_date" | "bad_amount" | "empty"; fileLine: number; detail: string };

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function splitCsv(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (ch === "," && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function parseDate(text: string): IsoDate | null {
  const match = text.trim().match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (!match) return null;
  const month = MONTHS[match[2].toLowerCase()];
  if (!month) return null;
  return asIsoDate(`${match[3]}-${String(month).padStart(2, "0")}-${match[1].padStart(2, "0")}`);
}

export function parseDbs(bytes: Uint8Array, fileName: string): Result<ParsedBatch, ImportError> {
  const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/);
  let header = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const cells = splitCsv(lines[i]);
    if (cells[0] === "Transaction Date") {
      header = i;
      break;
    }
  }
  if (header < 0) return { ok: false, error: { code: "no_header", fileLine: 1, detail: "Transaction Date header not found" } };
  const headerCells = splitCsv(lines[header]);
  const payerIndex = headerCells.findIndex((cell) => cell.toLowerCase() === "payer");
  const rows: ParsedRow[] = [];
  let skippedDebits = 0;
  for (let i = header + 1; i < lines.length; i += 1) {
    if (!lines[i].trim()) continue;
    const cells = splitCsv(lines[i]);
    const fileLine = i + 1;
    const debit = (cells[7] ?? "").replace(/^'/, "").replace(/,/g, "").trim();
    const credit = (cells[8] ?? "").replace(/^'/, "").replace(/,/g, "").trim();
    if (!credit) {
      if (debit) skippedDebits += 1;
      continue;
    }
    const valueDate = parseDate(cells[0] ?? "");
    if (!valueDate) return { ok: false, error: { code: "bad_date", fileLine, detail: cells[0] ?? "" } };
    const parsed = parseSgd(credit);
    if (!parsed.ok) return { ok: false, error: { code: "bad_amount", fileLine, detail: credit } };
    const rawRef = [cells[3], cells[4], cells[5]].filter((cell) => cell && cell.length > 0).join(" ");
    const payerName = payerIndex >= 0 ? (cells[payerIndex] ?? "") : (cells[9] ?? "");
    const reviewFlags: ReviewFlag[] = [];
    if (/hitpay/i.test(rawRef) || /hitpay/i.test(payerName)) reviewFlags.push("hitpay_payout");
    rows.push({ fileLine, valueDate, amount: parsed.value, rawRef, payerName, bankTxnId: null, reviewFlags });
  }
  if (rows.length === 0 && skippedDebits === 0) return { ok: false, error: { code: "empty", fileLine: header + 1, detail: "no credit rows" } };
  const batchId = createHash("sha256").update(bytes).digest("hex") as ImportBatchId;
  return { ok: true, value: { bank: "DBS", batchId, fileName, rows, skippedDebits } };
}
