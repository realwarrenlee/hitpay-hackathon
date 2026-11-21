"use client";
import { useState } from "react";
import Link from "next/link";
import { SearchIcon } from "lucide-react";
import { CreditBadge, ReviewDetail } from "@/components/review-detail";
import { MutationForm } from "@/components/mutation-form";
import { CopyReminder } from "@/components/copy-reminder";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { requestRemainderAction } from "@/app/actions";
import { formatDate } from "@/lib/presentation";
import type { reviewModel } from "@/server/views";
type Queue = ReturnType<typeof reviewModel>;

export function ReviewQueue({
  cards,
  feedback,
}: {
  cards: Queue["cards"];
  feedback?: string;
}) {
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const visible = cards.filter((card) =>
    `${card.payerName} ${card.rawRef} ${card.matchSummary} ${card.reason}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const open = cards.find((card) => card.creditId === openId);
  if (!cards.length)
    return (
      <EmptyState
        title="No incoming credits yet"
        description="Use Import bank file to add a DBS statement."
      />
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Incoming credits</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="relative w-full min-w-0 sm:w-80">
          <SearchIcon className="absolute top-3 left-3 size-4 text-muted-foreground" />
          <Input
            aria-label="Search credits"
            placeholder="Search payer, reference or invoice…"
            className="h-10 pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {visible.length ? (
          <>
            <div className="hidden xl:block">
              <Table aria-label="Incoming credits">
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Payer / reference</TableHead>
                    <TableHead className="text-right">Credit amount</TableHead>
                    <TableHead>Suggested invoice</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody aria-label="Review queue">
                  {visible.map((card) => (
                    <TableRow key={card.creditId}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatDate(card.valueDate)}
                      </TableCell>
                      <TableCell className="max-w-60 whitespace-normal">
                        <p className="font-medium">
                          {card.payerName || "Payer not identified"}
                        </p>
                        <p
                          className="mt-1 truncate text-xs text-muted-foreground"
                          title={card.rawRef}
                        >
                          {card.rawRef || "No reference"}
                        </p>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {card.amountLabel}
                      </TableCell>
                      <TableCell className="max-w-44 whitespace-normal text-sm">
                        {card.matchSummary}
                      </TableCell>
                      <TableCell>
                        <CreditBadge state={card.state} />
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setOpenId(card.creditId)}
                        >
                          Review<span className="sr-only"> {card.name}</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul aria-label="Review queue" className="grid gap-3 xl:hidden">
              {visible.map((card) => (
                <li
                  key={card.creditId}
                  className="space-y-3 rounded-lg border p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words font-medium">
                        {card.payerName || "Payer not identified"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDate(card.valueDate)}
                      </p>
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {card.amountLabel}
                    </span>
                  </div>
                  <p
                    className="truncate text-xs text-muted-foreground"
                    title={card.rawRef}
                  >
                    {card.rawRef || "No reference"}
                  </p>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm">{card.matchSummary}</p>
                    <CreditBadge state={card.state} />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setOpenId(card.creditId)}
                  >
                    Review<span className="sr-only"> {card.name}</span>
                  </Button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <EmptyState
            title="No matching credits"
            description="Try another payer, reference or invoice."
          />
        )}
        <Sheet
          open={Boolean(open)}
          onOpenChange={(value) => {
            if (!value) setOpenId(null);
          }}
        >
          <SheetContent className="w-full! max-w-none! gap-0 sm:w-[560px]! sm:max-w-[calc(100vw-2rem)]!">
            <div className="flex min-h-0 flex-1 flex-col">
              {open ? (
                <ReviewDetail
                  key={open.creditId}
                  card={open}
                  feedback={feedback}
                />
              ) : null}
            </div>
          </SheetContent>
        </Sheet>
      </CardContent>
    </Card>
  );
}

export function InvoicePanels({ invoices }: { invoices: Queue["invoices"] }) {
  const outstanding = invoices.filter((invoice) => invoice.remaining > 0);
  return (
    <section aria-labelledby="collect-invoices" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="collect-invoices" className="text-base font-semibold">Collect invoice balances</h2>
        <Link href="/customer" className="text-sm underline underline-offset-4">All customer invoices</Link>
      </div>
      {outstanding.length ? (
        <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {outstanding.map((invoice) => (
            <section key={invoice.id} aria-label={invoice.name} className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-medium">
                  <Link href={`/invoice/${invoice.id}`} className="hover:underline">{invoice.id}</Link>
                </h3>
                <StatusBadge>{invoice.status}</StatusBadge>
              </div>
              <p className="text-lg font-semibold tabular-nums">{invoice.remainingLabel}</p>
              <div className="mt-auto space-y-3">
                {!invoice.unresolvedReference && (
                  <MutationForm action={requestRemainderAction}>
                    <input type="hidden" name="invoiceId" value={invoice.id} />
                    <Button type="submit" variant="secondary">{invoice.requestLabel}</Button>
                  </MutationForm>
                )}
                {invoice.unresolvedReference ? (
                  <p role="alert" className="break-words text-sm">
                    Checkout unresolved: {invoice.unresolvedReference}. Check the provider before retrying.
                  </p>
                ) : null}
                {invoice.requestUrl && <CopyReminder url={invoice.requestUrl} />}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <EmptyState title="No outstanding invoice balances" description="Paid invoices remain in customer history." />
      )}
    </section>
  );
}
