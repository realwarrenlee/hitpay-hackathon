"use client";
import { useLedgerAccess } from "@/components/ledger-access";
import { useFormStatus } from "react-dom";
function PendingFields({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  const editable = useLedgerAccess();
  return (
    <fieldset
      disabled={pending || !editable}
      className="min-w-0 contents"
      aria-busy={pending}
    >
      {children}
      {pending && (
        <span role="status" className="sr-only">
          Processing…
        </span>
      )}
    </fieldset>
  );
}
export function MutationForm({
  children,
  confirmMessage,
  ...props
}: React.ComponentProps<"form"> & { confirmMessage?: string }) {
  return (
    <form
      {...props}
      onSubmit={(event) => {
        if (confirmMessage && !window.confirm(confirmMessage))
          event.preventDefault();
      }}
    >
      <PendingFields>{children}</PendingFields>
    </form>
  );
}
