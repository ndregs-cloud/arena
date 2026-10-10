import type { Metadata } from "next";
import { CenteredCard } from "@/components/commerce/centered-card";
import { ForgotPasswordForm } from "@/components/auth/auth-forms";

export const metadata: Metadata = {
  title: "Lupa kata sandi",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <CenteredCard
      title="Atur ulang kata sandi"
      subtitle="Kami selalu menampilkan pesan yang sama, apakah email terdaftar atau tidak."
    >
      <ForgotPasswordForm />
    </CenteredCard>
  );
}
