"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Dialog aksesibel memakai elemen <dialog> bawaan: fokus dipindah ke dialog, Esc menutup,
 * dan konten di belakang jadi inert. Dipakai untuk konfirmasi aksi admin (bukan untuk form utama,
 * supaya halaman tetap berfungsi tanpa JavaScript).
 */
export function Modal({
  id,
  title,
  description,
  children,
  footer,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const open = () => {
      if (!dialog.open) dialog.showModal();
    };
    const opener = document.getElementById(`${id}-open`);
    opener?.addEventListener("click", open);
    return () => opener?.removeEventListener("click", open);
  }, [id]);

  return (
    <dialog
      ref={ref}
      id={id}
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-desc` : undefined}
      className="m-auto w-[min(560px,92vw)] rounded-sheet border border-border bg-surface p-0 shadow-pop backdrop:bg-ink/40"
    >
      <div className="p-5">
        <h2 id={`${id}-title`} className="text-[20px] leading-[28px]">
          {title}
        </h2>
        {description ? (
          <p id={`${id}-desc`} className="mt-1 text-[14px] leading-[20px] text-secondary">
            {description}
          </p>
        ) : null}
        <div className="mt-4">{children}</div>
      </div>
      {footer ? (
        <div className="flex flex-wrap justify-end gap-2 border-t border-border bg-canvas px-5 py-3">
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}

export function ModalClose({ children }: { children: ReactNode }) {
  return (
    <form method="dialog">
      <button
        type="submit"
        className="inline-flex min-h-[44px] items-center rounded-control border border-border bg-surface px-4 text-[15px] font-semibold hover:bg-canvas"
      >
        {children}
      </button>
    </form>
  );
}
