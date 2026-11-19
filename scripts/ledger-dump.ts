import { writeFileSync } from "node:fs";
import { loadSnapshot, getDb } from "../src/server/ledger";

const out = process.argv[process.argv.indexOf("--out") + 1];
const snap = loadSnapshot(getDb());
const dump = {
  invoices: [...snap.invoices.values()],
  credits: [...snap.credits.values()],
  suggestions: [...snap.suggestions.values()],
  allocations: [...snap.allocations.values()],
  customers: [...snap.customers.values()],
  deliveries: [...snap.deliveries.values()],
  paymentRequests: [...snap.paymentRequests.values()],
  receipts: snap.receipts,
  audit: snap.audit,
};
const json = JSON.stringify(dump, null, 2);
if (out && out !== "--out") writeFileSync(out, json);
else console.log(json);
