import type { LucideIcon } from "lucide-react";
export function StatTiles({
  tiles,
}: {
  tiles: {
    label: string;
    value: string;
    hint: string;
    icon: LucideIcon;
    tone?: string;
  }[];
}) {
  return (
    <div
      className={`grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 ${tiles.length === 3 ? "xl:grid-cols-3" : "xl:grid-cols-4"}`}
    >
      {tiles.map((tile) => (
        <div key={tile.label} className="min-w-0 rounded-xl border bg-card p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">{tile.label}</p>
            <tile.icon className="size-4 shrink-0 text-muted-foreground" />
          </div>
          <p className="mt-5 break-words text-[26px] font-semibold leading-tight tracking-tight tabular-nums">
            {tile.value}
          </p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {tile.hint}
          </p>
        </div>
      ))}
    </div>
  );
}
