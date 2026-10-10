import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import type { ReactNode } from "react";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: { children: ReactNode; href: string } & Record<string, unknown>) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));

const { QuantityInput } = await import("@/components/ui/quantity-input");
const { Modal, ModalClose } = await import("@/components/ui/modal");

afterEach(() => cleanup());

describe("QuantityInput", () => {
  it("menambah dan mengurangi nilai dalam batas, lalu menulis ke input bernama", () => {
    render(
      <form>
        <QuantityInput id="qty" name="quantity" value={2} min={1} max={4} label="Jumlah" />
      </form>,
    );
    const input = screen.getByRole("spinbutton", { name: "Jumlah" }) as HTMLInputElement;
    expect(input.value).toBe("2");
    fireEvent.click(screen.getByRole("button", { name: "Tambah jumlah" }));
    expect(input.value).toBe("3");
    fireEvent.click(screen.getByRole("button", { name: "Kurangi jumlah" }));
    fireEvent.click(screen.getByRole("button", { name: "Kurangi jumlah" }));
    expect(input.value).toBe("1");
  });

  it("tombol non-aktif di batas min/max dan batas dibacakan sebagai teks", () => {
    render(<QuantityInput id="qty2" name="quantity" value={10} min={1} max={10} label="Jumlah" />);
    expect(
      (screen.getByRole("button", { name: "Tambah jumlah" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    const input = screen.getByRole("spinbutton", { name: "Jumlah" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "999" } });
    expect(input.value).toBe("10"); // clamp ke max, tidak pernah kirim angka liar
    expect(screen.getByText(/Minimum 1, maksimum 10/i)).toBeTruthy();
  });

  it("menolak nilai di bawah minimum dan nilai bukan angka", () => {
    render(<QuantityInput id="qty3" name="quantity" value={3} min={2} max={8} label="Jumlah" />);
    const input = screen.getByRole("spinbutton", { name: "Jumlah" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "0" } });
    expect(input.value).toBe("2");
    fireEvent.change(input, { target: { value: "abc" } });
    expect(input.value).toBe("2");
  });

  it("aksesibel: tidak ada pelanggaran pada stepper", async () => {
    const { container } = render(
      <form>
        <QuantityInput id="qty4" name="quantity" value={1} min={1} max={10} label="Jumlah" />
        <button type="submit">Simpan</button>
      </form>,
    );
    const results = await axe.run(container, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    });
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});

describe("Modal", () => {
  // jsdom belum mengimplementasikan <dialog>.showModal(); shim minimal agar jalur UI bisa diuji.
  beforeAll(() => {
    const proto = window.HTMLDialogElement?.prototype as
      (HTMLDialogElement & { showModal?: () => void; close?: () => void }) | undefined;
    if (proto && !proto.showModal) {
      proto.showModal = function showModalDialog(this: HTMLDialogElement) {
        this.open = true;
      };
      proto.close = function closeDialog(this: HTMLDialogElement) {
        this.open = false;
        this.dispatchEvent(new Event("close"));
      };
    }
  });

  const modal = (
    <div>
      <button id="hapus-open" type="button">
        Hapus alamat
      </button>
      <Modal
        id="hapus"
        title="Hapus alamat?"
        description="Alamat masih bisa ditambahkan lagi."
        footer={<ModalClose>Batal</ModalClose>}
      >
        <p>Tindakan ini menghapus alamat dari akun Anda.</p>
      </Modal>
    </div>
  );

  it("tertutup sampai tombol pemicu ditekan, lalu terbuka dengan label yang terhubung", () => {
    const { container } = render(modal);
    const dialog = container.querySelector("dialog") as HTMLDialogElement;
    expect(dialog).not.toBeNull();
    expect(dialog.open).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Hapus alamat" }));
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute("aria-labelledby")).toBe("hapus-title");
    expect(dialog.getAttribute("aria-describedby")).toBe("hapus-desc");
    expect(screen.getByRole("button", { name: "Batal" }).getAttribute("type")).toBe("submit");
    expect(dialog.closest("dialog")).toBe(dialog);
  });

  it("dialog terbuka tidak melanggar aturan aksesibilitas dasar", async () => {
    const { container } = render(modal);
    fireEvent.click(screen.getByRole("button", { name: "Hapus alamat" }));
    const results = await axe.run(container.querySelector("dialog") as Element, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    });
    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  });
});
