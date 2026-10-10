"use server";

import { redirect } from "next/navigation";
import { AppError } from "@/domain/errors";
import { EMPTY_AUTH_STATE, type AuthState } from "@/lib/form-state";
import { getRequestContext } from "@/server/context";
import {
  changePassword,
  confirmMfaEnrollment,
  disableMfa,
  login,
  logout,
  registerAccount,
  requestPasswordReset,
  resetPassword,
  revokeOtherSessions,
  verifyEmailToken,
} from "@/server/services/auth.service";
import { beginMfaEnrollment } from "@/server/services/auth.service";
import { updateMarketingConsent, updateProfile } from "@/server/services/account.service";

/**
 * Aksi autentikasi & akun. Pesan error dibuat umum agar tidak membocorkan keberadaan akun
 * (OWASP ASVS 2.3); rate limit & unlock ditangani service.
 */

function toState(error: unknown): AuthState {
  if (error instanceof AppError) return { message: error.message, tone: "danger" };
  return {
    message: "Permintaan tidak dapat diproses. Periksa kembali data yang diisi.",
    tone: "danger",
  };
}

function safeReturnTo(value: FormDataEntryValue | null): string {
  const target = typeof value === "string" ? value : "/akun/pesanan";
  return target.startsWith("/") && !target.startsWith("//") ? target : "/akun/pesanan";
}

export async function loginAction(state: AuthState, formData: FormData): Promise<AuthState> {
  try {
    const ctx = await getRequestContext();
    const result = await login(ctx, {
      identifier: String(formData.get("identifier") ?? "").trim(),
      password: String(formData.get("password") ?? ""),
      totpCode: String(formData.get("totpCode") ?? "").trim() || undefined,
    });
    // Staf diarahkan ke admin center; pelanggan kembali ke halaman yang dituju sebelum login.
    const after = safeReturnTo(formData.get("setelah"));
    redirect(result.user.kind === "staff" ? "/admin" : after);
  } catch (error) {
    return toState(error);
  }
}

export async function registerAction(state: AuthState, formData: FormData): Promise<AuthState> {
  try {
    const ctx = await getRequestContext();
    const result = await registerAccount(ctx, {
      fullName: String(formData.get("fullName") ?? "").trim(),
      email: String(formData.get("email") ?? "").trim(),
      password: String(formData.get("password") ?? ""),
      phone: String(formData.get("phone") ?? "").trim(),
      marketingConsent: formData.get("marketing") === "on",
    });
    return { message: result.message, tone: "success" };
  } catch (error) {
    return toState(error);
  }
}

export async function logoutAction(): Promise<void> {
  const { readSessionCookie } = await import("@/platform/auth");
  const session = await readSessionCookie();
  await logout(session?.sessionPublicId ?? null);
  redirect("/");
}

export async function forgotPasswordAction(
  state: AuthState,
  formData: FormData,
): Promise<AuthState> {
  try {
    const ctx = await getRequestContext();
    const result = await requestPasswordReset(ctx, String(formData.get("email") ?? ""));
    return { message: result.message, tone: "success" };
  } catch (error) {
    return toState(error);
  }
}

export async function resetPasswordAction(
  state: AuthState,
  formData: FormData,
): Promise<AuthState> {
  try {
    const token = String(formData.get("token") ?? "");
    const password = String(formData.get("password") ?? "");
    const confirm = String(formData.get("passwordConfirm") ?? "");
    if (password !== confirm)
      return { message: "Konfirmasi kata sandi tidak sama.", tone: "danger" };
    const result = await resetPassword(token, password);
    return { message: `${result.message} Silakan masuk.`, tone: "success" };
  } catch (error) {
    return toState(error);
  }
}

export async function verifyEmailAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  try {
    await verifyEmailToken(token);
  } catch (error) {
    redirect(
      `/verifikasi-email?token=${encodeURIComponent(token)}&pesan=${encodeURIComponent(error instanceof AppError ? error.message : "Tautan tidak berlaku.")}`,
    );
  }
  redirect("/akun/profil?pesan=Email+terverifikasi");
}

export async function profileUpdateAction(
  state: AuthState,
  formData: FormData,
): Promise<AuthState> {
  try {
    const ctx = await getRequestContext();
    const result = await updateProfile(ctx, {
      fullName: String(formData.get("fullName") ?? "").trim(),
      phone: String(formData.get("phone") ?? "").trim(),
    });
    return { message: result.message, tone: "success" };
  } catch (error) {
    return toState(error);
  }
}

export async function marketingConsentAction(
  state: AuthState,
  formData: FormData,
): Promise<AuthState> {
  try {
    const ctx = await getRequestContext();
    const result = await updateMarketingConsent(ctx, formData.get("marketing") === "on");
    return { message: result.message, tone: "success" };
  } catch (error) {
    return toState(error);
  }
}

export async function changePasswordAction(
  state: AuthState,
  formData: FormData,
): Promise<AuthState> {
  try {
    const ctx = await getRequestContext();
    const next = String(formData.get("newPassword") ?? "");
    if (next !== String(formData.get("confirmPassword") ?? ""))
      return { message: "Konfirmasi kata sandi tidak sama.", tone: "danger" };
    const result = await changePassword(ctx, String(formData.get("currentPassword") ?? ""), next);
    return { message: result.message, tone: "success" };
  } catch (error) {
    return toState(error);
  }
}

export async function enableMfaAction(): Promise<AuthState> {
  try {
    const ctx = await getRequestContext();
    const result = await beginMfaEnrollment(ctx);
    return {
      message: "Scan atau simpan secret berikut, lalu konfirmasi kode 6 angka.",
      tone: "success",
      extra: result.secret,
    };
  } catch (error) {
    return toState(error);
  }
}

export async function confirmMfaAction(state: AuthState, formData: FormData): Promise<AuthState> {
  try {
    const ctx = await getRequestContext();
    const result = await confirmMfaEnrollment(ctx, String(formData.get("code") ?? "").trim());
    return { message: result.message, tone: "success" };
  } catch (error) {
    return toState(error);
  }
}

export async function disableMfaAction(state: AuthState, formData: FormData): Promise<AuthState> {
  try {
    const ctx = await getRequestContext();
    const result = await disableMfa(ctx, String(formData.get("password") ?? ""));
    return { message: result.message, tone: "success" };
  } catch (error) {
    return toState(error);
  }
}

export async function revokeSessionsAction(): Promise<AuthState> {
  try {
    const ctx = await getRequestContext();
    const result = await revokeOtherSessions(ctx);
    return { message: result.message, tone: "success" };
  } catch (error) {
    return toState(error);
  }
}
