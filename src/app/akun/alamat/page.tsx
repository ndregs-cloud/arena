import type { Metadata } from "next";
import Link from "next/link";
import { requireCustomerPage } from "@/server/context";
import { listAddresses } from "@/server/services/account.service";
import {
  deleteAddressAction,
  saveAddressAction,
  setDefaultAddressAction,
} from "@/app/actions/account";
import { PROVINCES } from "@/data/provinces";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { CheckboxRow, Field, TextInput } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/state";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Alamat", robots: { index: false, follow: false } };

export default async function AddressesPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; pesan?: string }>;
}) {
  const { edit, pesan } = await searchParams;
  const ctx = await requireCustomerPage("/akun/alamat");
  const rows = await listAddresses(ctx);
  const editing = edit ? (rows.find((row) => row.id === edit) ?? null) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="flex flex-col gap-3">
        {pesan ? <Alert tone="info">{pesan}</Alert> : null}
        {rows.length === 0 ? (
          <EmptyState
            title="Belum ada alamat tersimpan"
            description="Simpan alamat agar checkout berikutnya lebih cepat."
            icon="⌂"
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((address) => (
              <li key={address.id}>
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="flex flex-wrap items-center gap-2 font-semibold">
                        {address.fullName}
                        {address.isDefault ? <Badge tone="brand">Utama</Badge> : null}
                        {address.label && address.label !== "lainnya" ? (
                          <Badge tone="neutral">{address.label}</Badge>
                        ) : null}
                      </p>
                      <p className="mt-1 text-[14px] leading-[21px] text-ink-soft">
                        {address.street}
                        {address.landmark ? `, ${address.landmark}` : ""}
                        <br />
                        {address.district}, {address.city}, {address.province} {address.postalCode}
                        <br />
                        {address.phone}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link
                        href={`/akun/alamat?edit=${address.id}`}
                        className="min-h-[36px] inline-flex items-center rounded-control border border-border px-3 text-[13px] font-semibold hover:bg-canvas"
                      >
                        Ubah
                      </Link>
                      {!address.isDefault ? (
                        <form action={setDefaultAddressAction}>
                          <input type="hidden" name="id" value={address.id} />
                          <button
                            type="submit"
                            className="min-h-[36px] rounded-control border border-border px-3 text-[13px] font-semibold hover:bg-canvas"
                          >
                            Jadikan utama
                          </button>
                        </form>
                      ) : null}
                      <form action={deleteAddressAction}>
                        <input type="hidden" name="id" value={address.id} />
                        <button
                          type="submit"
                          className="min-h-[36px] rounded-control px-3 text-[13px] font-semibold text-danger hover:bg-danger-soft"
                        >
                          Hapus
                        </button>
                      </form>
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Card as="section">
        <CardHeader
          title={editing ? "Ubah alamat" : "Tambah alamat"}
          subtitle="Maksimal 20 alamat per akun."
        />
        <form action={saveAddressAction} className="grid gap-3 sm:grid-cols-2">
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
          <Field label="Label" htmlFor="addr-label">
            <select
              id="addr-label"
              name="label"
              className="control"
              defaultValue={editing?.label ?? "rumah"}
            >
              <option value="rumah">Rumah</option>
              <option value="kantor">Kantor</option>
              <option value="lainnya">Lainnya</option>
            </select>
          </Field>
          <Field label="Nama penerima" htmlFor="addr-name" required>
            <TextInput
              id="addr-name"
              name="fullName"
              required
              defaultValue={editing?.fullName ?? ctx.user?.fullName ?? ""}
            />
          </Field>
          <Field label="Ponsel" htmlFor="addr-phone" required>
            <TextInput
              id="addr-phone"
              name="phone"
              inputMode="tel"
              required
              defaultValue={editing?.phone ?? ""}
            />
          </Field>
          <Field label="Provinsi" htmlFor="addr-province" required>
            <select
              id="addr-province"
              name="province"
              className="control"
              defaultValue={editing?.province ?? "DKI Jakarta"}
            >
              {PROVINCES.map((province) => (
                <option key={province} value={province}>
                  {province}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Kota / Kabupaten" htmlFor="addr-city" required>
            <TextInput id="addr-city" name="city" required defaultValue={editing?.city ?? ""} />
          </Field>
          <Field label="Kecamatan" htmlFor="addr-district" required>
            <TextInput
              id="addr-district"
              name="district"
              required
              defaultValue={editing?.district ?? ""}
            />
          </Field>
          <Field label="Kode pos" htmlFor="addr-postal" required>
            <TextInput
              id="addr-postal"
              name="postalCode"
              inputMode="numeric"
              pattern="[0-9]{5}"
              required
              defaultValue={editing?.postalCode ?? ""}
            />
          </Field>
          <Field label="Patokan" htmlFor="addr-landmark">
            <TextInput id="addr-landmark" name="landmark" defaultValue={editing?.landmark ?? ""} />
          </Field>
          <Field label="Alamat lengkap" htmlFor="addr-street" required className="sm:col-span-2">
            <TextInput
              id="addr-street"
              name="street"
              required
              defaultValue={editing?.street ?? ""}
            />
          </Field>
          <div className="sm:col-span-2">
            <CheckboxRow
              id="addr-default"
              name="isDefault"
              label="Jadikan alamat utama"
              defaultChecked={editing?.isDefault ?? rows.length === 0}
            />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" size="sm">
              {editing ? "Simpan perubahan" : "Simpan alamat"}
            </Button>
            {editing ? (
              <Link
                href="/akun/alamat"
                className="min-h-[36px] inline-flex items-center rounded-control border border-border px-3 text-[13px] font-semibold"
              >
                Batal
              </Link>
            ) : null}
          </div>
        </form>
      </Card>
    </div>
  );
}
