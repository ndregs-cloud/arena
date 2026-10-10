import type { Metadata } from "next";
import { CenteredCard } from "@/components/commerce/centered-card";
import { RegisterForm } from "@/components/auth/auth-forms";

export const metadata: Metadata = { title: "Daftar", robots: { index: false, follow: false } };

export default function RegisterPage() {
  return (
    <CenteredCard
      title="Buat akun"
      subtitle="Data yang diminta minimal: nama, email, ponsel. Kata sandi disimpan sebagai hash scrypt."
    >
      <RegisterForm />
    </CenteredCard>
  );
}
