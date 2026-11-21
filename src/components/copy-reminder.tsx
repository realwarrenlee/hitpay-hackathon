"use client";
import { useState } from "react";
import { CopyIcon, CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
export function CopyReminder({ url }: { url: string }) {
  const [status, setStatus] = useState("");
  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setStatus("Payment link copied.");
            } catch {
              setStatus(
                "Could not copy. Select the payment link below to copy it manually.",
              );
            }
          }}
        >
          {status === "Payment link copied." ? (
            <CheckIcon className="size-4" />
          ) : (
            <CopyIcon className="size-4" />
          )}
          Copy payment link
        </Button>
        <a
          href={url}
          className="inline-flex items-center text-sm underline underline-offset-4"
        >
          Open payment link ↗
        </a>
      </div>
      <p className="break-all text-xs text-muted-foreground">{url}</p>
      {status && (
        <p role="status" className="text-xs">
          {status}
        </p>
      )}
    </div>
  );
}
