import { overdueBalance } from "@/domain/balances";
import { sum } from "@/domain/money";
import type { LedgerSnapshot } from "@/domain/types";
export function customerBalances(snapshot: LedgerSnapshot) {
  return [...snapshot.customers.values()].map((customer) => {
    const invoices = [...snapshot.invoices.values()].filter(
      (invoice) => invoice.customerId === customer.id,
    );
    return {
      id: customer.id,
      name: customer.name,
      hold: customer.hold.status,
      outstanding: sum(invoices.map((invoice) => invoice.remaining)),
      overdue: overdueBalance(
        invoices.map((invoice) => ({
          invoice,
          balance: {
            allocated: invoice.allocated,
            writtenOff: invoice.writtenOff,
            remaining: invoice.remaining,
            status: invoice.status,
          },
        })),
        snapshot.settings,
        snapshot.today,
      ),
      invoices: invoices.filter((invoice) => invoice.status !== "paid").length,
    };
  });
}
