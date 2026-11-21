import { openDatabase } from "@/server/db";
import { loadSnapshot, persist } from "@/server/ledger";
import type { AuditEvent } from "@/domain/types";
import { NOW } from "../helpers";

export function supplierDb(path = ":memory:") {
  const db = openDatabase(path);
  const s = loadSnapshot(db);
  s.customers.set("CUS-AHS" as never, {
    id: "CUS-AHS" as never,
    name: "Ah Seng Eating House",
    hold: { status: "normal" },
  });
  s.customers.set("CUS-TBK" as never, {
    id: "CUS-TBK" as never,
    name: "Tan BK Café",
    hold: { status: "normal" },
  });
  s.aliases.push({
    customerId: "CUS-AHS" as never,
    alias: "AH SENG",
    confirmedByHuman: true,
  });
  const audit: AuditEvent = {
    id: "AUD-0001",
    at: NOW,
    actor: { kind: "human", name: "Test fixture operator" },
    entity: "customer",
    entityId: "CUS-AHS",
    action: "seeded",
    before: null,
    after: { customers: 2 },
    evidence: {
      kind: "human_reason",
      reason:
        "Isolated fictional supplier fixture; no invoices or deliveries seeded",
    },
  };
  s.seq = 2;
  persist(db, s, [audit]);
  return db;
}

export const operator = {
  kind: "human" as const,
  name: "Local development operator",
};
export const invoiceInput = {
  id: "INV-9001",
  customerId: "CUS-AHS",
  amount: "38.40",
  issuedOn: "2026-10-17",
  dueOn: "2026-11-16",
};
export const deliveryInput = {
  id: "DLV-9001",
  customerId: "CUS-AHS",
  amount: "220.00",
  scheduledFor: "2026-11-18",
};
