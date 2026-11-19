import { formatAmount } from "@/domain/money";
import { parsePolicyInput, type PolicyFieldErrors } from "@/domain/policy";
import type { LedgerSnapshot } from "@/domain/types";
import { getDb, loadSnapshot, run } from "@/server/ledger";
import { localPolicyAccess } from "@/server/local-policy-access";
export interface PolicyView {
  threshold: string;
  minimumDays: number | null;
  version: number;
}
export type PolicySaveResult =
  | { ok: true; policy: PolicyView }
  | {
      ok: false;
      code: "access_denied" | "validation" | "conflict" | "save_failed";
      message: string;
      errors?: PolicyFieldErrors;
    };
export function policyView(snapshot: LedgerSnapshot): PolicyView {
  return {
    threshold: formatAmount(snapshot.settings.overdueBalanceThreshold),
    minimumDays: snapshot.settings.overdueDaysThreshold,
    version: snapshot.policyVersion,
  };
}
export function currentPolicy(): PolicyView {
  return policyView(loadSnapshot(getDb()));
}
export function savePolicy(input: unknown): PolicySaveResult {
  if (!localPolicyAccess(true))
    return {
      ok: false,
      code: "access_denied",
      message:
        "Policy editing requires explicitly enabled loopback development mode. Production and network writes are disabled.",
    };
  const parsed = parsePolicyInput(input);
  if (!parsed.ok)
    return {
      ok: false,
      code: "validation",
      message: "Check the highlighted fields.",
      errors: parsed.errors,
    };
  try {
    const result = run(getDb(), {
      kind: "update_policy",
      values: parsed.values,
      expectedVersion: parsed.expectedVersion,
      by: {
        kind: "human",
        name: "Local development operator",
        access: "loopback_development",
      },
    });
    if (!result.ok)
      return {
        ok: false,
        code:
          result.error.code === "policy_conflict" ? "conflict" : "save_failed",
        message:
          result.error.code === "policy_conflict"
            ? "Another client changed the policy. Reload the latest configuration, review it, and try again."
            : "The policy could not be saved. Nothing was changed.",
      };
    return { ok: true, policy: policyView(result.value.snapshot) };
  } catch {
    return {
      ok: false,
      code: "save_failed",
      message:
        "The policy could not be saved. Nothing was changed. Please try again.",
    };
  }
}
