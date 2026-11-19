import type { AuditEvent } from "@/domain/types";
import { PolicyAuditDetails } from "@/components/policy-audit-details";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
const actionNames: Record<string, string> = {
  policy_updated: "Overdue policy changed",
  seeded: "Workspace initialized",
  mcp_created: "Payment link created",
  hint_recorded: "Reference read",
  webhook_confirmed: "Payment confirmed",
  check_cutoff: "Delivery policy checked",
  ai: "AI",
};
export function actionLabel(action: string) {
  return (
    actionNames[action] ??
    action
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replaceAll("_", " ")
      .replace(/^./, (c) => c.toUpperCase())
  );
}
export function ActivityTable({ events }: { events: AuditEvent[] }) {
  if (!events.length)
    return (
      <EmptyState
        title="No activity yet"
        description="Imports, approvals and delivery decisions will appear here."
      />
    );
  return (
    <Table aria-label="Audit trail" className="min-w-[640px]">
      <TableHeader>
        <TableRow>
          <TableHead>Action</TableHead>
          <TableHead>Entity</TableHead>
          <TableHead>Actor</TableHead>
          <TableHead className="text-right">Time · SGT</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map((event) => (
          <TableRow key={event.id}>
            <TableCell className="min-w-40 whitespace-normal">
              <p className="font-medium" title={event.action}>{actionLabel(event.action)}</p>
              {event.action === "policy_updated" && <PolicyAuditDetails before={event.before} after={event.after}/>}
              {event.evidence.kind === "human_reason" && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {event.evidence.reason === "demo world"
                    ? "Opening records"
                    : event.evidence.reason}
                </p>
              )}
              {event.evidence.kind === "csv_row" && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Bank file · line {event.evidence.fileLine}
                </p>
              )}
            </TableCell>
            <TableCell className="min-w-36 max-w-64 whitespace-normal break-words">
              <p className="text-xs capitalize text-muted-foreground">
                {actionLabel(event.entity)}
              </p>
              {event.entityId}
            </TableCell>
            <TableCell>
              {event.actor.kind === "human"
                ? event.actor.name
                : actionLabel(event.actor.kind)}
            </TableCell>
            <TableCell className="whitespace-nowrap text-right text-xs text-muted-foreground">
              <time dateTime={event.at}>
                {new Intl.DateTimeFormat("en-SG", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "Asia/Singapore",
                }).format(new Date(event.at))}
              </time>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
