import { AppSidebar } from "@/components/app-sidebar";
import { TallyBreadcrumb } from "@/components/tally-breadcrumb";
import { ThemeToggle } from "@/components/theme-toggle";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
export function Shell({
  today,
  children,
}: {
  today: string;
  mode: "fake" | "sandbox";
  children: React.ReactNode;
}) {
  return (
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
            <p
              className="hidden text-xs text-muted-foreground sm:block"
              title="Invoice ages and delivery policies are evaluated as of this date."
            >
              Policy date ·{" "}
              {new Intl.DateTimeFormat("en-SG", {
                day: "numeric",
                month: "short",
                year: "numeric",
                timeZone: "Asia/Singapore",
              }).format(new Date(today))}
            </p>
            <ThemeToggle />
          </div>
        </header>
        <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-6 px-4 pt-2 pb-4 md:px-6 md:pt-3 md:pb-6">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
