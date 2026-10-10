"use client";

import { useState, useTransition } from "react";
import { refreshPaymentStatusAction, startPaymentAction } from "@/app/actions/payment";
import type { PayState } from "@/app/actions/payment";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * Panel pembayaran di halaman konfirmasi. Aksi server yang memanggil provider; peramban
 * hanya mengirim nomor pesanan + token akses (AT-05: tidak ada tombol "sudah bayar").
 */
export function PayPanel({
  orderNumber,
  token,
  scenarioAllowed,
}: {
  orderNumber: string;
  token: string;
  scenarioAllowed: boolean;
}) {
  const [state, setState] = useState<PayState | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<PayState>) => start(async () => setState(await fn()));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => run(() => startPaymentAction({ orderNumber, token }))}
          disabled={pending}
        >
          {pending ? "Menghubungi penyedia…" : "Buat instruksi pembayaran"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => run(() => refreshPaymentStatusAction({ orderNumber, token }))}
          disabled={pending}
        >
          Cek status pembayaran
        </Button>
      </div>

      {state?.instructions ? (
        <Alert tone="info" title="Instruksi pembayaran">
          <p className="whitespace-pre-line">{state.instructions}</p>
        </Alert>
      ) : null}
      {state?.redirectUrl ? (
        <a className="link text-[14px] font-semibold" href={state.redirectUrl}>
          Buka halaman pembayaran simulasi →
        </a>
      ) : null}
      {state ? (
        <Alert
          tone={
            state.status === "succeeded" ? "success" : state.status === "failed" ? "danger" : "info"
          }
        >
          {state.message}
        </Alert>
      ) : null}

      {scenarioAllowed ? (
        <fieldset className="mt-1 rounded-card border border-dashed border-warning/50 bg-warning-soft/40 p-3">
          <legend className="px-1 text-[12px] font-bold uppercase tracking-wide text-warning">
            Konsol simulasi (dev)
          </legend>
          <p className="hint mb-2">
            Mengirim webhook bertanda tangan ke jalur produksi. Hanya tersedia di lingkungan
            pengembangan.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="success"
              type="button"
              disabled={pending}
              onClick={() =>
                run(() =>
                  import("@/app/actions/payment").then((m) =>
                    m.simulateProviderEventAction({ orderNumber, token, kind: "payment.success" }),
                  ),
                )
              }
            >
              Bayar berhasil
            </Button>
            <Button
              size="sm"
              variant="secondary"
              type="button"
              disabled={pending}
              onClick={() =>
                run(() =>
                  import("@/app/actions/payment").then((m) =>
                    m.simulateProviderEventAction({
                      orderNumber,
                      token,
                      kind: "payment.success",
                      duplicate: true,
                    }),
                  ),
                )
              }
            >
              Ulangi event yang sama (uji duplikat)
            </Button>
            <Button
              size="sm"
              variant="danger"
              type="button"
              disabled={pending}
              onClick={() =>
                run(() =>
                  import("@/app/actions/payment").then((m) =>
                    m.simulateProviderEventAction({ orderNumber, token, kind: "payment.failed" }),
                  ),
                )
              }
            >
              Bayar gagal
            </Button>
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}
