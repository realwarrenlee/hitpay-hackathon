"use client";
import { useState } from "react";
import Link from "next/link";
import { SearchIcon, ArrowUpDownIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
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
      {visible.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Button
                  variant="ghost"
                  onClick={() => setSort("name")}
                  className="-ml-3 text-xs"
                >
                  Customer
                  <ArrowUpDownIcon className="size-3" />
                </Button>
              </TableHead>
              <TableHead>Delivery status</TableHead>
              <TableHead className="text-right">Open invoices</TableHead>
              <TableHead className="text-right">Outstanding</TableHead>
              <TableHead className="text-right">
                <Button
                  variant="ghost"
                  onClick={() => setSort("overdue")}
                  className="-mr-3 text-xs"
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
                  <p className="mt-1 text-xs text-muted-foreground">{row.id}</p>
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
                        ? "Hold proposed"
                        : "On credit"}
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
