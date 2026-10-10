import type { Metadata } from "next";
import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { Card, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";

export const metadata: Metadata = {
  title: "Pusat bantuan",
  description: "Cara melacak pesanan, mengajukan retur, dan menghubungi toko.",
  alternates: { canonical: "/bantuan" },
};

const FAQ = [
  {
    q: "Kapan pesanan saya dianggap sudah dibayar?",
    a: "Setelah penyedia pembayaran mengonfirmasi. Status di halaman pesanan berubah otomatis - kami tidak pernah menulis 'lunas' hanya karena Anda menutup halaman pembayaran.",
  },
  {
    q: "Sudah bayar tapi status masih menunggu?",
    a: "Tunggu beberapa menit lalu buka halaman pesanan dan tekan 'Cek status pembayaran'. Bila masih tertahan, kirim nomor virtual account dan bukti transfer ke email dukungan.",
  },
  {
    q: "Bagaimana cara retur?",
    a: "Buka Pesanan saya → detail pesanan → Ajukan retur, maksimal 14 hari setelah barang diterima. Pilih item, isi alasan, dan lampirkan foto bila diminta.",
  },
  {
    q: "Berapa lama refund diterima?",
    a: "Setelah barang diterima dan lolos pemeriksaan, dana dikirim ke metode pembayaran yang sama. Bank biasanya memproses 3-14 hari kerja tergantung penerbit kartu.",
  },
  {
    q: "Bisakah alamat diubah setelah bayar?",
    a: "Selama paket belum diserahkan ke kurir, hubungi dukungan dengan nomor pesanan. Setelah diserahkan, alamat tidak bisa diubah demi keamanan.",
  },
  {
    q: "Nomor pesanan saya hilang, bagaimana melacak?",
    a: "Tautan lacak dikirim ke email saat pesanan dibuat. Anda juga dapat membuka Akun saya → Pesanan bila checkout memakai akun yang sama.",
  },
];

export default function HelpPage() {
  return (
    <div className="page section">
      <div className="mx-auto max-w-[820px]">
        <h1>Pusat bantuan</h1>
        <p className="mt-2 text-[15px] leading-[23px] text-ink-soft">
          Pertanyaan yang paling sering muncul ada di bawah. Untuk kasus lain, hubungi{" "}
          <a className="link" href={`mailto:${BRAND.supportEmail}`}>
            {BRAND.supportEmail}
          </a>{" "}
          ({BRAND.supportHours}) dengan menyertakan nomor pesanan.
        </p>

        <Alert tone="warning" className="mt-4" title="Sistem tiket belum aktif">
          Pada versi ini permintaan bantuan masuk melalui email, bukan dasbor tiket internal. Waktu
          balas target 1x24 jam kerja.
        </Alert>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <Card>
            <CardHeader title="Lacak pesanan" />
            <p className="text-[14px] text-ink-soft">
              Gunakan tautan di email, tanpa perlu masuk akun.
            </p>
            <Link href="/akun/pesanan" className="link mt-2 inline-block text-[14px] font-semibold">
              Buka Pesanan saya →
            </Link>
          </Card>
          <Card>
            <CardHeader title="Retur & refund" />
            <p className="text-[14px] text-ink-soft">
              Ajukan dari detail pesanan; status kasus bisa dipantau.
            </p>
            <Link href="/akun/retur" className="link mt-2 inline-block text-[14px] font-semibold">
              Buka Retur saya →
            </Link>
          </Card>
          <Card>
            <CardHeader title="Kebijakan" />
            <p className="text-[14px] text-ink-soft">
              Pengiriman, retur, privasi, dan syarat &amp; ketentuan.
            </p>
            <Link
              href="/kebijakan/pengiriman"
              className="link mt-2 inline-block text-[14px] font-semibold"
            >
              Baca kebijakan →
            </Link>
          </Card>
        </div>

        <section className="mt-6" aria-labelledby="faq">
          <h2 id="faq">Pertanyaan umum</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {FAQ.map((item) => (
              <li key={item.q}>
                <details className="card card-pad">
                  <summary className="cursor-pointer text-[15px] font-semibold">{item.q}</summary>
                  <p className="mt-2 text-[14px] leading-[21px] text-ink-soft">{item.a}</p>
                </details>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
