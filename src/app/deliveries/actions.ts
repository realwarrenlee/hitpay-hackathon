"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { DeliveryId } from "@/domain/ids";
import { getDb, loadSnapshot, run } from "@/server/ledger";
import { approveCustomerHold } from "@/server/flow";
import { currentGateway } from "@/server/hitpay/current";
import { reconcilePayment } from "@/server/hitpay/webhook";
import {
  localLedgerAccess,
  LOCAL_OPERATOR,
} from "@/server/local-ledger-access";
import { readEnv } from "@/server/env";

const Input = z
  .object({
    id: z.string().regex(/^DLV-\d{3,9}$/),
    intent: z.enum([
      "evaluate",
      "approve",
      "reject",
      "override",
      "check_payment",
    ]),
    reason: z.string().trim().max(500),
  })
  .strict();

export async function deliveryAction(
  input: unknown,
): Promise<{ ok: boolean; message: string }> {
  if (!localLedgerAccess(true))
    return {
      ok: false,
      message:
        "Supplier actions require explicitly enabled loopback development mode.",
    };
  const parsed = Input.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      message:
        "Invalid delivery action. Reasons must be at most 500 characters.",
    };
  const { id, intent, reason } = parsed.data;
  if ((intent === "reject" || intent === "override") && !reason)
    return { ok: false, message: "Record a reason for this credit exception." };
  try {
    const db = getDb();
    const delivery = loadSnapshot(db).deliveries.get(id as DeliveryId);
    if (!delivery)
      return {
        ok: false,
        message: "This delivery no longer exists. Reload the page.",
      };
    if (intent === "check_payment") {
      if (!delivery.paymentRequestId)
        return {
          ok: false,
          message: "No payment request is linked to this delivery.",
        };
      const result = await reconcilePayment(
        db,
        currentGateway(),
        delivery.paymentRequestId,
        readEnv().now,
      );
      revalidatePath("/", "layout");
      return {
        ok: result.outcome === "applied" || result.outcome === "pending",
        message:
          result.outcome === "applied"
            ? "Verified payment recorded. Review the delivery state and Audit below."
            : result.outcome === "pending"
              ? "Payment remains pending at the gateway. No delivery release occurred."
              : `Payment not applied: ${result.outcome}. Review the request and Audit; no automatic release was authorised.`,
      };
    }
    const common = {
      customerId: delivery.customerId,
      expectedDeliveryId: delivery.id,
      by: LOCAL_OPERATOR,
    };
    const result =
      intent === "approve"
        ? await approveCustomerHold(
            db,
            currentGateway(),
            delivery.customerId,
            LOCAL_OPERATOR,
            readEnv().now,
            delivery.id,
          )
        : run(
            db,
            intent === "evaluate"
              ? { kind: "check_cutoff", ...common }
              : {
                  kind: intent === "reject" ? "reject_hold" : "override_hold",
                  ...common,
                  reason,
                },
          );
    revalidatePath("/", "layout");
    if (!result.ok)
      return {
        ok: false,
        message:
          result.error.code === "request_unresolved"
            ? "The hold is approved, but checkout creation is unresolved. Inspect the stored reference with the provider before retrying. No duplicate request will be created."
            : result.error.code === "below_minimum"
              ? "The delivery amount is below the S$0.30 payment-request minimum. No approval was applied; review a reasoned credit exception instead."
              : "This action is unavailable or the delivery changed. Reload and review the current state; no new decision was applied.",
      };
    return {
      ok: true,
      message:
        intent === "evaluate"
          ? "Delivery evaluated against the current due-date policy. Review the result below."
          : intent === "approve"
            ? "Pay-first approved. Collect payment for this delivery using the linked checkout."
            : "Credit exception recorded with your reason. Old invoice debt remains outstanding.",
    };
  } catch {
    revalidatePath("/", "layout");
    return {
      ok: false,
      message:
        "Unable to complete the action. Reload to inspect the delivery and any unresolved request before retrying.",
    };
  }
}
