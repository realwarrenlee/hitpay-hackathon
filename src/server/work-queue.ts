import type { LedgerSnapshot } from "@/domain/types";
import { newestActivity } from "@/lib/presentation";
import { deliveryList } from "@/server/deliveries";

export function pendingWork(snapshot: LedgerSnapshot) {
  const credits = [...snapshot.credits.values()].filter(
    (credit) =>
      credit.unallocated > 0 && !credit.reviewFlags.includes("hitpay_payout"),
  );
  const upcoming = deliveryList(snapshot);
  const evaluations = upcoming.filter((row) => {
    if (!row.canEvaluate) return false;
    const prior = newestActivity(
      row.audit.filter((event) => event.action === "delivery_evaluated"),
    )[0]?.after as
      | { policyVersion?: number; policyDate?: string; overdue?: number }
      | undefined;
    return (
      !prior ||
      prior.policyVersion !== snapshot.policyVersion ||
      prior.policyDate !== snapshot.today ||
      prior.overdue !== row.balances.overdue
    );
  });
  return {
    credits,
    upcoming,
    evaluations,
    proposals: upcoming.filter(
      (row) => row.delivery.status === "proposed_pay_first",
    ),
    awaitingPayment: upcoming.filter(
      (row) => row.delivery.status === "pay_first",
    ),
  };
}
