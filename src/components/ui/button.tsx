import type { ComponentPropsWithoutRef, ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * Kontrol aksi. Tinggi minimum 44px (desain §4 target sentuh) dan varian selalu punya label
 * teks - tidak ada ikon tanpa nama.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
export type ButtonSize = "md" | "sm";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-brand text-white border-transparent hover:bg-brand-hover active:bg-brand-hover",
  secondary: "bg-surface text-ink border-border hover:bg-canvas",
  ghost: "bg-transparent text-ink-soft border-transparent hover:bg-canvas",
  danger: "bg-danger text-white border-transparent hover:brightness-95",
  success: "bg-success text-white border-transparent hover:brightness-95",
};

const SIZES: Record<ButtonSize, string> = {
  md: "min-h-[44px] px-4 text-[15px]",
  sm: "min-h-[36px] px-3 text-[13px]",
};

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-control border font-semibold transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed";

export function buttonClass(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  extra?: string,
): string {
  return cn(BASE, VARIANTS[variant], SIZES[size], extra);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...rest
}: ComponentPropsWithoutRef<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={buttonClass(variant, size, className)} {...rest} />;
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  className,
  children,
  ...rest
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<typeof Link>, "href" | "className">) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)} {...rest}>
      {children}
    </Link>
  );
}
