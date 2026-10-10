/**
 * Identitas merek. Nama "NOVA STORE" adalah placeholder proyek (Blueprint §1: merek final
 * ditentukan pemilik toko); ganti di satu tempat ini, bukan di setiap halaman.
 */
export const BRAND = {
  name: "NOVA STORE",
  legalName: "PT Nova Retail Indonesia (contoh)",
  tagline: "Elektronik & gaya hidup, dikirim dari Jakarta",
  supportEmail: "halo@ndre.gstore.test",
  supportHours: "Senin-Sabtu 09.00-18.00 WIB",
  /** Tautan sosial/kebijakan - placeholder, diisi saat akun resmi tersedia. */
  social: [] as Array<{ label: string; href: string }>,
} as const;

export const SIMULATION_NOTE =
  "Lingkungan demo: pembayaran & kurir memakai adapter simulasi lokal. Tidak ada dana nyata, nomor rekening nyata, atau resi kurir nyata.";
