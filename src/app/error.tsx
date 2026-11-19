"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function DeskError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <h1 className="font-heading text-2xl">Unable to load Tally</h1>
      <p className="mt-2 text-sm text-muted-foreground">The request could not be completed. Check your connection and try again. If the problem continues, contact your administrator.</p>
      <Button type="button" className="mt-4" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
