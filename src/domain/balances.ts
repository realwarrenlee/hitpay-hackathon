import { cents, sum, type Cents } from "@/domain/money";
import { daysBetween } from "@/domain/dates";
import type { DedupeKey, ImportBatchId, ReferenceNumber } from "@/domain/ids";
import type {
  Allocation,
  BankCode,
  BankCredit,
  CreditState,
  Invoice,
  InvoiceBalance,
  InvoiceStatus,
  ParsedRow,
  PaymentRequestPurpose,
  Settings,
  WriteOff,
} from "@/domain/types";

export type { CreditState };

function statusOf(allocated: number, writtenOff: number, remaining: number): InvoiceStatus {
  if (allocated + writtenOff === 0) return "open";
  if (remaining === 0) return "paid";
  return "partially_paid";
}

export function invoiceBalance(inv: Invoice, allocs: readonly Allocation[], writeOffs: readonly WriteOff[]): InvoiceBalance {
  const allocated = sum(
    allocs.filter((row) => row.invoiceId === inv.id && (row.state === "approved" || row.state === "reconciled")).map((row) => row.amount),
  );
  const writtenOff = sum(writeOffs.filter((row) => row.invoiceId === inv.id).map((row) => row.amount));
  const remainingN = (inv.total as number) - (allocated as number) - (writtenOff as number);
  const remaining = cents(remainingN < 0 ? 0 : remainingN);
  return {
    allocated,
    writtenOff,
    remaining,
    status: statusOf(allocated as number, writtenOff as number, remainingN < 0 ? -1 : (remaining as number)),
  };
}

export function signedRemaining(inv: Invoice, allocs: readonly Allocation[], writeOffs: readonly WriteOff[]): number {
  const balance = invoiceBalance(inv, allocs, writeOffs);
  const raw = (inv.total as number) - (balance.allocated as number) - (balance.writtenOff as number);
  return raw;
}

export function unallocated(credit: BankCredit, allocs: readonly Allocation[]): Cents {
  const used = sum(
    allocs
      .filter((row) => row.creditId === credit.id && (row.state === "approved" || row.state === "reconciled"))
      .map((row) => row.amount),
  );
  const left = (credit.amount as number) - (used as number);
  return cents(left < 0 ? 0 : left);
}

export function signedUnallocated(credit: BankCredit, allocs: readonly Allocation[]): number {
  const used = allocs
    .filter((row) => row.creditId === credit.id && (row.state === "approved" || row.state === "reconciled"))
    .reduce((total, row) => total + (row.amount as number), 0);
  return (credit.amount as number) - used;
}

export function creditState(allocs: readonly Allocation[]): CreditState {
  const live = allocs.filter((row) => row.state !== "rejected" && row.state !== "reversed");
  if (live.length === 0) return "unmatched";
  const approved = live.some((row) => row.state === "approved");
  const reconciled = live.some((row) => row.state === "reconciled");
  const suggested = live.some((row) => row.state === "suggested");
  if (suggested && !approved && !reconciled) return "suggested";
  if (approved) return "approved";
  if (live.every((row) => row.state === "reconciled")) return "reconciled";
  return "unmatched";
}

export function overdueBalance(
  balances: readonly { invoice: Invoice; balance: InvoiceBalance }[],
  settings: Settings,
  today: Invoice["issuedOn"],
): Cents {
  const rows = balances.filter((row) => {
    if (row.balance.status !== "open" && row.balance.status !== "partially_paid") return false;
    if (row.invoice.dueOn == null) return false;
    const pastDue = daysBetween(row.invoice.dueOn, today);
    return pastDue > (settings.overdueDaysThreshold ?? 0);
  });
  return sum(rows.map((row) => row.balance.remaining));
}

export function dedupeKey(row: ParsedRow, batchId: ImportBatchId, bank: BankCode): DedupeKey {
  if (row.bankTxnId) return `${bank}:txn:${row.bankTxnId}` as DedupeKey;
  return `${bank}:batch:${batchId}:line:${row.fileLine}` as DedupeKey;
}

export function referenceNumber(purpose: PaymentRequestPurpose, n: number): ReferenceNumber {
  const id = purpose.kind === "remainder" ? purpose.invoiceId : purpose.deliveryId;
  return `TALLY-${id}-${n}` as ReferenceNumber;
}
