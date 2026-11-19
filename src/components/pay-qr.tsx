"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function PayQr({ url }: { url: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void QRCode.toDataURL(url, { margin: 1, width: 280 }).then((value) => {
      if (!cancelled) setSrc(value);
    });
    return () => {
      cancelled = true;
    };
  }, [url]);
  if (!src) return <div className="mx-auto size-[280px] max-w-full rounded-xl bg-muted" aria-hidden />;
  return <img src={src} alt="PayNow QR" className="mx-auto size-[min(100%,280px)] rounded-xl bg-white p-3" />;
}
