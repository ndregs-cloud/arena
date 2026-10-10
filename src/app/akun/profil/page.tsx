import type { Metadata } from "next";
import Link from "next/link";
import { requireCustomerPage } from "@/server/context";
import { getProfile } from "@/server/services/account.service";
import { listSessions } from "@/server/services/auth.service";
import { formatDate, formatDateTime } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import {
  ChangePasswordForm,
  MarketingConsentForm,
  MfaPanel,
  ProfileForm,
} from "@/components/auth/auth-forms";
import { Table, Td, Tr } from "@/components/ui/table";

export const metadata: Metadata = {
  title: "Profil & keamanan",
  robots: { index: false, follow: false },
};

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ pesan?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requireCustomerPage("/akun/profil");
  const [profile, sessions] = await Promise.all([getProfile(ctx), listSessions(ctx)]);
  const mfaEnabled = ctx.user?.mfaEnabled ?? false;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {params.pesan ? (
        <div className="lg:col-span-2">
          <Alert tone="success">{params.pesan}</Alert>
        </div>
      ) : null}
      <Card>
        <CardHeader
          title="Identitas"
          subtitle={`Anggota sejak ${profile.memberSince ? formatDate(profile.memberSince) : "-"}`}
        />
        <ProfileForm fullName={profile.fullName} phone={profile.phone ?? ""} />
        <dl className="mt-4 grid gap-2 border-t border-border pt-3 text-[14px]">
          <div className="flex justify-between gap-3">
            <dt className="text-secondary">Email</dt>
            <dd className="font-semibold">{profile.email}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-secondary">Bahasa / zona waktu</dt>
            <dd className="font-semibold">
              {profile.locale} · {profile.timezone}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-secondary">Alamat / pesanan / retur terbuka</dt>
            <dd className="tnum font-semibold">
              {profile.addressCount} / {profile.orderCount} / {profile.openReturns}
            </dd>
          </div>
        </dl>
        {!profile.emailVerified ? (
          <Alert tone="warning" className="mt-3" title="Email belum diverifikasi">
            <Link href="/verifikasi-email" className="link font-semibold">
              Buka tautan verifikasi dari email Anda →
            </Link>
          </Alert>
        ) : null}
      </Card>

      <Card>
        <CardHeader
          title="Keamanan akun"
          subtitle={
            mfaEnabled
              ? "2 langkah aktif."
              : "Kami menyarankan 2 langkah untuk akun yang bisa memesan dan membayar."
          }
        />
        <MfaPanel enabled={mfaEnabled} secret={null} />
        <div className="mt-4 border-t border-border pt-4">
          <p className="label mb-2">Ganti kata sandi</p>
          <ChangePasswordForm />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Preferensi pemasaran"
          subtitle="Consent disimpan beserta waktunya dan dapat ditarik kapan saja."
        />
        <MarketingConsentForm accepted={profile.marketingConsent} />
        <p className="hint mt-2">
          Terakhir diperbarui:{" "}
          {profile.consentUpdatedAt ? formatDateTime(profile.consentUpdatedAt) : "belum pernah"}
        </p>
      </Card>

      <Card>
        <CardHeader
          title="Sesi aktif"
          subtitle={`${sessions.length} perangkat. Keluarkan sesi lain bila Anda memakai komputer umum.`}
        />
        {sessions.length === 0 ? (
          <p className="text-[14px] text-secondary">Tidak ada sesi tercatat.</p>
        ) : (
          <Table head={["Perangkat", "Dimulai", "Berakhir"]}>
            {sessions.map((session) => (
              <Tr key={session.publicId}>
                <Td label="Perangkat">{session.userAgent?.slice(0, 60) ?? "Peramban"}</Td>
                <Td label="Dimulai">
                  {session.createdAt ? formatDateTime(session.createdAt) : "-"}
                </Td>
                <Td label="Berakhir">
                  {session.expiresAt ? formatDateTime(session.expiresAt) : "-"}
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
