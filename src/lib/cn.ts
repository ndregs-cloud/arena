import { clsx, type ClassValue } from "clsx";

/** Gabungan className standar; token Tailwind dipetakan dari design tokens (dokumen desain §3). */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
