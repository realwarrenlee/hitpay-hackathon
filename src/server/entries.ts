import { InvoiceEntry, DeliveryEntry } from "@/domain/entry";
import { getDb, run } from "@/server/ledger";
import {
  localLedgerAccess,
  LOCAL_OPERATOR,
} from "@/server/local-ledger-access";

export type EntryResult =
  | { ok: true; id: string; existing: boolean }
  | { ok: false; message: string; errors?: Record<string, string> };

export function saveEntry(
  kind: "invoice" | "delivery",
  input: unknown,
): EntryResult {
  if (!localLedgerAccess(true))
    return {
      ok: false,
      message:
        "Supplier actions require explicitly enabled loopback development mode. Production and network writes are disabled.",
    };
  if (kind !== "invoice" && kind !== "delivery")
    return { ok: false, message: "Unknown record type." };
  const parsed = (kind === "invoice" ? InvoiceEntry : DeliveryEntry).safeParse(
    input,
  );
  if (!parsed.success)
    return {
      ok: false,
      message: "Check the highlighted fields.",
      errors: Object.fromEntries(
        parsed.error.issues.map((issue) => [
          String(issue.path[0] ?? "form"),
          issue.message,
        ]),
      ),
    };
  try {
    const result = run(getDb(), {
      kind: kind === "invoice" ? "create_invoice" : "create_delivery",
      input,
      by: LOCAL_OPERATOR,
    });
    if (!result.ok)
      return {
        ok: false,
        message:
          result.error.code === "duplicate"
            ? "That reference already exists with different details. Use a unique reference."
            : result.error.code === "not_found"
              ? "The selected customer no longer exists. Reload and choose a customer."
              : "The record could not be saved. Nothing was changed.",
      };
    return {
      ok: true,
      id: String(
        result.value.info[kind === "invoice" ? "invoiceId" : "deliveryId"],
      ),
      existing: result.value.info.existing === 1,
    };
  } catch {
    return {
      ok: false,
      message:
        "The record could not be saved. Your entries are retained; retry with the same reference to avoid duplicates.",
    };
  }
}
