"use client";
import { useLedgerAccess } from "@/components/ledger-access";
import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  UploadCloudIcon,
  FileSpreadsheetIcon,
  LoaderCircleIcon,
} from "lucide-react";
import { importAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
function ImportSubmit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  const editable = useLedgerAccess();
  return (
    <Button type="submit" disabled={pending || disabled || !editable} className="min-w-36">
      {pending ? (
        <>
          <LoaderCircleIcon className="size-4 animate-spin" />
          Importing…
        </>
      ) : (
        "Import transactions"
      )}
    </Button>
  );
}
export function ImportUpload() {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  function selectFile(next: File | null) {
    setFile(next);
    setError(
      next && !next.name.toLowerCase().endsWith(".csv")
        ? "Choose a DBS export with a .csv extension."
        : next && next.size === 0
          ? "This file is empty. Choose a CSV with bank transactions."
          : "",
    );
  }
  return (
    <form
      action={importAction}
      className="flex flex-1 flex-col gap-5"
      onSubmit={(event) => {
        if (error || !file) event.preventDefault();
      }}
    >
      <div
        className={`relative flex min-h-64 flex-1 flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center transition-colors ${dragging ? "border-foreground bg-muted" : "border-input bg-background/40 hover:bg-muted/30"}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const dropped = event.dataTransfer.files;
          if (input.current && dropped.length) {
            const transfer = new DataTransfer();
            transfer.items.add(dropped[0]);
            input.current.files = transfer.files;
            selectFile(dropped[0]);
          }
        }}
      >
        <div className="mb-4 flex size-12 items-center justify-center rounded-xl border bg-card">
          <UploadCloudIcon className="size-6 text-muted-foreground" />
        </div>
        <p className="font-medium">Drop your bank file here</p>
        <p className="mt-2 text-sm text-muted-foreground">
          or choose a file from your device
        </p>
        <label className="mt-5 cursor-pointer rounded-lg border bg-card px-4 py-2 text-sm font-medium hover:bg-muted focus-within:outline-2 focus-within:outline-ring">
          Choose CSV file
          <input
            ref={input}
            aria-label="Bank CSV"
            name="file"
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            required
            onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
          />
        </label>
      </div>
      {file && (
        <div className="flex items-center gap-3 rounded-lg border p-3">
          <FileSpreadsheetIcon className="size-5 shrink-0 text-muted-foreground" />
          <p className="min-w-0 break-all text-sm font-medium">{file.name}</p>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <ImportSubmit disabled={Boolean(error) || !file} />
      </div>
    </form>
  );
}
