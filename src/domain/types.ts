import type { Cents } from "@/domain/money";
import type {
  AllocationId,
  CreditId,
  CustomerId,
  DedupeKey,
  DeliveryId,
  HitpayRequestId,
  ImportBatchId,
  Instant,
  InvoiceId,
  IsoDate,
  PaymentRequestId,
  ReceiptId,
  ReferenceNumber,
  SuggestionId,
} from "@/domain/ids";

export type HumanActor = { kind: "human"; name: string };
export type PolicyActor = HumanActor & { access: "loopback_development" };
export type SystemActor = { kind: "system" };
export type AiActor = { kind: "ai" };
export type Actor = HumanActor | SystemActor | AiActor;

export type VerifiedRemainderApproval = {
  kind: "system";
  via: "verified_remainder_webhook";
  receiptId: ReceiptId;
  paymentRequestId: PaymentRequestId;
};
export type Approver = HumanActor | VerifiedRemainderApproval;

export type SettlementSource = "poll" | "webhook";

export type Evidence =
  | { kind: "csv_row"; batchId: ImportBatchId; fileLine: number }
  | { kind: "webhook"; receiptId: ReceiptId; hitpayRequestId: HitpayRequestId | null; source: SettlementSource }
  | { kind: "threshold"; overdue: Cents; threshold: Cents; deliveryId: DeliveryId }
  | { kind: "human_reason"; reason: string }
  | { kind: "hint"; rawRef: string };

export type BankCode = "DBS" | "OCBC" | "UOB";
export type ReviewFlag = "identical_row" | "overpayment_unallocated" | "hitpay_payout";

export type CreditSource =
  | { kind: "bank_csv"; bank: BankCode; batchId: ImportBatchId; fileLine: number; bankTxnId: string | null }
  | { kind: "hitpay_webhook"; receiptId: ReceiptId; paymentRequestId: PaymentRequestId };

export interface BankCredit {
  id: CreditId;
  source: CreditSource;
  dedupeKey: DedupeKey;
  valueDate: IsoDate;
  amount: Cents;
  rawRef: string;
  payerName: string;
  reviewFlags: ReviewFlag[];
  unallocated: Cents;
}

export type InvoiceStatus = "open" | "partially_paid" | "paid";
export type CreditState = "unmatched" | "suggested" | "approved" | "reconciled";

export interface Invoice {
  id: InvoiceId;
  hitpayInvoiceId: string | null;
  stripeInvoiceId: string | null;
  customerId: CustomerId;
  total: Cents;
  issuedOn: IsoDate;
  followUpOn: IsoDate | null;
  allocated: Cents;
  writtenOff: Cents;
  remaining: Cents;
  status: InvoiceStatus;
}

export interface InvoiceBalance {
  allocated: Cents;
  writtenOff: Cents;
  remaining: Cents;
  status: InvoiceStatus;
}

export type HoldStatus = "normal" | "proposed" | "pay_first";
export type Hold =
  | { status: "normal" }
  | { status: "proposed"; deliveryId: DeliveryId; proposedAt: Instant; overdue: Cents }
  | { status: "pay_first"; deliveryId: DeliveryId; approvedBy: HumanActor; approvedAt: Instant };

export interface Customer {
  id: CustomerId;
  name: string;
  hold: Hold;
}

export interface CustomerAlias {
  customerId: CustomerId;
  alias: string;
  confirmedByHuman: boolean;
}

export interface Settings {
  overdueBalanceThreshold: Cents;
  overdueDaysThreshold: number | null;
}

export type DeliveryStatus = "on_credit" | "proposed_pay_first" | "pay_first" | "released" | "cancelled";

export interface Delivery {
  id: DeliveryId;
  customerId: CustomerId;
  scheduledFor: IsoDate;
  amount: Cents;
  status: DeliveryStatus;
  paymentRequestId: PaymentRequestId | null;
  creditDecisionBy: HumanActor | null;
}

export interface WriteOff {
  id: string;
  invoiceId: InvoiceId;
  amount: Cents;
  by: HumanActor;
  reason: string;
  at: Instant;
}

export interface ParsedRow {
  fileLine: number;
  valueDate: IsoDate;
  amount: Cents;
  rawRef: string;
  payerName: string;
  bankTxnId: string | null;
  reviewFlags: ReviewFlag[];
}

export interface ParsedBatch {
  bank: BankCode;
  batchId: ImportBatchId;
  fileName: string;
  rows: ParsedRow[];
  skippedDebits: number;
}

export type Tier = "A" | "B" | "C";
export type RuleId = "R1" | "R2" | "R3" | "R4" | "R5" | "R6";

export type SuggestionBody =
  | { kind: "single"; rule: "R1"; tier: "A"; invoiceId: InvoiceId; amount: Cents; preselected: true; reason: string }
  | {
      kind: "single";
      rule: "R2" | "R3" | "R6";
      tier: "B" | "C";
      invoiceId: InvoiceId;
      amount: Cents;
      preselected: false;
      shortfall: Cents | null;
      unallocated: Cents | null;
      reason: string;
    }
  | { kind: "split"; rule: "R4"; tier: "B"; parts: readonly { invoiceId: InvoiceId; amount: Cents }[]; preselected: false; reason: string }
  | { kind: "choose_one"; rule: "R5"; tier: "C"; candidates: readonly InvoiceId[]; amount: Cents; preselected: false; reason: string };

export type MatchResult = { kind: "suggested"; suggestion: SuggestionBody } | { kind: "unmatched"; reason: string };

export interface StoredSuggestion {
  id: SuggestionId;
  creditId: CreditId;
  status: "open" | "accepted" | "rejected";
  body: SuggestionBody;
}

export type AllocationState = "suggested" | "approved" | "reconciled" | "rejected" | "reversed";

export interface Allocation {
  id: AllocationId;
  suggestionId: SuggestionId;
  creditId: CreditId;
  invoiceId: InvoiceId;
  amount: Cents;
  state: AllocationState;
  tier: Tier;
  rule: RuleId;
  reason: string;
  approvedBy: Approver | null;
  approvedAt: Instant | null;
  reconciledAt: Instant | null;
  rejectedBy: HumanActor | SystemActor | null;
  rejectedAt: Instant | null;
  reversedBy: HumanActor | null;
  reversedReason: string | null;
  reversedAt: Instant | null;
}

export type PaymentRequestPurpose = { kind: "remainder"; invoiceId: InvoiceId } | { kind: "pay_first"; deliveryId: DeliveryId };
export type PaymentRequestStatus = "creating" | "pending" | "completed" | "superseded" | "abandoned";

export interface PaymentRequest {
  id: PaymentRequestId;
  purpose: PaymentRequestPurpose;
  referenceNumber: ReferenceNumber;
  amount: Cents;
  status: PaymentRequestStatus;
  hitpayRequestId: HitpayRequestId | null;
  url: string | null;
  createdAt: Instant;
}

export interface WebhookReceipt {
  id: ReceiptId;
  receivedAt: Instant;
  eventType: string | null;
  signatureOk: boolean;
  hitpayRequestId: HitpayRequestId | null;
  dedupeKey: string | null;
  outcome: string;
  rawBodySha256: string;
  source: SettlementSource;
}

export interface AuditEvent {
  id: string;
  at: Instant;
  actor: Actor;
  entity: string;
  entityId: string;
  action: string;
  before: unknown;
  after: unknown;
  evidence: Evidence;
}

export interface ConfirmedPayment {
  receiptId: ReceiptId;
  hitpayRequestId: HitpayRequestId;
  referenceNumber: ReferenceNumber;
  amountPaid: Cents;
  paidAt: Instant;
  source: SettlementSource;
}

export type WebhookRejection = "bad_signature" | "unparseable" | "unknown_reference" | "not_completed" | "amount_mismatch";

export type Hints = { alias: string | null; invoiceTokens: string[] };

export type Command =
  | { kind: "update_policy"; values: Settings; expectedVersion: number; by: PolicyActor }
  | { kind: "import_batch"; batch: ParsedBatch; actor: HumanActor }
  | { kind: "record_suggestions"; creditId: CreditId; result: MatchResult }
  | { kind: "approve"; suggestionId: SuggestionId; pick: InvoiceId | null; by: HumanActor }
  | { kind: "approve_preselected"; by: HumanActor }
  | { kind: "reject"; suggestionId: SuggestionId; by: HumanActor }
  | { kind: "manual_allocate"; creditId: CreditId; invoiceId: InvoiceId; amount: Cents; by: HumanActor }
  | { kind: "undo"; allocationId: AllocationId; by: HumanActor }
  | { kind: "commit_approved"; by: HumanActor }
  | { kind: "reverse"; allocationId: AllocationId; by: HumanActor; reason: string }
  | { kind: "write_off"; invoiceId: InvoiceId; amount: Cents; by: Actor; reason: string }
  | { kind: "confirm_alias"; customerId: CustomerId; alias: string; by: HumanActor }
  | { kind: "record_hint"; creditId: CreditId; hints: Hints }
  | { kind: "create_payment_request"; purpose: PaymentRequestPurpose; by: HumanActor }
  | { kind: "payment_request_created"; id: PaymentRequestId; hitpayRequestId: HitpayRequestId; url: string }
  | { kind: "webhook_confirmed"; event: ConfirmedPayment }
  | { kind: "webhook_rejected"; receiptId: ReceiptId; why: WebhookRejection }
  | { kind: "check_cutoff"; customerId: CustomerId | "all"; by: HumanActor | SystemActor }
  | { kind: "approve_hold"; customerId: CustomerId; by: HumanActor }
  | { kind: "reject_hold"; customerId: CustomerId; by: HumanActor; reason: string }
  | { kind: "override_hold"; customerId: CustomerId; by: HumanActor; reason: string }
  | { kind: "mark_delivered"; deliveryId: DeliveryId; by: HumanActor };

export type Rejection = {
  code:
    | "not_found"
    | "illegal_transition"
    | "over_allocation"
    | "negative_balance"
    | "below_minimum"
    | "amount_mismatch"
    | "wrong_actor"
    | "duplicate"
    | "invalid_policy"
    | "policy_conflict";
  detail: string;
};

export interface LedgerSnapshot {
  seq: number;
  credits: Map<CreditId, BankCredit>;
  suggestions: Map<SuggestionId, StoredSuggestion>;
  allocations: Map<AllocationId, Allocation>;
  invoices: Map<InvoiceId, Invoice>;
  writeOffs: WriteOff[];
  customers: Map<CustomerId, Customer>;
  aliases: CustomerAlias[];
  deliveries: Map<DeliveryId, Delivery>;
  paymentRequests: Map<PaymentRequestId, PaymentRequest>;
  receipts: WebhookReceipt[];
  settings: Settings;
  policyVersion: number;
  audit: AuditEvent[];
  today: IsoDate;
  autoApproveRemainder: boolean;
}

export interface Change {
  snapshot: LedgerSnapshot;
  audit: AuditEvent[];
  followUps: Command[];
  info: Record<string, string | number>;
}
