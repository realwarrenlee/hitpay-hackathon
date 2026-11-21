"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { saveEntryAction } from "@/app/entries/actions";
import { useLedgerAccess } from "@/components/ledger-access";

export function EntryForm({
  kind,
  customers,
  today,
  tomorrow,
  customerId = "",
}: {
  kind: "invoice" | "delivery";
  customers: { id: string; name: string }[];
  today: string;
  tomorrow: string;
  customerId?: string;
}) {
  const router = useRouter();
  const editable = useLedgerAccess();
  const [pending, start] = useTransition();
  const [values, setValues] = useState<Record<string, string>>(
    kind === "invoice"
      ? { id: "", customerId, amount: "", issuedOn: today, dueOn: "" }
      : { id: "", customerId, amount: "", scheduledFor: tomorrow },
  );
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fields =
    kind === "invoice"
      ? [
          ["id", "Invoice reference", "text"],
          ["amount", "Invoice amount (SGD)", "text"],
          ["issuedOn", "Issue date", "date"],
          ["dueOn", "Payment due date", "date"],
        ]
      : [
          ["id", "Delivery reference", "text"],
          ["amount", "Delivery amount (SGD)", "text"],
          ["scheduledFor", "Scheduled date", "date"],
        ];
  const update = (name: string, value: string) => {
    setValues((old) => ({ ...old, [name]: value }));
    setErrors((old) => ({ ...old, [name]: "" }));
    setMessage("");
  };
  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        start(async () => {
          setMessage("");
          try {
            const result = await saveEntryAction(kind, values);
            if (result.ok) {
              router.push(
                `${kind === "invoice" ? "/invoice" : "/deliveries"}/${result.id}?status=${encodeURIComponent(result.existing ? "Existing record opened; no duplicate created." : `${kind === "invoice" ? "Invoice" : "Delivery"} created.`)}`,
              );
              router.refresh();
            } else {
              setMessage(result.message);
              setErrors(result.errors ?? {});
            }
          } catch {
            setMessage(
              "Unable to reach the server. Your entries are retained; retry with the same reference.",
            );
          }
        });
      }}
    >
      <fieldset
        disabled={!editable || pending || customers.length === 0}
        className="grid min-w-0 gap-5 md:grid-cols-2"
        aria-busy={pending}
      >
        <div className="space-y-2 md:col-span-2">
          <label htmlFor="customerId" className="text-sm font-medium">
            Customer
          </label>
          <select
            id="customerId"
            required
            value={values.customerId}
            onChange={(event) => update("customerId", event.target.value)}
            className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            aria-invalid={Boolean(errors.customerId)}
            aria-describedby={
              errors.customerId ? "customerId-error" : undefined
            }
          >
            <option value="">Choose an existing customer</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name} · {customer.id}
              </option>
            ))}
          </select>
          {errors.customerId ? (
            <p
              id="customerId-error"
              className="text-sm text-red-700 dark:text-red-400"
            >
              {errors.customerId}
            </p>
          ) : null}
        </div>
        {fields.map(([name, label, type]) => (
          <div key={name} className="space-y-2">
            <label htmlFor={name} className="text-sm font-medium">
              {label}
            </label>
            <Input
              id={name}
              name={name}
              type={type}
              required
              value={values[name]}
              inputMode={name === "amount" ? "decimal" : undefined}
              maxLength={type === "text" ? 100 : undefined}
              onChange={(event) => update(name, event.target.value)}
              aria-invalid={Boolean(errors[name])}
              aria-describedby={`${name}-help${errors[name] ? ` ${name}-error` : ""}`}
            />
            <p id={`${name}-help`} className="text-xs text-muted-foreground">
              {name === "id"
                ? `${kind === "invoice" ? "INV- followed by 3–6 digits" : "DLV- followed by 3–9 digits"}. Reuse this reference if a submission times out.`
                : name === "dueOn"
                  ? "Agreed due date is required. The invoice is not overdue on this day."
                  : name === "amount"
                    ? "Positive SGD amount, up to two decimal places."
                    : "Calendar date; evaluations use the configured policy date."}
            </p>
            {errors[name] ? (
              <p
                id={`${name}-error`}
                className="text-sm text-red-700 dark:text-red-400"
              >
                {errors[name]}
              </p>
            ) : null}
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3 md:col-span-2">
          <Button type="submit">
            {pending ? "Saving…" : `Create ${kind}`}
          </Button>
          <Link
            href="/deliveries"
            className="text-sm underline underline-offset-4"
          >
            Cancel
          </Link>
        </div>
      </fieldset>
      {!customers.length ? (
        <p role="status">
          No customers are available. This milestone uses existing customers.
        </p>
      ) : null}
      {message ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {message}
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground">
        {kind === "delivery"
          ? "Creating a delivery does not evaluate credit, approve a hold or request payment. Review it next."
          : "Creating an invoice records the agreed obligation. It does not collect payment or approve a delivery hold."}
      </p>
    </form>
  );
}
