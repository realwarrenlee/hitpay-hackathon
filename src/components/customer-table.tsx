"use client";
import { useState } from "react";
import Link from "next/link";
import { SearchIcon, ArrowUpDownIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { FilterChips } from "@/components/filter-chips";
import { EmptyState } from "@/components/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatSgd } from "@/domain/money";
import type { customerBalances } from "@/server/dashboard";
export function CustomerTable({
  rows,
}: {
  rows: ReturnType<typeof customerBalances>;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"name" | "overdue">("name");
  const visible = rows
    .filter((row) => row.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name) : b.overdue - a.overdue,
    );
  return (
    <>
      <div className="relative mb-4 max-w-sm">
        <SearchIcon className="absolute top-3 left-3 size-4 text-muted-foreground" />
        <Input
          aria-label="Search customers"
          placeholder="Search customers…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-10 pl-9"
        />
      </div>
      <div className="mb-4 lg:hidden">
        <FilterChips
          label="Sort customers"
          value={sort}
          onChange={(value) =>
            setSort(value === "overdue" ? "overdue" : "name")
          }
          options={[
            { value: "name", label: "Customer name" },
            { value: "overdue", label: "Highest overdue" },
          ]}
        />
      </div>
      {visible.length ? (
        <>
          <div className="hidden lg:block">
            <Table aria-label="Customer balances">
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <Button
                      variant="ghost"
                      onClick={() => setSort("name")}
                      className="px-0 text-xs"
                    >
                      Customer
                      <ArrowUpDownIcon className="size-3" />
                    </Button>
                  </TableHead>
                  <TableHead>Credit control</TableHead>
                  <TableHead className="text-right">Unpaid invoices</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead className="text-right">
                    <Button
                      variant="ghost"
                      onClick={() => setSort("overdue")}
                      className="px-0 text-xs"
                    >
                      Overdue
                      <ArrowUpDownIcon className="size-3" />
                    </Button>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="min-w-44 max-w-72 whitespace-normal">
                      <Link
                        href={`/customer/${row.id}`}
                        className="font-medium hover:underline"
                      >
                        {row.name}
                      </Link>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {row.id}
                      </p>
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        tone={
                          row.hold === "pay_first"
                            ? "danger"
                            : row.hold === "proposed"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {row.hold === "pay_first"
                          ? "Pay-first hold"
                          : row.hold === "proposed"
                            ? "Pay-first proposed"
                            : "No active hold"}
                      </StatusBadge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.invoices}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatSgd(row.outstanding)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatSgd(row.overdue)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul aria-label="Customer balances" className="grid gap-3 lg:hidden">
            {visible.map((row) => (
              <li key={row.id} className="space-y-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Link
                    href={`/customer/${row.id}`}
                    className="font-medium hover:underline"
                  >
                    {row.name}
                  </Link>
                  <StatusBadge
                    tone={
                      row.hold === "pay_first"
                        ? "danger"
                        : row.hold === "proposed"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {row.hold === "pay_first"
                      ? "Pay-first hold"
                      : row.hold === "proposed"
                        ? "Pay-first proposed"
                        : "No active hold"}
                  </StatusBadge>
                </div>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Unpaid invoices</dt>
                    <dd>{row.invoices}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Outstanding</dt>
                    <dd className="font-medium tabular-nums">
                      {formatSgd(row.outstanding)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Overdue</dt>
                    <dd className="tabular-nums">{formatSgd(row.overdue)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <EmptyState
          title={search ? "No matching customers" : "No customers yet"}
          description={
            search
              ? "Try a different name or clear your search."
              : "Customer balances will appear when records are available."
          }
        />
      )}
    </>
  );
}
