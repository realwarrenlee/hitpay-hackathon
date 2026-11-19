import type { AllocationState } from "@/domain/types";

export const ALLOCATION_EDGES = {
  suggested: { approve: "approved", reject: "rejected" },
  approved: { undo: "suggested", commit: "reconciled" },
  reconciled: { reverse: "reversed" },
  rejected: {},
  reversed: {},
} as const satisfies Record<AllocationState, Record<string, AllocationState>>;

export function allocationEdge(from: AllocationState, action: string): AllocationState | null {
  const edges: Record<string, string> = ALLOCATION_EDGES[from];
  const next = edges[action];
  return next ? (next as AllocationState) : null;
}
