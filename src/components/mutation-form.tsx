"use client";
import { useFormStatus } from "react-dom";
function PendingFields({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <fieldset
      disabled={pending}
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
