import { LedgerAccessProvider } from "@/components/ledger-access";
import { localLedgerAccess } from "@/server/local-ledger-access";
import { AppSidebar } from "@/components/app-sidebar";
import { TallyBreadcrumb } from "@/components/tally-breadcrumb";
import { ThemeToggle } from "@/components/theme-toggle";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <LedgerAccessProvider value={localLedgerAccess()}>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="min-w-0">
          <header className="flex h-16 shrink-0 items-center gap-2">
            <div className="flex items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator
                orientation="vertical"
                className="mr-2 data-vertical:h-4 data-vertical:self-auto"
              />
              <TallyBreadcrumb />
            </div>
            <div className="ml-auto flex items-center gap-3 pr-4">
              <ThemeToggle />
            </div>
          </header>
          <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-6 px-4 pt-2 pb-4 md:px-6 md:pt-3 md:pb-6">
            {!localLedgerAccess() ? (
              <p
                role="status"
                className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground"
              >
                Supplier actions are locked. Use the explicitly enabled local
                supplier demo to create records, review payments and make
                delivery decisions.
              </p>
            ) : null}
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </LedgerAccessProvider>
  );
}
