import { z } from "zod";
import { parseSgd, type Cents } from "@/domain/money";
import { daysBetween } from "@/domain/dates";
import { asIsoDate } from "@/domain/ids";

// Four-digit invoice dates cannot span more calendar days than this.
export const MAX_POLICY_DAYS = daysBetween(
  asIsoDate("0000-01-01"),
  asIsoDate("9999-12-31"),
);
export interface PolicyValues {
  overdueBalanceThreshold: Cents;
  overdueDaysThreshold: number | null;
}
export type PolicyFieldErrors = Partial<
  Record<"threshold" | "minimumDays" | "form", string>
>;
const Input = z
  .object({
    threshold: z.string().max(64),
    ageMode: z.enum(["none", "custom"]),
    minimumDays: z.string().max(16),
    expectedVersion: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER - 1),
  })
  .strict();
export function validPolicy(values: PolicyValues): boolean {
  return (
    Number.isSafeInteger(values.overdueBalanceThreshold) &&
    values.overdueBalanceThreshold >= 0 &&
    (values.overdueDaysThreshold === null ||
      (Number.isSafeInteger(values.overdueDaysThreshold) &&
        values.overdueDaysThreshold > 0 &&
        values.overdueDaysThreshold <= MAX_POLICY_DAYS))
  );
}
export function parsePolicyInput(
  input: unknown,
):
  | { ok: true; values: PolicyValues; expectedVersion: number }
  | { ok: false; errors: PolicyFieldErrors } {
  const parsed = Input.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      errors: {
        form: "Invalid policy request. Reload Settings and try again.",
      },
    };
  const { threshold, minimumDays, ageMode, expectedVersion } = parsed.data;
  const errors: PolicyFieldErrors = {};
  const money = /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(
    threshold.trim(),
  )
    ? parseSgd(threshold.trim())
    : null;
  if (!money?.ok)
    errors.threshold =
      "Enter a non-negative SGD amount with at most two decimal places, within the exact integer-cent storage limit.";
  let days: number | null = null;
  if (ageMode === "custom") {
    if (!/^[1-9]\d*$/.test(minimumDays.trim()))
      errors.minimumDays =
        "Enter a positive whole number of days, or choose No grace period.";
    else {
      days = parseInt(minimumDays.trim(), 10);
      if (!Number.isSafeInteger(days) || days > MAX_POLICY_DAYS)
        errors.minimumDays = `Days cannot exceed ${MAX_POLICY_DAYS}, the span of the supported invoice-date calendar.`;
    }
  } else if (minimumDays !== "")
    errors.minimumDays = "Choose No grace period without a numeric day value.";
  if (Object.keys(errors).length || !money?.ok) return { ok: false, errors };
  return {
    ok: true,
    values: {
      overdueBalanceThreshold: money.value,
      overdueDaysThreshold: days,
    },
    expectedVersion,
  };
}
