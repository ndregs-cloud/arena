"use client";

import { useState, useTransition } from "react";
import { simulateProviderEventAction } from "@/app/actions/payment";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const EVENTS = [
  { kind: "payment.success", label: "payment.success", tone: "success" as const },
  { kind: "payment.pending", label: "payment.pending", tone: "info" as const },
  { kind: "payment.failed", label: "payment.failed", tone: "danger" as const },
  { kind: "payment.expired", label: "payment.expired", tone: "warning" as const },
];

/** Tombol penggerak status untuk pengujian lokal; tidak menyentuh provider nyata. */
export function SimulationConsole({
  orderNumber,
  token,
  attemptStatus,
}: {
  orderNumber: string;
  token: string;
  attemptStatus: string;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const send = (kind: string, duplicate = false) =>
    start(async () => {
      const result = await simulateProviderEventAction({ orderNumber, token, kind, duplicate });
      setMessage(result.message);
    });

  return (
    <div className="flex flex-col gap-3">
      <p className="hint" role="status">
        Status attempt saat ini: <strong>{attemptStatus}</strong>
      </p>
      <div className="flex flex-wrap gap-2">
        {EVENTS.map((event) => (
          <Button
            key={event.kind}
            size="sm"
            variant={
              event.tone === "success"
                ? "success"
                : event.tone === "danger"
                  ? "danger"
                  : "secondary"
            }
            type="button"
            disabled={pending}
            onClick={() => send(event.kind)}
          >
            Kirim {event.label}
          </Button>
        ))}
        <Button
          size="sm"
          variant="secondary"
          type="button"
          disabled={pending}
          onClick={() => send("payment.success", true)}
        >
          Kirim payment.success 2x (uji dedup)
        </Button>
      </div>
      {message ? <Alert tone="info">{message}</Alert> : null}
    </div>
  );
}
