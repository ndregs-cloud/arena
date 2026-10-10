/**
 * Bentuk state untuk form yang memakai useActionState. Ditaruh di modul terpisah karena file
 * "use server" hanya boleh mengekspor fungsi async.
 */

export interface FormState {
  message: string | null;
  tone: "success" | "danger";
}

export const EMPTY_FORM_STATE: FormState = { message: null, tone: "success" };

export interface AuthState {
  message: string | null;
  tone: "success" | "danger";
  /** Secret MFA sementara, hanya ditampilkan di halaman profil saat aktivasi. */
  extra?: string | null;
}

export const EMPTY_AUTH_STATE: AuthState = { message: null, tone: "danger" };
