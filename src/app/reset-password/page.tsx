import type { Metadata } from "next";
import { CenteredCard } from "@/components/commerce/centered-card";
import { ResetPasswordForm } from "@/components/auth/auth-forms";
import { Alert } from "@/components/ui/alert";

export const metadata: Metadata = {
  title: "Kata sandi baru",
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token || typeof token !== "string") {
    return (
      <CenteredCard title="Kata sandi baru">
        <Alert tone="danger" title="Tautan tidak lengkap">
          Buka tautan reset dari email Anda, atau minta tautan baru di halaman Lupa kata sandi.
        </Alert>
      </CenteredCard>
    );
  }
  return (
    <CenteredCard
      title="Buat kata sandi baru"
      subtitle="Tautan reset berlaku satu kali. Setelah disimpan, sesi lama keluar."
    >
      <ResetPasswordForm token={token} />
    </CenteredCard>
  );
}
