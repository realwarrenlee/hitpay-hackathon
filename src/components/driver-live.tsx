"use client";

import { useEffect, useState } from "react";
import { checkPaymentStatusAction } from "@/app/actions";
import { PayQr } from "@/components/pay-qr";

export function DriverLive({ id, initialLabel, initialUrl, paymentRequestId }: { id: string; initialLabel: string; initialUrl: string | null; paymentRequestId: string | null }) {
  const [label, setLabel] = useState(initialLabel);
  const [url, setUrl] = useState(initialUrl);
  const [watching, setWatching] = useState(Boolean(paymentRequestId));
  const [connectionError, setConnectionError] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => {
      void fetch(`/api/delivery/${id}`)
        .then((response) => { if (!response.ok) throw new Error("Delivery unavailable"); return response.json(); })
        .then((body: { label: string; url: string | null }) => {
          setLabel(body.label);
          setUrl(body.url);
          setConnectionError(false);
        })
        .catch(() => setConnectionError(true));
    }, 2000);
    return () => clearInterval(timer);
  }, [id]);
  useEffect(() => {
    if (!paymentRequestId) return;
    let stop = false;
    const timer = setInterval(() => {
      if (stop) return;
      void fetch(`/api/payment-request/${paymentRequestId}/status`, { method: "POST" })
        .then((response) => { if (!response.ok) throw new Error("Payment unavailable"); return response.json(); })
        .then(async (body: { outcome?: string }) => {
          if (body.outcome && body.outcome !== "pending" && body.outcome !== "tool_error") {
            stop = true;
            setWatching(false);
          }
          const live = (await fetch(`/api/delivery/${id}`).then((response) => response.json())) as { label: string; url: string | null };
          setLabel(live.label);
          setUrl(live.url);
        })
        .catch(() => setConnectionError(true));
    }, 5000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [id, paymentRequestId]);
  const released = label === "Released";
  return (
    <div className="mt-8 flex flex-col items-center gap-6 text-center">
      <p role="status" className="text-4xl font-semibold tracking-tight">{label}</p>
      {connectionError ? <p role="alert" className="text-sm text-muted-foreground">Unable to refresh the delivery status. Reconnecting…</p> : null}
      {url && !released ? (
        <>
          <PayQr url={url} />
          <a className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-primary text-base font-medium text-primary-foreground" href={url}>Show PayNow QR</a>
        </>
      ) : null}
      {paymentRequestId && !released ? (
        <form action={checkPaymentStatusAction} className="w-full">
          <input type="hidden" name="paymentRequestId" value={paymentRequestId} />
          <input type="hidden" name="returnTo" value={`/driver/${id}`} />
          <button type="submit" className="inline-flex h-12 w-full items-center justify-center rounded-xl border text-base font-medium">Check payment status</button>
        </form>
      ) : null}
      {watching && !released ? <p className="text-sm text-muted-foreground">Checking HitPay every 5 seconds.</p> : null}
    </div>
  );
}
