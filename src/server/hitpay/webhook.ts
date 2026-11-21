import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { parseSgd, type Cents } from "@/domain/money";
import type { HitpayRequestId, Instant, PaymentRequestId, ReferenceNumber } from "@/domain/ids";
import type { PaymentRequest, SettlementSource, WebhookRejection } from "@/domain/types";
import type { DatabaseSync } from "node:sqlite";
import { commitWebhook, loadSnapshot, type ReceiptDraft } from "@/server/ledger";
import type { HitPayGateway } from "@/server/hitpay/gateway";
import { readEnv } from "@/server/env";

const EventSchema = z
  .object({
    event_type: z.string().optional(),
    payment_request_id: z.string().min(1),
    reference_number: z.string().min(1),
    amount: z.string().min(1),
    status: z.string().optional(),
    currency: z.string().optional(),
    purpose: z.string().optional(),
  })
  .passthrough();

export function signBody(raw: Uint8Array, salt: string): string {
  return createHmac("sha256", salt).update(raw).digest("hex");
}

export function verifySignature(raw: Uint8Array, header: string | null, salt: string): boolean {
  if (!header || !salt) return false;
  if (!/^[0-9a-fA-F]{64}$/.test(header)) return false;
  const computed = signBody(raw, salt);
  const left = Buffer.from(computed, "utf8");
  const right = Buffer.from(header.toLowerCase(), "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export interface VerifiedSettlement {
  hitpayRequestId: HitpayRequestId;
  referenceNumber: ReferenceNumber;
  amountPaid: Cents;
  paidAt: Instant;
  source: SettlementSource;
  eventType: string | null;
  rawBodySha256: string;
}

type RemotePayment = Extract<Awaited<ReturnType<HitPayGateway["getPaymentRequest"]>>, { ok: true }>["value"];

function confirmationMismatch(request: PaymentRequest | undefined, remote: RemotePayment, id: HitpayRequestId): WebhookRejection | null {
  if (!request || request.referenceNumber !== remote.referenceNumber) return "unknown_reference";
  if (remote.id !== id || request.hitpayRequestId !== id) return "identity_mismatch";
  if (remote.currency !== "SGD") return "currency_mismatch";
  if (remote.purpose !== request.purpose.kind) return "purpose_mismatch";
  if (remote.amount !== request.amount) return "amount_mismatch";
  return null;
}

function rejectConfirmation(db: DatabaseSync, why: WebhookRejection, id: HitpayRequestId, source: SettlementSource, hash: string, now: Instant) {
  return commitWebhook(db, { receivedAt: now, eventType: source, signatureOk: true, hitpayRequestId: id,
    dedupeKey: `rejected:${source}:${id}:${hash}`, outcome: why, rawBodySha256: hash, source },
  (receiptId) => ({ kind: "webhook_rejected", receiptId, why, source }), now);
}

export function settleVerifiedPayment(db: DatabaseSync, input: VerifiedSettlement, now: Instant) {
  const draft: ReceiptDraft = {
    receivedAt: now,
    eventType: input.eventType,
    signatureOk: true,
    hitpayRequestId: input.hitpayRequestId,
    dedupeKey: `hitpay:${input.hitpayRequestId}`,
    outcome: "applied",
    rawBodySha256: input.rawBodySha256,
    source: input.source,
  };
  return commitWebhook(
    db,
    draft,
    (receiptId) => ({
      kind: "webhook_confirmed",
      event: {
        receiptId,
        hitpayRequestId: input.hitpayRequestId,
        referenceNumber: input.referenceNumber,
        amountPaid: input.amountPaid,
        paidAt: input.paidAt,
        source: input.source,
      },
    }),
    now,
  );
}

export async function reconcilePayment(db: DatabaseSync, gateway: HitPayGateway, paymentRequestId: PaymentRequestId, now: Instant) {
  const request = loadSnapshot(db).paymentRequests.get(paymentRequestId);
  if (!request?.hitpayRequestId) return { outcome: "not_found" as const };
  const remote = await gateway.getPaymentRequest(request.hitpayRequestId);
  if (!remote.ok) return { outcome: "tool_error" as const };
  if (remote.value.status !== "completed") return { outcome: remote.value.status };
  const mismatch = confirmationMismatch(request, remote.value, request.hitpayRequestId);
  if (mismatch) {
    const hash = createHash("sha256").update(JSON.stringify(remote.value)).digest("hex");
    rejectConfirmation(db, mismatch, request.hitpayRequestId, "poll", hash, now);
    return { outcome: mismatch };
  }
  const settled = settleVerifiedPayment(
    db,
    {
      hitpayRequestId: request.hitpayRequestId,
      referenceNumber: request.referenceNumber,
      amountPaid: remote.value.amount,
      paidAt: now,
      source: "poll",
      eventType: "poll",
      rawBodySha256: createHash("sha256").update(`poll:${request.hitpayRequestId}:${remote.value.amount as number}`).digest("hex"),
    },
    now,
  );
  if (!settled.ok) return { outcome: settled.error.code };
  return { outcome: settled.value.outcome };
}

export async function handleWebhook(
  db: DatabaseSync,
  raw: Uint8Array,
  headers: Headers,
  gateway: HitPayGateway,
  now: Instant,
): Promise<{ status: 200 | 401 | 400; body: { outcome: string } }> {
  const salt = readEnv().webhookSalt;
  const sha = createHash("sha256").update(raw).digest("hex");
  const signature = headers.get("hitpay-signature");
  const base = (outcome: string, signatureOk: boolean, extra: Partial<ReceiptDraft> = {}): ReceiptDraft => ({
    receivedAt: now,
    eventType: null,
    signatureOk,
    hitpayRequestId: null,
    dedupeKey: signatureOk ? null : `bad:${sha}`,
    outcome,
    rawBodySha256: sha,
    source: "webhook",
    ...extra,
  });

  if (!verifySignature(raw, signature, salt)) {
    commitWebhook(db, base("bad_signature", false), (receiptId) => ({ kind: "webhook_rejected", receiptId, why: "bad_signature" }), now);
    return { status: 401, body: { outcome: "bad_signature" } };
  }

  let parsed: z.infer<typeof EventSchema>;
  try {
    parsed = EventSchema.parse(JSON.parse(new TextDecoder().decode(raw)));
  } catch {
    commitWebhook(db, base("unparseable", true, { dedupeKey: `bad:${sha}` }), (receiptId) => ({ kind: "webhook_rejected", receiptId, why: "unparseable" }), now);
    return { status: 400, body: { outcome: "unparseable" } };
  }

  const hitpayRequestId = parsed.payment_request_id as HitpayRequestId;
  const referenceNumber = parsed.reference_number as ReferenceNumber;
  const amount = parseSgd(parsed.amount);
  if (!amount.ok) {
    commitWebhook(db, base("unparseable", true, { dedupeKey: `hitpay:${hitpayRequestId}`, hitpayRequestId, eventType: parsed.event_type ?? null }), (receiptId) => ({ kind: "webhook_rejected", receiptId, why: "unparseable" }), now);
    return { status: 400, body: { outcome: "unparseable" } };
  }

  const remote = await gateway.getPaymentRequest(hitpayRequestId);
  if (!remote.ok || remote.value.status !== "completed") {
    commitWebhook(
      db,
      base("not_completed", true, { dedupeKey: `hitpay:${hitpayRequestId}`, hitpayRequestId, eventType: parsed.event_type ?? null }),
      (receiptId) => ({ kind: "webhook_rejected", receiptId, why: "not_completed" }),
      now,
    );
    return { status: 200, body: { outcome: "not_completed" } };
  }
  if (remote.value.referenceNumber !== referenceNumber) {
    commitWebhook(
      db,
      base("unknown_reference", true, { dedupeKey: `hitpay:${hitpayRequestId}`, hitpayRequestId, eventType: parsed.event_type ?? null }),
      (receiptId) => ({ kind: "webhook_rejected", receiptId, why: "unknown_reference" }),
      now,
    );
    return { status: 200, body: { outcome: "unknown_reference" } };
  }

  const paid = amount.value;
  const request = [...loadSnapshot(db).paymentRequests.values()].find((row) => row.referenceNumber === referenceNumber);
  const mismatch = confirmationMismatch(request, remote.value, hitpayRequestId)
    ?? (parsed.currency && parsed.currency.toUpperCase() !== "SGD" ? "currency_mismatch" : null)
    ?? (parsed.purpose && parsed.purpose !== request?.purpose.kind ? "purpose_mismatch" : null)
    ?? (parsed.status && parsed.status !== "completed" ? "not_completed" : null)
    ?? (parsed.event_type && parsed.event_type !== "payment_request.completed" ? "event_mismatch" : null)
    ?? (paid !== remote.value.amount ? "amount_mismatch" : null);
  if (mismatch) {
    rejectConfirmation(db, mismatch, hitpayRequestId, "webhook", sha, now);
    return { status: 200, body: { outcome: mismatch } };
  }
  const result = settleVerifiedPayment(
    db,
    {
      hitpayRequestId,
      referenceNumber,
      amountPaid: paid,
      paidAt: now,
      source: "webhook",
      eventType: parsed.event_type ?? null,
      rawBodySha256: sha,
    },
    now,
  );
  if (!result.ok && result.error.code === "not_found") {
    commitWebhook(
      db,
      base("unknown_reference", true, { dedupeKey: `hitpay:${hitpayRequestId}:unknown`, hitpayRequestId, eventType: parsed.event_type ?? null }),
      (receiptId) => ({ kind: "webhook_rejected", receiptId, why: "unknown_reference" }),
      now,
    );
    return { status: 200, body: { outcome: "unknown_reference" } };
  }
  return { status: 200, body: { outcome: result.ok ? result.value.outcome : result.error.code } };
}
