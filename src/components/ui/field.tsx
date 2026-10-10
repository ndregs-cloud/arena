import { cloneElement, isValidElement, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Field form: label selalu di atas kontrol, pesan error terhubung lewat aria-describedby,
 * dan satu field per baris di mobile (desain §7 - form checkout 60-64% lebar di desktop).
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const describedBy =
    [hint ? `${htmlFor}-hint` : null, error ? `${htmlFor}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined;
  // Hubungan hint/error harus menempel ke kontrolnya, bukan ke wadah - kalau tidak,
  // pembaca layar tidak pernah membacakan pesan error ketika field menerima fokus.
  const control =
    describedBy || error
      ? isValidElement<{ "aria-describedby"?: string; "aria-invalid"?: boolean }>(children)
        ? cloneElement(children, {
            ...(describedBy ? { "aria-describedby": describedBy } : {}),
            ...(error ? { "aria-invalid": true } : {}),
          })
        : children
      : children;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label className="label" htmlFor={htmlFor}>
        {label}
        {required ? (
          <span className="ml-1 text-danger">*</span>
        ) : (
          <span className="ml-1 text-secondary text-[12px]">(opsional)</span>
        )}
      </label>
      <div>{control}</div>
      {hint ? (
        <p className="hint" id={`${htmlFor}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="hint font-semibold text-danger" id={`${htmlFor}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput({
  invalid,
  className,
  ...rest
}: ComponentPropsWithoutRef<"input"> & { invalid?: boolean }) {
  return (
    <input
      className={cn("control", invalid && "border-danger bg-danger-soft/40", className)}
      {...rest}
    />
  );
}

export function TextArea({
  invalid,
  className,
  ...rest
}: ComponentPropsWithoutRef<"textarea"> & { invalid?: boolean }) {
  return (
    <textarea
      className={cn("control min-h-[96px]", invalid && "border-danger", className)}
      {...rest}
    />
  );
}

export function SelectInput({ className, children, ...rest }: ComponentPropsWithoutRef<"select">) {
  return (
    <select className={cn("control appearance-none bg-surface pr-8", className)} {...rest}>
      {children}
    </select>
  );
}

export function CheckboxRow({
  id,
  label,
  hint,
  defaultChecked,
  name,
  value = "true",
  required,
}: {
  id: string;
  label: ReactNode;
  hint?: string;
  defaultChecked?: boolean;
  name: string;
  value?: string;
  required?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        name={name}
        value={value}
        type="checkbox"
        defaultChecked={defaultChecked}
        required={required}
        className="mt-0.5 size-5 shrink-0 rounded-tile border-border accent-brand"
      />
      <label htmlFor={id} className="text-[14px] leading-[20px] text-ink-soft">
        {label}
        {hint ? <span className="hint mt-0.5 block">{hint}</span> : null}
      </label>
    </div>
  );
}

export function RadioCard({
  id,
  name,
  value,
  title,
  description,
  meta,
  defaultChecked,
  disabled,
}: {
  id: string;
  name: string;
  value: string;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  defaultChecked?: boolean;
  disabled?: boolean;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-card border border-border bg-surface p-4 transition-colors hover:border-brand",
        "has-[:checked]:border-brand has-[:checked]:bg-brand-soft/60",
        disabled && "cursor-not-allowed opacity-60 hover:border-border",
      )}
    >
      <input
        id={id}
        name={name}
        value={value}
        type="radio"
        defaultChecked={defaultChecked}
        disabled={disabled}
        className="mt-1 size-5 accent-brand"
      />
      <span className="flex flex-1 flex-col gap-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="font-semibold text-ink">{title}</span>
          {meta ? (
            <span className="tnum text-[14px] font-semibold text-ink-soft">{meta}</span>
          ) : null}
        </span>
        {description ? (
          <span className="text-[13px] leading-[19px] text-secondary">{description}</span>
        ) : null}
      </span>
    </label>
  );
}
