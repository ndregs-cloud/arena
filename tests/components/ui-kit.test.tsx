import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import axe from "axe-core";
import type { ReactNode } from "react";

// next/link butuh AppRouter context; di test cukup dirender sebagai <a>.
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

const { Button, ButtonLink } = await import("@/components/ui/button");
const { Alert } = await import("@/components/ui/alert");
const { Badge, StatusChip } = await import("@/components/ui/badge");
const { PriceBlock } = await import("@/components/ui/price");
const { EmptyState, ErrorState } = await import("@/components/ui/state");
const { Stepper } = await import("@/components/ui/stepper");
const { Pagination } = await import("@/components/ui/pagination");
const { Field, TextInput, CheckboxRow, RadioCard } = await import("@/components/ui/field");
const { ProductCard } = await import("@/components/commerce/product-card");
const { formatIDR } = await import("@/lib/format");
import type { ProductSummary } from "@/domain/catalog";

afterEach(() => cleanup());

/** Testing Library menormalkan spasi (termasuk NBSP hasil format Intl) - samakan sebelum dibandingkan. */
function norm(value: string | null): string {
  return (value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const product: ProductSummary = {
  id: "p-1",
  slug: "headphone-aureo-h1",
  name: "Headphone Aureo H1",
  summary: "Peredam bendering untuk perjalanan",
  status: "published",
  brand: "Aureo",
  categoryId: "c-1",
  categorySlug: "audio",
  categoryName: "Audio",
  minPriceAmount: 1_250_000,
  maxPriceAmount: 1_450_000,
  compareAtAmount: 1_500_000,
  currency: "IDR",
  primaryMediaUrl: "/img/products/headphone-aureo-h1-1.svg",
  primaryMediaAlt: "Headphone Aureo H1 - tampilan 1",
  availableQuantity: 4,
  totalVariantQuantity: 12,
  ratingAverage: 4.6,
  reviewCount: 128,
  soldQuantity: 310,
  isNew: true,
  hasPromotion: true,
  stockState: "in_stock",
  publishedAt: new Date("2026-10-01T00:00:00Z"),
  updatedAt: new Date("2026-10-02T00:00:00Z"),
};

describe("kit UI dasar", () => {
  it("Button & ButtonLink punya tinggi sentuh >=44px dan tetap berlabel teks", () => {
    const { getByRole } = render(
      <div>
        <Button type="button">Tambah ke keranjang</Button>
        <ButtonLink href="/keranjang">Lihat keranjang</ButtonLink>
      </div>,
    );
    const button = getByRole("button", { name: "Tambah ke keranjang" });
    expect(button.className).toContain("min-h-[44px]");
    expect(button.className).toContain("bg-brand");
    const link = getByRole("link", { name: "Lihat keranjang" });
    expect(link.getAttribute("href")).toBe("/keranjang");
    expect(link.className).toContain("min-h-[44px]");
  });

  it("Button disabled benar-benar non-aktif (bukan hanya gaya)", () => {
    const { getByRole } = render(<Button disabled>Bayar</Button>);
    expect(getByRole("button", { name: "Bayar" }).hasAttribute("disabled")).toBe(true);
  });

  it("StatusChip selalu menampilkan label teks, bukan warna saja", () => {
    const { container, getByText } = render(
      <div>
        <StatusChip status="pending_payment" label="Menunggu pembayaran" />
        <StatusChip kind="payment" status="succeeded" label="Lunas" />
        <StatusChip kind="shipment" status="in_transit" label="Dalam perjalanan" />
        <StatusChip kind="return" status="awaiting_return" label="Menunggu barang" />
      </div>,
    );
    for (const label of ["Menunggu pembayaran", "Lunas", "Dalam perjalanan", "Menunggu barang"]) {
      expect(getByText(label)).toBeTruthy();
    }
    // titik dekoratif harus aria-hidden supaya pembaca layar tidak menyebut "空".
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThanOrEqual(4);
  });

  it("Alert memakai role alert untuk masalah, status untuk info", () => {
    const { getByRole } = render(
      <div>
        <Alert tone="danger">Stok habis</Alert>
        <Alert tone="info">Ongkir dihitung ulang</Alert>
      </div>,
    );
    expect(getByRole("alert").textContent).toContain("Stok habis");
    expect(getByRole("status").textContent).toContain("Ongkir dihitung ulang");
  });

  it("format harga IDR memakai id-ID, tanpa sen, dan persen hemat ikut tampil", () => {
    const { container } = render(<PriceBlock amount={1_250_000} compareAt={1_500_000} />);
    const text = norm(container.textContent);
    // id-ID: "Rp" + pemisah ribuan titik + tanpa desimal (Rupiah utuh, bukan sen).
    expect(text).toContain("Rp 1.250.000");
    expect(text).toContain("Rp 1.500.000");
    expect(norm(formatIDR(1_250_000))).toBe("Rp 1.250.000");
    expect(formatIDR(1_250_000)).not.toContain(",");
    expect(text).toContain("Hemat 17%");
    expect(container.querySelector(".line-through")).not.toBeNull();
  });

  it("EmptyState & ErrorState memberi jalan keluar, bukan hanya pesan kosong", () => {
    const { getByRole, getByText } = render(
      <div>
        <EmptyState
          title="Keranjang kosong"
          action={<ButtonLink href="/cari">Mulai belanja</ButtonLink>}
        />
        <ErrorState
          title="Gagal memuat"
          description="Coba lagi"
          action={<Button>Coba lagi</Button>}
        />
      </div>,
    );
    expect(getByText("Keranjang kosong")).toBeTruthy();
    expect(getByRole("link", { name: "Mulai belanja" })).toBeTruthy();
    expect(getByRole("alert").textContent).toContain("Gagal memuat");
    expect(getByRole("button", { name: "Coba lagi" })).toBeTruthy();
  });

  it("Stepper menandai langkah saat ini dengan aria-current + teks status", () => {
    const { getByText, container } = render(
      <Stepper
        steps={[
          { id: "alamat", label: "Alamat", href: "/checkout/alamat", state: "done" },
          { id: "pengiriman", label: "Pengiriman", href: "/checkout/pengiriman", state: "current" },
          { id: "pembayaran", label: "Pembayaran", href: "/checkout/pembayaran", state: "todo" },
        ]}
      />,
    );
    expect(getByText("Pengiriman").closest("a")?.getAttribute("aria-current")).toBe("step");
    expect(container.textContent).toContain("(selesai)");
    expect(container.textContent).toContain("(belum bisa diisi)");
    expect(getByText("Pembayaran").getAttribute("aria-disabled")).toBeNull();
  });

  it("Field menghubungkan label, hint, dan error lewat id/aria-describedby", () => {
    const { getByLabelText, getByText } = render(
      <Field label="Kode pos" htmlFor="postal" hint="5 digit" error="Kode pos harus 5 angka">
        <TextInput id="postal" name="postalCode" inputMode="numeric" />
      </Field>,
    );
    const input = getByLabelText(/Kode pos/) as HTMLInputElement;
    expect(input.getAttribute("aria-describedby")).toBe("postal-hint postal-error");
    expect(getByText("Kode pos harus 5 angka").getAttribute("role")).toBe("alert");
    const { getByRole } = render(
      <div>
        <CheckboxRow id="agree" name="terms" label="Setujui syarat" />
        <RadioCard
          id="va"
          name="method"
          value="sim_va"
          title="Virtual Account"
          description="Transfer VA"
          meta="Gratis"
        />
      </div>,
    );
    expect(getByRole("checkbox", { name: "Setujui syarat" })).toBeTruthy();
    expect(getByText("Transfer VA")).toBeTruthy();
  });

  it("Pagination menyembunyikan navigasi saat hanya satu halaman dan memakai tautan", () => {
    const { container } = render(
      <Pagination
        page={1}
        perPage={24}
        total={10}
        base="/cari"
        searchParams={{ q: "headphone" }}
      />,
    );
    expect(container.firstChild).toBeNull();

    const { getByRole } = render(
      <Pagination
        page={2}
        perPage={24}
        total={120}
        base="/cari"
        searchParams={{ q: "headphone" }}
      />,
    );
    const next = getByRole("link", { name: /Berikutnya/i });
    expect(next.getAttribute("href")).toContain("page=3");
    expect(next.getAttribute("href")).toContain("q=headphone");
    expect(getByRole("navigation", { name: /Navigasi halaman/i })).toBeTruthy();
  });

  it("kartu produk: harga, status stok berlabel, dan satu tautan produk", () => {
    const { container, getByText, getByRole } = render(<ProductCard product={product} />);
    expect(getByText("Headphone Aureo H1")).toBeTruthy();
    expect(norm(container.textContent)).toContain("Rp 1.250.000");
    expect(getByText("Tersedia")).toBeTruthy();
    expect(getByText("Baru")).toBeTruthy();
    const image = container.querySelector("img");
    expect(image?.getAttribute("alt")).toBe("Headphone Aureo H1 - tampilan 1");
    expect(getByRole("link", { name: /Headphone Aureo H1/ })).toBeTruthy();
  });

  it("kartu produk stok habis memakai label bahaya, bukan warna saja", () => {
    const { getByText } = render(
      <ProductCard product={{ ...product, stockState: "out_of_stock", availableQuantity: 0 }} />,
    );
    expect(getByText("Stok habis")).toBeTruthy();
  });
});

describe("aksesibilitas komponen (axe-core)", () => {
  const cases: Array<{ name: string; markup: ReactNode }> = [
    {
      name: "kartu produk",
      markup: <ProductCard product={product} />,
    },
    {
      name: "form field + alert + stepper",
      markup: (
        <form>
          <Field label="Email" htmlFor="a1" hint="Untuk invoice digital">
            <TextInput id="a1" name="email" type="email" />
          </Field>
          <CheckboxRow id="a2" name="terms" label="Saya menyetujui syarat & ketentuan" />
          <Alert tone="warning" title="Alamat belum lengkap">
            Lengkapi alamat untuk menghitung ongkir.
          </Alert>
          <Stepper
            steps={[
              { id: "1", label: "Alamat", href: "/checkout/alamat", state: "current" },
              { id: "2", label: "Pengiriman", href: "/checkout/pengiriman", state: "todo" },
            ]}
          />
          <Button type="submit">Lanjut</Button>
        </form>
      ),
    },
    {
      name: "ringkasan total + status",
      markup: (
        <div>
          <PriceBlock amount={2_172_000} compareAt={2_400_000} size="lg" />
          <Badge tone="success">Beres</Badge>
          <StatusChip status="shipped" label="Dikirim" />
          <Pagination page={1} perPage={24} total={120} base="/cari" searchParams={{}} />
        </div>
      ),
    },
  ];

  for (const item of cases) {
    it(`tidak ada pelanggaran WCAG 2.2 pada: ${item.name}`, async () => {
      const { container } = render(<div>{item.markup}</div>);
      const results = await axe.run(container, {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
      });
      const violations = results.violations.map(
        (violation) => `${violation.id}: ${violation.help} (${violation.nodes.length})`,
      );
      expect(violations).toEqual([]);
    });
  }
});
