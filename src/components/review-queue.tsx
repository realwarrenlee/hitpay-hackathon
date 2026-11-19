"use client";
import { useState } from "react";
import Link from "next/link";
import { SearchIcon } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { MutationForm } from "@/components/mutation-form";
import { CopyReminder } from "@/components/copy-reminder";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  approveAction,
  approveSplitAction,
  rejectAction,
  requestRemainderAction,
  undoAction,
} from "@/app/actions";
import type { reviewModel } from "@/server/views";
type Queue = ReturnType<typeof reviewModel>;
function CreditBadge({ state }: { state: string }) {
  return (
    <StatusBadge
      tone={
        state === "Reconciled"
          ? "success"
          : state === "Suggested" || state === "Unmatched"
            ? "warning"
            : "neutral"
      }
    >
      {state}
    </StatusBadge>
  );
}
function creditDate(value: string) {
  return new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Singapore",
  }).format(new Date(value));
}
function Actions({ card }: { card: Queue["cards"][number] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {card.kind === "single" &&
        card.suggestionId &&
        card.state === "Suggested" && (
          <MutationForm action={approveAction}>
            <input
              type="hidden"
              name="suggestionId"
              value={card.suggestionId}
            />
            <Button type="submit">Approve</Button>
          </MutationForm>
        )}
      {card.kind === "split" &&
        card.suggestionId &&
        card.state === "Suggested" && (
          <MutationForm action={approveSplitAction}>
            <input
              type="hidden"
              name="suggestionId"
              value={card.suggestionId}
            />
            <Button type="submit">Approve split</Button>
          </MutationForm>
        )}
      {card.kind === "choose_one" &&
        card.suggestionId &&
        card.state === "Suggested" &&
        card.candidates.map((invoiceId) => (
          <MutationForm key={invoiceId} action={approveAction}>
            <input
              type="hidden"
              name="suggestionId"
              value={card.suggestionId ?? ""}
            />
            <input type="hidden" name="pick" value={invoiceId} />
            <Button type="submit" variant="secondary">
              Pick {invoiceId}
            </Button>
          </MutationForm>
        ))}
      {card.suggestionId && card.state === "Suggested" && (
        <MutationForm action={rejectAction}>
          <input type="hidden" name="suggestionId" value={card.suggestionId} />
          <Button type="submit" variant="ghost">
            Reject
          </Button>
        </MutationForm>
      )}
      {card.undoId && !card.committed && (
        <MutationForm action={undoAction}>
          <input type="hidden" name="allocationId" value={card.undoId} />
          <Button type="submit" variant="outline">
            Undo
          </Button>
        </MutationForm>
      )}
      {card.state === "Unmatched" && (
        <span className="text-xs text-muted-foreground">
          No match available
        </span>
      )}
    </div>
  );
}
export function ReviewQueue({ cards }: { cards: Queue["cards"] }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All statuses");
  const visible = cards.filter(
    (card) =>
      `${card.name} ${card.rawRef} ${card.payerName} ${card.reason}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (filter === "All statuses" || filter === card.state),
  );
  if (!cards.length)
    return (
      <EmptyState
        title="Ready for your first bank file"
        description="Import a DBS CSV to review incoming credits and suggested invoice matches."
        action={
          <Link
            href="/import"
            className="text-sm font-medium underline underline-offset-4"
          >
            Import bank file →
          </Link>
        }
      />
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Incoming credits</CardTitle>
        <CardDescription>
          {cards.length} credits · approve a match to allocate its balance
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-5 flex flex-wrap gap-3">
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <SearchIcon className="absolute left-3 top-3 size-4 text-muted-foreground" />
            <Input
              aria-label="Search credits"
              placeholder="Search reference, payer or match…"
              className="h-10 pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            aria-label="Filter credits by status"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="h-10 rounded-lg border bg-background px-3 text-sm"
          >
            {[
              "All statuses",
              "Suggested",
              "Unmatched",
              "Approved",
              "Reconciled",
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </div>
        {visible.length ? (
          <>
            <ul aria-label="Review queue" className="grid gap-4 lg:hidden">
              {visible.map((card) => (
                <li key={card.creditId}>
                  <article
                    aria-label={card.name}
                    className="rounded-lg border p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h3 className="font-medium">{card.name}</h3>
                      <CreditBadge state={card.state} />
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-3">
                      <span className="text-xs text-muted-foreground">
                        {creditDate(card.valueDate)}
                      </span>
                      <span className="font-semibold tabular-nums">
                        {card.amountLabel}
                      </span>
                    </div>
                    <p className="mt-3 break-words text-sm">
                      {card.payerName || card.rawRef}
                    </p>
                    <p className="mt-2 break-words text-xs text-muted-foreground">
                      {card.rawRef}
                    </p>
                    {card.shortfallLabel && (
                      <p className="mt-3 text-sm">{card.shortfallLabel}</p>
                    )}
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">
                      {card.reason}
                    </p>
                    {card.ai && (
                      <p className="mt-2 text-sm text-muted-foreground">
                        Reference insight: {card.ai}
                      </p>
                    )}
                    <div className="mt-4">
                      <Actions card={card} />
                    </div>
                  </article>
                </li>
              ))}
            </ul>
            <div className="hidden lg:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Transaction</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Match details</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody aria-label="Review queue">
                  {visible.map((card) => (
                    <TableRow key={card.creditId}>
                      <TableCell className="min-w-36 max-w-52 whitespace-normal">
                        <article aria-label={card.name}>
                          <p className="font-medium">{card.name}</p>
                          <p className="mt-1 break-words text-xs text-muted-foreground">
                            {card.payerName}
                          </p>
                          <p className="mt-1 break-all text-xs text-muted-foreground">
                            {card.rawRef}
                          </p>
                        </article>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {creditDate(card.valueDate)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {card.amountLabel}
                      </TableCell>
                      <TableCell>
                        <CreditBadge state={card.state} />
                      </TableCell>
                      <TableCell className="min-w-48 max-w-sm whitespace-normal text-sm leading-6">
                        {card.shortfallLabel && (
                          <p className="font-medium">{card.shortfallLabel}</p>
                        )}
                        <p className="text-muted-foreground">{card.reason}</p>
                        {card.ai && (
                          <p className="mt-2 text-xs text-muted-foreground">
                            Reference insight: {card.ai}
                          </p>
                        )}
                        {card.preselected && card.state === "Suggested" && (
                          <p className="mt-2 text-xs font-medium">
                            Preselected for approval
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="min-w-40">
                        <Actions card={card} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        ) : (
          <EmptyState
            title="No matching credits"
            description="Try another search or choose a different status."
          />
        )}
      </CardContent>
    </Card>
  );
}
export function InvoicePanels({ invoices }: { invoices: Queue["invoices"] }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Invoice balances</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Collect outstanding balances with an exact payment request.
        </p>
      </div>
      <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {invoices.map((invoice) => (
          <section
            key={invoice.id}
            aria-label={invoice.name}
            className="min-w-0 rounded-xl border bg-card p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-medium">
                <Link
                  href={`/invoice/${invoice.id}`}
                  className="hover:underline"
                >
                  {invoice.name}
                </Link>
              </h3>
              <StatusBadge
                tone={invoice.status === "Paid" ? "success" : "neutral"}
              >
                {invoice.status}
              </StatusBadge>
            </div>
            <p role="status" className="sr-only">
              {invoice.status}
            </p>
            <p className="mt-4 text-lg font-semibold tabular-nums">
              {invoice.remainingLabel}
            </p>
            {invoice.status !== "Paid" && (
              <MutationForm action={requestRemainderAction} className="mt-5">
                <input type="hidden" name="invoiceId" value={invoice.id} />
                <Button type="submit" variant="secondary">
                  {invoice.requestLabel}
                </Button>
              </MutationForm>
            )}
            {invoice.requestUrl && <CopyReminder url={invoice.requestUrl} />}
          </section>
        ))}
      </div>
    </section>
  );
}
