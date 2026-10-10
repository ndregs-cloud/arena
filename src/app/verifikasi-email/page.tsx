import type { Metadata } from "next";
import { CenteredCard } from "@/components/commerce/centered-card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { verifyEmailAction } from "@/app/actions/auth";

export const metadata: Metadata = {
  title: "Verifikasi email",
  robots: { index: false, follow: false },
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; pesan?: string }>;
}) {
  const { token, pesan } = await searchParams;
  const valid = typeof token === "string" && token.length > 0;
  return (
    <CenteredCard title="Verifikasi email">
      {pesan ? <Alert tone="danger">{pesan}</Alert> : null}
      {!valid ? (
        <Alert tone="warning" title="Tautan verifikasi tidak ditemukan">
          Buka tautan dari email, atau kirim ulang tautan dari halaman akun Anda.
        </Alert>
      ) : (
        <form action={verifyEmailAction} className="flex flex-col gap-4">
          <input type="hidden" name="token" value={token} />
          <p className="text-[14px] leading-[20px] text-ink-soft">
            Verifikasi menandai email Anda benar sehingga notifikasi pesanan dan retur dapat
            dikirim. Tidak ada data lain yang berubah.
          </p>
          <Button type="submit">Verifikasi sekarang</Button>
        </form>
      )}
    </CenteredCard>
  );
}
