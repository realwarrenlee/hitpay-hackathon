"use client";
import { useState } from "react";
import Link from "next/link";
import type { AuditEvent } from "@/domain/types";
import { PolicyAuditDetails } from "@/components/policy-audit-details";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import {
  actionLabel,
  activityReason,
  formatDate,
  formatTime,
  newestActivity,
} from "@/lib/presentation";

function related(event: AuditEvent) {
  const label = `${actionLabel(event.entity)} · ${event.entityId}`;
  const path =
    event.entity === "invoice"
      ? "/invoice"
      : event.entity === "customer"
        ? "/customer"
        : event.entity === "delivery"
          ? "/deliveries"
          : null;
  return path ? (
    <Link
      href={`${path}/${event.entityId}`}
      className="underline-offset-4 hover:underline"
    >
      {label}
    </Link>
  ) : (
    <span>
      {label}
      {event.entity === "bank_credit" && event.evidence.kind === "csv_row"
        ? ` · line ${event.evidence.fileLine}`
        : ""}
    </span>
  );
}
function EventContext({ event }: { event: AuditEvent }) {
  const reason = activityReason(event);
  return (
    <>
      {reason ? (
        <p className="mt-1 break-words text-xs text-muted-foreground">{reason}</p>
      ) : null}
      {event.action === "policy_updated" ? (
        <PolicyAuditDetails before={event.before} after={event.after} />
      ) : null}
    </>
  );
}
export function ActivityTable({
  events,
  filterable = false,
}: {
  events: AuditEvent[];
  filterable?: boolean;
}) {
  const [search, setSearch] = useState("");
  const visible = newestActivity(events).filter((event) =>
    `${event.id} ${actionLabel(event.action)} ${event.entity} ${event.entityId} ${event.actor.kind === "human" ? event.actor.name : actionLabel(event.actor.kind)} ${activityReason(event) ?? ""} ${event.at} ${formatDate(event.at)} ${formatTime(event.at)} ${event.evidence.kind === "csv_row" ? `line ${event.evidence.fileLine}` : ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  if (!events.length)
    return (
      <EmptyState
        title="No activity yet"
        description="Imports, allocations and delivery decisions will appear here."
      />
    );
  return (
    <div className="space-y-4">
      {filterable ? (
        <Input
          aria-label="Search activity"
          placeholder="Search activity, reference or actor…"
          className="h-10 sm:max-w-sm"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      ) : null}
      {visible.length ? (
        <>
          <div className="hidden lg:block">
            <Table aria-label="Audit trail">
              <TableHeader>
                <TableRow>
                  <TableHead>Activity</TableHead>
                  <TableHead>Related entity</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="max-w-xs whitespace-normal align-top">
                      <p className="font-medium">{actionLabel(event.action)}</p>
                      <EventContext event={event} />
                    </TableCell>
                    <TableCell className="max-w-52 whitespace-normal break-words align-top text-sm">
                      {related(event)}
                      <p className="mt-1 text-xs text-muted-foreground">{event.id}</p>
                    </TableCell>
                    <TableCell className="max-w-40 whitespace-normal align-top text-sm">
                      {event.actor.kind === "human"
                        ? event.actor.name
                        : actionLabel(event.actor.kind)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap align-top text-xs text-muted-foreground">
                      <time dateTime={event.at}>{formatDate(event.at)}</time>
                    </TableCell>
                    <TableCell className="whitespace-nowrap align-top text-xs text-muted-foreground">
                      {formatTime(event.at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ol aria-label="Audit trail" className="space-y-3 lg:hidden">
            {visible.map((event) => (
              <li key={event.id} className="space-y-2 rounded-lg border p-4">
                <div className="flex flex-wrap justify-between gap-2">
                  <p className="font-medium">{actionLabel(event.action)}</p>
                  <time dateTime={event.at} className="text-xs text-muted-foreground">
                    {formatDate(event.at)} · {formatTime(event.at)}
                  </time>
                </div>
                <p className="break-words text-sm">{related(event)}</p>
                <p className="text-xs text-muted-foreground">
                  {event.actor.kind === "human"
                    ? event.actor.name
                    : actionLabel(event.actor.kind)}
                  {" · "}{event.id}
                </p>
                <EventContext event={event} />
              </li>
            ))}
          </ol>
        </>
      ) : (
        <EmptyState
          title="No matching activity"
          description="Try another reference, name or date."
        />
      )}
    </div>
  );
}
