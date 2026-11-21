import { z } from "zod";
import { cents, formatSgd } from "@/domain/money";
const State = z.object({
  overdueBalanceThreshold: z.number().int().nonnegative(),
  overdueDaysThreshold: z.number().int().nullable(),
  basis: z.literal("due_date").optional(),
  version: z.number().int().nonnegative(),
});
export function PolicyAuditDetails({
  before,
  after,
}: {
  before: unknown;
  after: unknown;
}) {
  const oldPolicy = State.safeParse(before);
  const newPolicy = State.safeParse(after);
  if (!oldPolicy.success || !newPolicy.success) return null;
  const age = (days: number | null) =>
    days === null ? "No minimum age" : `Older than ${days} days`;
  return (
    <dl className="mt-3 space-y-2 text-xs leading-5">
      <div>
        <dt className="text-muted-foreground">Overdue threshold</dt>
        <dd className="tabular-nums">
          {formatSgd(cents(oldPolicy.data.overdueBalanceThreshold))} →{" "}
          {formatSgd(cents(newPolicy.data.overdueBalanceThreshold))}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{newPolicy.data.basis === "due_date" ? "Grace days after due date" : "Historical invoice issue-age policy"}</dt>
        <dd>
          {oldPolicy.data.basis === "due_date" ? oldPolicy.data.overdueDaysThreshold ?? "None" : age(oldPolicy.data.overdueDaysThreshold)} →{" "}
          {newPolicy.data.basis === "due_date" ? newPolicy.data.overdueDaysThreshold ?? "None" : age(newPolicy.data.overdueDaysThreshold)}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Policy version</dt>
        <dd>
          {oldPolicy.data.version} → {newPolicy.data.version}
        </dd>
      </div>
    </dl>
  );
}
