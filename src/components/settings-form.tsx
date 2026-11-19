"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@base-ui/react/dialog";
import { LoaderCircleIcon, ShieldAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { parsePolicyInput, MAX_POLICY_DAYS } from "@/domain/policy";
import { formatAmount, formatSgd, parseSgd } from "@/domain/money";
import { savePolicyAction, reloadPolicyAction } from "@/app/settings/actions";
import type { PolicyView, PolicySaveResult } from "@/server/policy";
function moneyLabel(value: string) {
  const money = parseSgd(value);
  return money.ok ? formatSgd(money.value) : value;
}
function ageLabel(value: number | null) {
  return value === null
    ? "No minimum age"
    : `Older than ${value} calendar days`;
}
export function SettingsForm({
  initial,
  editable,
  autoApprove,
}: {
  initial: PolicyView;
  editable: boolean;
  autoApprove: boolean;
}) {
  const router = useRouter();
  const [baseline, setBaseline] = useState(initial);
  const [threshold, setThreshold] = useState(initial.threshold);
  const [ageMode, setAgeMode] = useState<"none" | "custom">(
    initial.minimumDays === null ? "none" : "custom",
  );
  const [days, setDays] = useState(
    initial.minimumDays === null ? "" : String(initial.minimumDays),
  );
  const [result, setResult] = useState<PolicySaveResult | null>(null);
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [pending, startTransition] = useTransition();
  const payload = {
    threshold,
    ageMode,
    minimumDays: ageMode === "none" ? "" : days,
    expectedVersion: baseline.version,
  };
  const parsed = parsePolicyInput(payload);
  const dirty = parsed.ok
    ? formatAmount(parsed.values.overdueBalanceThreshold) !==
        baseline.threshold ||
      parsed.values.overdueDaysThreshold !== baseline.minimumDays
    : threshold !== baseline.threshold ||
      days !== String(baseline.minimumDays ?? "") ||
      ageMode !== (baseline.minimumDays === null ? "none" : "custom");
  const errors = parsed.ok ? {} : parsed.errors;
  function reset(policy: PolicyView) {
    setBaseline(policy);
    setThreshold(policy.threshold);
    setAgeMode(policy.minimumDays === null ? "none" : "custom");
    setDays(policy.minimumDays === null ? "" : String(policy.minimumDays));
  }
  function save() {
    setConfirm(false);
    setNotice("");
    setResult(null);
    startTransition(async () => {
      try {
        const response = await savePolicyAction(payload);
        setResult(response);
        if (response.ok) {
          reset(response.policy);
          setNotice(
            "Policy saved. Future evaluations will use the new configuration.",
          );
          router.refresh();
        }
      } catch {
        setNotice(
          "Save could not be confirmed. Your edits are kept. Reload the latest configuration before retrying.",
        );
      }
    });
  }
  function reload() {
    startTransition(async () => {
      try {
        const policy = await reloadPolicyAction();
        reset(policy);
        setResult(null);
        setNotice("Latest configuration loaded.");
        router.refresh();
      } catch {
        setNotice(
          "Unable to reload the policy. Check your connection and try again.",
        );
      }
    });
  }
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-lg border border-amber-500/25 bg-amber-500/5 p-4 text-sm">
        <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
        <div>
          <p className="font-medium">
            {editable
              ? "Local-only development editing"
              : "Policy editing is locked"}
          </p>
          <p className="mt-1 leading-6 text-muted-foreground">
            {editable
              ? "Unauthenticated editing is enabled only on this computer’s loopback development server. Authentication is required before real-world use."
              : "Policy values are visible, but writes require the explicit loopback development launcher. Production and network writes are disabled."}
          </p>
        </div>
      </div>
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Reconciliation & delivery</CardTitle>
          <CardDescription>
            Changes apply to future evaluations. Existing approved holds stay
            unchanged.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (editable && parsed.ok && dirty && !pending) setConfirm(true);
            }}
            className="space-y-6"
          >
            <fieldset
              disabled={!editable || pending}
              className="min-w-0 divide-y disabled:opacity-80"
            >
              <div className="grid gap-4 pb-6 md:grid-cols-[minmax(0,1fr)_minmax(200px,280px)] md:gap-8">
                <div className="max-w-xl">
                  <label htmlFor="overdue-threshold" className="font-medium">
                    Overdue threshold
                  </label>
                  <p
                    id="threshold-help"
                    className="mt-1 text-sm leading-6 text-muted-foreground"
                  >
                    A hold is proposed only when eligible overdue balances
                    exceed this amount. Human approval is still required.
                  </p>
                </div>
                <div>
                  <label
                    className="mb-2 block text-xs text-muted-foreground"
                    htmlFor="overdue-threshold"
                  >
                    Amount in SGD
                  </label>
                  <Input
                    id="overdue-threshold"
                    aria-describedby={`threshold-help${errors.threshold ? " threshold-error" : ""}`}
                    aria-invalid={Boolean(errors.threshold)}
                    inputMode="decimal"
                    value={threshold}
                    onChange={(event) => {
                      setThreshold(event.target.value);
                      setResult(null);
                      setNotice("");
                    }}
                    className="h-10 tabular-nums"
                  />
                  {errors.threshold && (
                    <p
                      id="threshold-error"
                      className="mt-2 text-xs leading-5 text-red-600 dark:text-red-400"
                    >
                      {errors.threshold}
                    </p>
                  )}
                </div>
              </div>
              <div className="grid gap-4 py-6 md:grid-cols-[minmax(0,1fr)_minmax(200px,280px)] md:gap-8">
                <div className="max-w-xl">
                  <label htmlFor="minimum-age-mode" className="font-medium">
                    Minimum overdue age
                  </label>
                  <p
                    id="age-help"
                    className="mt-1 text-sm leading-6 text-muted-foreground"
                  >
                    Calendar days from invoice issue date, using the policy date
                    in Singapore time. No minimum includes today’s invoices.
                    Future-dated invoices are excluded.
                  </p>
                </div>
                <div className="space-y-3">
                  <select
                    id="minimum-age-mode"
                    aria-describedby="age-help"
                    value={ageMode}
                    onChange={(event) => {
                      setAgeMode(event.target.value as "none" | "custom");
                      setResult(null);
                      setNotice("");
                    }}
                    className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
                  >
                    <option value="none">No minimum age</option>
                    <option value="custom">Custom minimum age</option>
                  </select>
                  {ageMode === "custom" && (
                    <div>
                      <label
                        htmlFor="minimum-days"
                        className="mb-2 block text-xs text-muted-foreground"
                      >
                        Invoices older than (calendar days)
                      </label>
                      <Input
                        id="minimum-days"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={MAX_POLICY_DAYS}
                        step={1}
                        value={days}
                        aria-invalid={Boolean(errors.minimumDays)}
                        aria-describedby={
                          errors.minimumDays ? "days-error" : undefined
                        }
                        onChange={(event) => {
                          setDays(event.target.value);
                          setResult(null);
                          setNotice("");
                        }}
                        className="h-10"
                      />
                      {errors.minimumDays && (
                        <p
                          id="days-error"
                          className="mt-2 text-xs leading-5 text-red-600 dark:text-red-400"
                        >
                          {errors.minimumDays}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </fieldset>
            <div className="grid gap-4 border-t pt-6 md:grid-cols-[minmax(0,1fr)_minmax(200px,280px)] md:gap-8">
              <div className="max-w-xl">
                <p className="font-medium">Auto-approve remainder payments</p>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  Eligible verified remainder payments{" "}
                  {autoApprove
                    ? "may reconcile automatically"
                    : "require approval"}
                  . Bank CSV matches always need human approval. This setting is
                  read-only.
                </p>
              </div>
              <div className="md:justify-self-end">
                <StatusBadge tone={autoApprove ? "success" : "neutral"}>
                  {autoApprove ? "Enabled" : "Disabled"}
                </StatusBadge>
              </div>
            </div>
            {!parsed.ok && errors.form && (
              <p
                role="alert"
                className="text-sm text-red-600 dark:text-red-400"
              >
                {errors.form}
              </p>
            )}
            {result && !result.ok && (
              <div
                role="alert"
                className="space-y-3 rounded-lg border border-red-500/25 p-4 text-sm"
              >
                <p>{result.message}</p>
                {result.errors &&
                  Object.values(result.errors).map((message) => (
                    <p key={message}>{message}</p>
                  ))}
                {result.code === "conflict" && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={reload}
                    disabled={pending}
                  >
                    Reload latest and discard edits
                  </Button>
                )}
              </div>
            )}
            {notice && (
              <p
                role="status"
                className="rounded-lg border p-3 text-sm leading-6"
              >
                {notice}
                {notice.startsWith("Save could not") && (
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-3 block"
                    onClick={reload}
                    disabled={pending}
                  >
                    Reload latest and discard edits
                  </Button>
                )}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-5">
              <p className="text-xs text-muted-foreground">
                Policy version {baseline.version}
                {dirty ? " · Unsaved changes" : ""}
              </p>
              {editable && (
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={!dirty || pending}
                    onClick={() => {
                      reset(baseline);
                      setResult(null);
                      setNotice("");
                    }}
                  >
                    Discard changes
                  </Button>
                  <Button
                    type="submit"
                    disabled={!dirty || !parsed.ok || pending}
                  >
                    {pending ? (
                      <>
                        <LoaderCircleIcon className="size-4 animate-spin" />
                        Saving…
                      </>
                    ) : (
                      "Save changes"
                    )}
                  </Button>
                </div>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
      <Dialog.Root open={confirm} onOpenChange={setConfirm}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/50" />
          <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-card p-6 text-card-foreground shadow-lg">
            <Dialog.Title className="text-lg font-semibold">
              Confirm policy changes
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-sm leading-6 text-muted-foreground">
              Future evaluations will use this policy. Saving does not run an
              evaluation or approve any holds. Existing approved holds and
              historical transactions stay unchanged.
            </Dialog.Description>
            <dl className="my-5 space-y-4 text-sm">
              <div>
                <dt className="text-muted-foreground">Overdue threshold</dt>
                <dd className="mt-1 font-medium tabular-nums">
                  {moneyLabel(baseline.threshold)} →{" "}
                  {parsed.ok
                    ? formatSgd(parsed.values.overdueBalanceThreshold)
                    : threshold}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Minimum overdue age</dt>
                <dd className="mt-1 font-medium">
                  {ageLabel(baseline.minimumDays)} →{" "}
                  {parsed.ok
                    ? ageLabel(parsed.values.overdueDaysThreshold)
                    : "Invalid"}
                </dd>
              </div>
            </dl>
            <div className="flex flex-wrap justify-end gap-2">
              <Dialog.Close render={<Button variant="outline" />}>
                Cancel
              </Dialog.Close>
              <Button
                type="button"
                onClick={save}
                disabled={pending || !parsed.ok}
              >
                Confirm changes
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
