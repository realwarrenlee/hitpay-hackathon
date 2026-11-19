export default function Loading() {
  return (
    <div role="status" aria-label="Loading page" className="space-y-6 p-6">
      <span className="sr-only">Loading…</span>
      <div className="h-8 w-48 animate-pulse rounded-lg bg-muted" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((item) => (
          <div
            key={item}
            className="h-32 animate-pulse rounded-xl border bg-muted/40"
          />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-xl border bg-muted/40" />
    </div>
  );
}
