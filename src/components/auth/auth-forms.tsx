"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CheckboxRow, Field, TextInput } from "@/components/ui/field";
import { EMPTY_AUTH_STATE } from "@/lib/form-state";
import {
  changePasswordAction,
  confirmMfaAction,
  disableMfaAction,
  enableMfaAction,
  forgotPasswordAction,
  loginAction,
  marketingConsentAction,
  profileUpdateAction,
  registerAction,
  resetPasswordAction,
  revokeSessionsAction,
} from "@/app/actions/auth";

function Message({ state }: { state: typeof EMPTY_AUTH_STATE }) {
  if (!state.message) return null;
  return (
    <Alert
      role={state.tone === "danger" ? "alert" : "status"}
      tone={state.tone === "danger" ? "danger" : "success"}
    >
      {state.message}
    </Alert>
  );
}

export function LoginForm({ after }: { after: string }) {
  const [state, action, pending] = useActionState(loginAction, EMPTY_AUTH_STATE);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="setelah" value={after} />
      <Field
        label="Email"
        htmlFor="identifier"
        required
        hint="Email yang dipakai saat pendaftaran."
      >
        <TextInput id="identifier" name="identifier" type="email" required autoComplete="email" />
      </Field>
      <Field label="Kata sandi" htmlFor="password" required>
        <TextInput
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
        />
      </Field>
      <Field
        label="Kode MFA"
        htmlFor="totpCode"
        hint="Isi hanya bila akun Anda mengaktifkan 2 langkah."
      >
        <TextInput
          id="totpCode"
          name="totpCode"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          autoComplete="one-time-code"
        />
      </Field>
      <Message state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Memeriksa…" : "Masuk"}
      </Button>
      <div className="flex flex-wrap gap-4 text-[14px]">
        <Link href="/daftar" className="link">
          Buat akun baru
        </Link>
        <Link href="/lupa-password" className="link">
          Lupa kata sandi
        </Link>
      </div>
    </form>
  );
}

export function RegisterForm() {
  const [state, action, pending] = useActionState(registerAction, EMPTY_AUTH_STATE);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Nama lengkap" htmlFor="fullName" required>
        <TextInput
          id="fullName"
          name="fullName"
          required
          minLength={3}
          maxLength={120}
          autoComplete="name"
        />
      </Field>
      <Field
        label="Email"
        htmlFor="reg-email"
        required
        hint="Dipakai untuk status pesanan & invoice."
      >
        <TextInput id="reg-email" name="email" type="email" required autoComplete="email" />
      </Field>
      <Field
        label="Kata sandi"
        htmlFor="reg-password"
        required
        hint="Minimal 10 karakter, kombinasi huruf dan angka."
      >
        <TextInput
          id="reg-password"
          name="password"
          type="password"
          required
          minLength={10}
          maxLength={128}
          autoComplete="new-password"
        />
      </Field>
      <Field
        label="Nomor ponsel"
        htmlFor="reg-phone"
        required
        hint="Contoh 081234567890 (dipakai kurir)."
      >
        <TextInput id="reg-phone" name="phone" inputMode="tel" required autoComplete="tel" />
      </Field>
      <CheckboxRow
        id="reg-marketing"
        name="marketing"
        value="on"
        label="Saya bersedia menerima info promo"
        hint="Consent dicatat beserta versi kebijakan; bisa ditarik kapan saja."
      />
      <Message state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Mendaftarkan…" : "Daftar"}
      </Button>
      <p className="text-[14px] text-secondary">
        Sudah punya akun?{" "}
        <Link href="/masuk" className="link font-semibold">
          Masuk
        </Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(forgotPasswordAction, EMPTY_AUTH_STATE);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field
        label="Email akun Anda"
        htmlFor="fp-email"
        required
        hint="Jika email terdaftar, tautan reset dikirim (berlaku singkat, sekali pakai)."
      >
        <TextInput id="fp-email" name="email" type="email" required autoComplete="email" />
      </Field>
      <Message state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Mengirim…" : "Kirim tautan reset"}
      </Button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, EMPTY_AUTH_STATE);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <Field
        label="Kata sandi baru"
        htmlFor="rp-password"
        required
        hint="Minimal 10 karakter, huruf + angka."
      >
        <TextInput
          id="rp-password"
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
        />
      </Field>
      <Field label="Ulangi kata sandi" htmlFor="rp-confirm" required>
        <TextInput
          id="rp-confirm"
          name="passwordConfirm"
          type="password"
          required
          autoComplete="new-password"
        />
      </Field>
      <Message state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Simpan & masuk kembali"}
      </Button>
    </form>
  );
}

export function ProfileForm({ fullName, phone }: { fullName: string; phone: string }) {
  const [state, action, pending] = useActionState(profileUpdateAction, EMPTY_AUTH_STATE);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Nama lengkap" htmlFor="pf-name" required>
        <TextInput id="pf-name" name="fullName" required minLength={3} defaultValue={fullName} />
      </Field>
      <Field label="Nomor ponsel" htmlFor="pf-phone">
        <TextInput id="pf-phone" name="phone" inputMode="tel" defaultValue={phone} />
      </Field>
      <Message state={state} />
      <Button type="submit" disabled={pending} size="sm" variant="secondary">
        {pending ? "Menyimpan…" : "Simpan profil"}
      </Button>
    </form>
  );
}

export function MarketingConsentForm({ accepted }: { accepted: boolean }) {
  const [state, action, pending] = useActionState(marketingConsentAction, EMPTY_AUTH_STATE);
  return (
    <form action={action} className="flex flex-col gap-3">
      <CheckboxRow
        id="mc"
        name="marketing"
        value="on"
        defaultChecked={accepted}
        label="Izinkan email promo berkala"
        hint="Transaksi (pesanan, pengiriman, retur) tetap dikirim tanpa consent ini."
      />
      <Message state={state} />
      <Button type="submit" disabled={pending} size="sm" variant="secondary">
        {pending ? "Menyimpan…" : "Perbarui consent"}
      </Button>
    </form>
  );
}

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, EMPTY_AUTH_STATE);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Kata sandi saat ini" htmlFor="cp-current" required>
        <TextInput
          id="cp-current"
          name="currentPassword"
          type="password"
          required
          autoComplete="current-password"
        />
      </Field>
      <Field
        label="Kata sandi baru"
        htmlFor="cp-new"
        required
        hint="Minimal 10 karakter, huruf + angka."
      >
        <TextInput
          id="cp-new"
          name="newPassword"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
        />
      </Field>
      <Field label="Ulangi kata sandi baru" htmlFor="cp-confirm" required>
        <TextInput
          id="cp-confirm"
          name="confirmPassword"
          type="password"
          required
          autoComplete="new-password"
        />
      </Field>
      <Message state={state} />
      <Button type="submit" disabled={pending} size="sm" variant="secondary">
        {pending ? "Menyimpan…" : "Ganti kata sandi"}
      </Button>
    </form>
  );
}

export function MfaPanel({ enabled, secret }: { enabled: boolean; secret: string | null }) {
  const [state, enableAction, enablePending] = useActionState(enableMfaAction, EMPTY_AUTH_STATE);
  const [confirmState, confirmAction, confirmPending] = useActionState(
    confirmMfaAction,
    EMPTY_AUTH_STATE,
  );
  const [disableState, disableAction, disablePending] = useActionState(
    disableMfaAction,
    EMPTY_AUTH_STATE,
  );
  const [revokeState, revokeAction, revokePending] = useActionState(
    revokeSessionsAction,
    EMPTY_AUTH_STATE,
  );
  const shown = state.extra ?? secret;
  return (
    <div className="flex flex-col gap-4">
      {enabled ? (
        <>
          <Alert tone="success" title="2 langkah aktif">
            Kode TOTP diminta setiap kali masuk dari perangkat baru.
          </Alert>
          <form action={disableAction} className="flex flex-wrap items-end gap-2">
            <Field
              label="Konfirmasi kata sandi"
              htmlFor="mfa-disable"
              required
              className="min-w-[240px]"
            >
              <TextInput
                id="mfa-disable"
                name="password"
                type="password"
                required
                autoComplete="current-password"
              />
            </Field>
            <Button size="sm" variant="danger" type="submit" disabled={disablePending}>
              {disablePending ? "Menonaktifkan…" : "Nonaktifkan MFA"}
            </Button>
          </form>
          <Message state={disableState} />
        </>
      ) : (
        <>
          <form action={enableAction}>
            <Button size="sm" variant="secondary" type="submit" disabled={enablePending}>
              {enablePending ? "Menyiapkan…" : "Mulai aktivasi 2 langkah"}
            </Button>
          </form>
          <Message state={state} />
          {shown ? (
            <>
              <p className="text-[13px] text-secondary">
                Secret (simpan di aplikasi authenticator):{" "}
                <code className="tnum rounded-tile bg-canvas px-1 py-0.5 text-[13px]">{shown}</code>
              </p>
              <p className="hint">
                Di lingkungan dev: jalankan `node scripts/dev-totp.mjs` untuk kode 6 angka saat ini.
              </p>
              <form action={confirmAction} className="flex flex-wrap items-end gap-2">
                <Field label="Kode 6 angka" htmlFor="mfa-code" required className="w-[160px]">
                  <TextInput
                    id="mfa-code"
                    name="code"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                  />
                </Field>
                <Button size="sm" type="submit" disabled={confirmPending}>
                  {confirmPending ? "Memeriksa…" : "Konfirmasi & aktifkan"}
                </Button>
              </form>
              <Message state={confirmState} />
            </>
          ) : null}
        </>
      )}
      <div className="border-t border-border pt-4">
        <form action={revokeAction}>
          <Button size="sm" variant="ghost" type="submit" disabled={revokePending}>
            {revokePending ? "Mengeluarkan…" : "Keluarkan semua sesi lain"}
          </Button>
        </form>
        <Message state={revokeState} />
      </div>
    </div>
  );
}
