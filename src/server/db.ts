import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS customer (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hold_status TEXT NOT NULL CHECK (hold_status IN ('normal','proposed','pay_first')),
  hold_delivery_id TEXT,
  hold_proposed_at TEXT,
  hold_overdue_cents INTEGER,
  hold_approved_by TEXT,
  hold_approved_at TEXT
);
CREATE TABLE IF NOT EXISTS customer_alias (
  customer_id TEXT NOT NULL,
  alias TEXT NOT NULL UNIQUE,
  confirmed_by_human INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  overdue_balance_threshold_cents INTEGER NOT NULL,
  overdue_days_threshold INTEGER,
  policy_version INTEGER NOT NULL DEFAULT 0 CHECK (policy_version >= 0)
);
CREATE TABLE IF NOT EXISTS invoice (
  id TEXT PRIMARY KEY,
  hitpay_invoice_id TEXT,
  stripe_invoice_id TEXT,
  customer_id TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  allocated_cents INTEGER NOT NULL,
  written_off_cents INTEGER NOT NULL,
  amount_remaining_cents INTEGER NOT NULL CHECK (amount_remaining_cents >= 0),
  status TEXT NOT NULL,
  issued_on TEXT NOT NULL,
  due_on TEXT,
  follow_up_on TEXT,
  CHECK (total_cents = allocated_cents + written_off_cents + amount_remaining_cents)
);
CREATE TABLE IF NOT EXISTS bank_credit (
  id TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL,
  bank TEXT,
  batch_id TEXT,
  file_line INTEGER,
  bank_txn_id TEXT,
  receipt_id TEXT,
  payment_request_id TEXT,
  dedupe_key TEXT NOT NULL UNIQUE,
  value_date TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  raw_ref TEXT NOT NULL,
  payer_name TEXT NOT NULL,
  unallocated_cents INTEGER NOT NULL CHECK (unallocated_cents >= 0),
  review_flags TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS suggestion (
  id TEXT PRIMARY KEY,
  bank_credit_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  rule TEXT NOT NULL,
  tier TEXT NOT NULL,
  preselected INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  invoice_id TEXT,
  amount_cents INTEGER,
  shortfall_cents INTEGER,
  unallocated_cents INTEGER,
  parts_json TEXT,
  candidates_json TEXT
);
CREATE TABLE IF NOT EXISTS allocation (
  id TEXT PRIMARY KEY,
  suggestion_id TEXT NOT NULL,
  bank_credit_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  state TEXT NOT NULL,
  tier TEXT NOT NULL,
  rule TEXT NOT NULL,
  reason TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  reconciled_at TEXT,
  rejected_by TEXT,
  rejected_at TEXT,
  reversed_by TEXT,
  reversed_reason TEXT,
  reversed_at TEXT
);
CREATE TABLE IF NOT EXISTS write_off (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  by_json TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(reason) > 0),
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS delivery (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  payment_request_id TEXT,
  credit_decision_by TEXT
);
CREATE TABLE IF NOT EXISTS payment_request (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  invoice_id TEXT,
  delivery_id TEXT,
  hitpay_request_id TEXT UNIQUE,
  reference_number TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 30),
  status TEXT NOT NULL,
  url TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS webhook_receipt (
  id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL,
  event_type TEXT,
  signature_ok INTEGER NOT NULL,
  hitpay_request_id TEXT,
  dedupe_key TEXT,
  outcome TEXT NOT NULL,
  raw_body_sha256 TEXT NOT NULL,
  source TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS webhook_receipt_dedupe ON webhook_receipt(dedupe_key) WHERE signature_ok = 1 AND dedupe_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS audit_event (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  evidence TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS audit_event_no_update BEFORE UPDATE ON audit_event
BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_event_no_delete BEFORE DELETE ON audit_event
BEGIN SELECT RAISE(ABORT, 'audit_event is append-only'); END;
INSERT INTO settings (id, overdue_balance_threshold_cents, overdue_days_threshold)
VALUES (1, 3000, NULL)
ON CONFLICT(id) DO NOTHING;
`;

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((col) => col.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  ensureColumn(db, "invoice", "due_on", "TEXT");
  ensureColumn(db, "settings", "policy_version", "INTEGER NOT NULL DEFAULT 0 CHECK (policy_version >= 0)");
  ensureColumn(db, "webhook_receipt", "source", "TEXT");
  db.exec(`CREATE TABLE IF NOT EXISTS hint_cache (
  bank_credit_id TEXT PRIMARY KEY,
  file_line INTEGER,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
)`);
  return db;
}

export function withTx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    if (result && typeof result === "object" && "ok" in result && (result as { ok: boolean }).ok === false) {
      db.exec("ROLLBACK");
      return result;
    }
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* already rolled back */
    }
    throw error;
  }
}
