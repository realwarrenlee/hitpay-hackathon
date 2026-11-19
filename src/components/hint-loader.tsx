"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function HintLoader() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stop = false;
    void fetch("/api/hints", { method: "POST" })
      .then((response) => {
        if (!stop && response.ok) router.refresh();
        else if (!stop) setFailed(true);
      })
      .catch(() => { if (!stop) setFailed(true); });
    return () => {
      stop = true;
    };
  }, [router]);
  return <p role="status" className="text-sm text-muted-foreground">{failed ? "Reference insights are unavailable. You can still review the suggested matches." : "Reading transaction references…"}</p>;
}
