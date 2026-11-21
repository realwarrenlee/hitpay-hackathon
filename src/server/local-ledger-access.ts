import { readLocalLedgerMode } from "@/server/env";
import { trustedLoopbackRequest } from "@/server/local-policy-access";
import { localPolicyRequest } from "@/server/local-request-context";
import type { HumanActor } from "@/domain/types";

export const LOCAL_OPERATOR: HumanActor = {
  kind: "human",
  name: "Local development operator",
};

export function localLedgerAccess(write = false): boolean {
  return (
    readLocalLedgerMode() && trustedLoopbackRequest(localPolicyRequest(), write)
  );
}
