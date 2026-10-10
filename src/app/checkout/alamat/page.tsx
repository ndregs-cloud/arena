import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card, CardHeader } from "@/components/ui/card";
import { CheckboxRow, Field, TextInput } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { PROVINCES } from "@/data/provinces";
import { getRequestContext } from "@/server/context";
import { getCartView } from "@/server/services/cart.service";
import { listAddresses } from "@/server/services/account.service";
import { saveAddressStepAction } from "@/app/actions/checkout";
import { useAddressAtCheckoutAction } from "@/app/actions/account";
import { RadioCard } from "@/components/ui/field";

export const metadata: Metadata = {
  title: "Checkout - alamat",
  robots: { index: false, follow: false },
};

export default async function AddressStep({
  searchParams,
}: {
  searchParams: Promise<{ pesan?: string }>;
}) {
  const notice = (await searchParams).pesan;
  const ctx = await getRequestContext();
  const view = await getCartView(ctx);
  const draft = view.draft;
  const saved = ctx.user ? await listAddresses(ctx).catch(() => []) : [];
  const address = draft.address;

  return (
    <div className="flex flex-col gap-4">
      {notice ? <Alert tone="danger">{notice}</Alert> : null}
      {!ctx.user ? (
        <Alert tone="info" title="Belanja sebagai tamu">
          Anda dapat lanjut tanpa akun.{" "}
          <Link href="/masuk?setelah=/checkout/alamat" className="link font-semibold">
            Masuk
          </Link>{" "}
          untuk memakai alamat tersimpan dan melacak pesanan di akun Anda.
        </Alert>
      ) : null}

      {saved.length > 0 ? (
        <Card>
          <CardHeader
            title="Alamat tersimpan"
            subtitle="Pilih salah satu untuk langsung lanjut ke pengiriman."
          />
          <form action={useAddressAtCheckoutAction} className="flex flex-col gap-2">
            {saved.map((item, index) => (
              <RadioCard
                key={item.id}
                id={`saved-${item.id}`}
                name="id"
                value={item.id}
                defaultChecked={index === 0}
                title={item.fullName}
                description={`${item.street}${item.landmark ? ` (${item.landmark})` : ""}, ${item.district}, ${item.city}, ${item.province} ${item.postalCode} · ${item.phone}`}
                meta={item.isDefault ? "Utama" : undefined}
              />
            ))}
            <div>
              <Button type="submit" size="sm" variant="secondary">
                Gunakan alamat terpilih
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Alamat pengiriman"
          subtitle="Nomor ponsel dipakai kurir untuk konfirmasi sebelum tiba."
        />
        <form action={saveAddressStepAction} className="grid gap-4 sm:grid-cols-2">
          <Field label="Nama penerima" htmlFor="fullName" required>
            <TextInput
              id="fullName"
              name="fullName"
              required
              autoComplete="name"
              defaultValue={address?.fullName ?? ctx.user?.fullName ?? ""}
            />
          </Field>
          <Field label="Nomor ponsel" htmlFor="phone" required hint="Format 08xx… (10-15 digit)">
            <TextInput
              id="phone"
              name="phone"
              required
              inputMode="tel"
              autoComplete="tel"
              defaultValue={address?.phone ?? ctx.user?.phone ?? ""}
            />
          </Field>
          <Field
            label="Email status pesanan"
            htmlFor="email"
            required
            hint="Untuk invoice digital & tautan lacak."
          >
            <TextInput
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              defaultValue={draft.contact?.email ?? ctx.user?.email ?? ""}
            />
          </Field>
          <Field label="Provinsi" htmlFor="province" required>
            <select
              id="province"
              name="province"
              required
              className="control"
              defaultValue={address?.province ?? "DKI Jakarta"}
            >
              {PROVINCES.map((province) => (
                <option key={province} value={province}>
                  {province}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Kota / Kabupaten" htmlFor="city" required>
            <TextInput id="city" name="city" required defaultValue={address?.city ?? ""} />
          </Field>
          <Field label="Kecamatan" htmlFor="district" required>
            <TextInput
              id="district"
              name="district"
              required
              defaultValue={address?.district ?? ""}
            />
          </Field>
          <Field label="Kode pos" htmlFor="postalCode" required hint="5 digit.">
            <TextInput
              id="postalCode"
              name="postalCode"
              required
              inputMode="numeric"
              pattern="[0-9]{5}"
              defaultValue={address?.postalCode ?? ""}
            />
          </Field>
          <Field label="Patokan" htmlFor="landmark">
            <TextInput
              id="landmark"
              name="landmark"
              defaultValue={address?.landmark ?? ""}
              placeholder="Mis. sebelah masjid, gerbang biru"
            />
          </Field>
          <Field
            label="Alamat lengkap"
            htmlFor="street"
            required
            className="sm:col-span-2"
            hint="Jalan, nomor rumah, RT/RW, desa/kelurahan."
          >
            <TextInput id="street" name="street" required defaultValue={address?.street ?? ""} />
          </Field>
          {ctx.user ? (
            <div className="sm:col-span-2">
              <CheckboxRow
                id="save-address"
                name="saveToAccount"
                label="Simpan alamat ini ke akun saya"
                hint="Bisa dihapus kapan saja dari halaman akun."
              />
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2">
            <Link href="/keranjang" className="link text-[14px]">
              ← Kembali ke keranjang
            </Link>
            <Button type="submit">Lanjut ke pengiriman</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
