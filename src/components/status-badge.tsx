import { Badge } from "@/components/ui/badge";

export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const colors = {
    neutral: "bg-muted text-muted-foreground",
    success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    warning: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    danger: "bg-red-500/10 text-red-700 dark:text-red-400",
  };
  return (
    <Badge
      variant="secondary"
      className={`h-auto min-h-5 max-w-full gap-1.5 rounded-md px-2 py-1 font-medium whitespace-normal ${colors[tone]}`}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-current" />
      {children}
    </Badge>
  );
}
