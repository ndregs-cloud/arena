import Link from "next/link";
import type { ReactNode } from "react";
import { loadCurrentPolicy } from "@/server/services/policy.service";
import { formatDate } from "@/lib/format";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";

export const POLICY_KEYS = {
  syarat: "Syarat & Ketentuan",
  privasi: "Kebijakan Privasi",
  pengiriman: "Kebijakan Pengiriman",
  retur: "Kebijakan Retur & Refund",
} as const;

export type PolicyKey = keyof typeof POLICY_KEYS;

export async function PolicyPage({
  policyKey,
  children,
}: {
  policyKey: PolicyKey;
  children?: ReactNode;
}) {
  const policy = await loadCurrentPolicy(policyKey);
  return (
    <div className="page section">
      <div className="mx-auto max-w-[760px]">
        <nav aria-label="Breadcrumb" className="mb-3 text-[13px] text-secondary">
          <Link href="/" className="hover:underline">
            Beranda
          </Link>
          <span aria-hidden="true"> › </span>
          <span className="text-ink-soft">{POLICY_KEYS[policyKey]}</span>
        </nav>
        <h1>{POLICY_KEYS[policyKey]}</h1>
        {!policy ? (
          <Alert tone="warning" className="mt-4" title="Kebijakan belum dipublikasikan">
            Dokumen ini belum ada di basis data. Jalankan seed atau terbitkan lewat Admin &gt;
            Pengaturan.
          </Alert>
        ) : (
          <Card className="mt-4">
            <p className="hint">
              Versi {policy.version}
              {policy.effectiveAt ? ` · berlaku sejak ${formatDate(policy.effectiveAt)}` : ""} ·
              versi ini dicatat pada setiap pesanan.
            </p>
            <div className="mt-3 whitespace-pre-line text-[15px] leading-[25px] text-ink-soft">
              {policy.body}
            </div>
          </Card>
        )}
        {children}
      </div>
    </div>
  );
}
