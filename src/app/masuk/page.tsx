import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CenteredCard } from "@/components/commerce/centered-card";
import { LoginForm } from "@/components/auth/auth-forms";
import { getRequestContext } from "@/server/context";
import { Alert } from "@/components/ui/alert";

export const metadata: Metadata = { title: "Masuk", robots: { index: false, follow: false } };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ setelah?: string; pesan?: string }>;
}) {
  const params = await searchParams;
  const ctx = await getRequestContext();
  if (ctx.user) redirect(params.setelah?.startsWith("/admin") ? "/admin" : "/akun/pesanan");
  return (
    <CenteredCard
      title="Masuk ke akun"
      subtitle="Pesanan, pelacakan, dan retur ada di satu tempat."
    >
      {params.pesan ? (
        <Alert tone="danger" className="mb-3">
          {params.pesan}
        </Alert>
      ) : null}
      <LoginForm
        after={
          typeof params.setelah === "string" && params.setelah.startsWith("/")
            ? params.setelah
            : "/akun/pesanan"
        }
      />
    </CenteredCard>
  );
}
