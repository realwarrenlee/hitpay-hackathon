import type { Cents } from "@/domain/money";
import type { DeliveryId } from "@/domain/ids";
import type { Delivery, Hold, Settings } from "@/domain/types";

export type CutOffInput = {
  hold: Hold;
  overdue: Cents;
  settings: Settings;
  nextDelivery: Delivery | null;
};

export type CutOffDecision =
  | { propose: true; deliveryId: DeliveryId; overdue: Cents; threshold: Cents }
  | { propose: false; why: "hold_not_normal" | "under_threshold" | "no_open_delivery" };

export function evaluateCutOff(input: CutOffInput): CutOffDecision {
  if (input.hold.status !== "normal") return { propose: false, why: "hold_not_normal" };
  if (!input.nextDelivery) return { propose: false, why: "no_open_delivery" };
  const overBalance = (input.overdue as number) > (input.settings.overdueBalanceThreshold as number);
  if (overBalance) {
    return {
      propose: true,
      deliveryId: input.nextDelivery.id,
      overdue: input.overdue,
      threshold: input.settings.overdueBalanceThreshold,
    };
  }
  return { propose: false, why: "under_threshold" };
}

