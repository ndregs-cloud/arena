/**
 * RBAC (Blueprint §3). Default deny + permission granular, dipisahkan dari role.
 * Enforce SELALU di server; menyembunyikan tombol di UI bukan pengamanan.
 */

export const PERMISSIONS = [
  "catalog.view",
  "catalog.view_draft",
  "catalog.create",
  "catalog.update",
  "catalog.publish",
  "catalog.archive",
  "product.price.update",
  "inventory.view",
  "inventory.adjust",
  "inventory.approve",
  "order.view",
  "order.process",
  "order.cancel",
  "order.refund",
  "refund.approve",
  "shipment.manage",
  "tracking.manage",
  "return.manage",
  "return.approve",
  "customer.view",
  "customer.pii.view",
  "customer.manage",
  "promotion.manage",
  "promotion.approve",
  "content.manage",
  "report.view",
  "finance.view",
  "audit.view",
  "user.manage",
  "user.role.assign",
  "settings.manage",
  "integration.manage",
  "review.moderate",
  "export.data",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = [
  "customer",
  "catalog_editor",
  "merchandiser",
  "order_operator",
  "customer_support",
  "warehouse_operator",
  "finance",
  "manager",
  "system_admin",
  "auditor",
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  customer: "Pelanggan",
  catalog_editor: "Katalog editor",
  merchandiser: "Merchandiser / marketing",
  order_operator: "Operator pesanan",
  customer_support: "Customer support",
  warehouse_operator: "Operator gudang",
  finance: "Finance",
  manager: "Manager / approver",
  system_admin: "System administrator",
  auditor: "Auditor (read-only)",
};

/** Larangan default per role juga ditulis (Blueprint §3 tabel "Larangan / batasan default"). */
export const ROLE_RESTRICTIONS: Partial<Record<Role, string>> = {
  catalog_editor: "Perubahan harga di atas ambang butuh approval manager.",
  merchandiser: "Tidak dapat mengubah ledger pembayaran atau memberi refund.",
  order_operator: "Refund bernilai tinggi butuh approval.",
  customer_support: "Data sensitif disamarkan; aksi finansial mengikuti approval.",
  warehouse_operator: "Tidak dapat mengubah harga, data pembayaran, atau kebijakan.",
  finance: "Tidak otomatis mendapat akses konfigurasi keamanan.",
  manager: "Tidak boleh menghapus audit record.",
  system_admin: "Akses istimewa diaudit; break-glass dipakai terpisah.",
  auditor: "Tidak melakukan mutation.",
};

const ALL = PERMISSIONS;

const GRANTS: Record<Role, readonly Permission[]> = {
  customer: [],
  catalog_editor: [
    "catalog.view",
    "catalog.view_draft",
    "catalog.create",
    "catalog.update",
    "catalog.archive",
    "inventory.view",
  ],
  merchandiser: [
    "catalog.view",
    "catalog.view_draft",
    "promotion.manage",
    "content.manage",
    "report.view",
    "review.moderate",
  ],
  order_operator: [
    "catalog.view",
    "inventory.view",
    "order.view",
    "order.process",
    "order.cancel",
    "shipment.manage",
    "tracking.manage",
    "return.manage",
    "customer.view",
  ],
  customer_support: [
    "catalog.view",
    "order.view",
    "customer.view",
    "return.manage",
    "review.moderate",
  ],
  warehouse_operator: [
    "catalog.view",
    "inventory.view",
    "inventory.adjust",
    "order.view",
    "shipment.manage",
  ],
  finance: [
    "order.view",
    "finance.view",
    "report.view",
    "return.manage",
    "refund.approve",
    "export.data",
    "audit.view",
  ],
  manager: [
    "catalog.view",
    "catalog.view_draft",
    "catalog.publish",
    "product.price.update",
    "inventory.view",
    "inventory.approve",
    "order.view",
    "order.process",
    "order.cancel",
    "order.refund",
    "refund.approve",
    "shipment.manage",
    "return.manage",
    "return.approve",
    "customer.view",
    "customer.pii.view",
    "promotion.manage",
    "promotion.approve",
    "report.view",
    "finance.view",
    "audit.view",
    "export.data",
  ],
  system_admin: [...ALL],
  auditor: [
    "catalog.view",
    "catalog.view_draft",
    "inventory.view",
    "order.view",
    "customer.view",
    "report.view",
    "finance.view",
    "audit.view",
  ],
};

export function permissionsForRole(role: Role): Permission[] {
  return [...(GRANTS[role] ?? [])];
}

export function permissionsForRoles(roles: readonly Role[]): Set<Permission> {
  const set = new Set<Permission>();
  for (const role of roles) {
    for (const p of permissionsForRole(role)) set.add(p);
  }
  return set;
}

/** Default deny: akses ditolak kecuali diizinkan secara eksplisit. */
export function can(
  permissions: ReadonlySet<Permission> | readonly Permission[],
  permission: Permission,
): boolean {
  if (Array.isArray(permissions)) {
    return (permissions as readonly Permission[]).includes(permission);
  }
  return (permissions as ReadonlySet<Permission>).has(permission);
}

export function canAll(permissions: ReadonlySet<Permission>, list: readonly Permission[]): boolean {
  return list.every((p) => permissions.has(p));
}

export function canAny(permissions: ReadonlySet<Permission>, list: readonly Permission[]): boolean {
  if (list.length === 0) return true;
  return list.some((p) => permissions.has(p));
}

/** Aksi yang hanya boleh dilakukan pelanggan atas datanya sendiri (AT-07). */
export function ownsOrder(orderOwnerId: string | null, actorId: string): boolean {
  return orderOwnerId !== null && orderOwnerId === actorId;
}

/** Pelabelan role untuk menu admin: apa saja yang boleh dilihat pengguna dengan set permission ini. */
export function adminNavForPermissions(permissions: ReadonlySet<Permission>): string[] {
  const nav: string[] = [];
  if (can(permissions, "catalog.view") || can(permissions, "catalog.create"))
    nav.push("/admin/katalog");
  if (can(permissions, "inventory.view")) nav.push("/admin/inventaris");
  if (can(permissions, "order.view")) nav.push("/admin/pesanan");
  if (can(permissions, "return.manage") || can(permissions, "return.approve"))
    nav.push("/admin/retur");
  if (can(permissions, "customer.view")) nav.push("/admin/pelanggan");
  if (can(permissions, "promotion.manage")) nav.push("/admin/promosi");
  if (can(permissions, "report.view")) nav.push("/admin/laporan");
  if (can(permissions, "audit.view")) nav.push("/admin/audit");
  if (can(permissions, "user.manage") || can(permissions, "settings.manage"))
    nav.push("/admin/pengaturan");
  return nav;
}

const MASK_KEEP = 2;

/** PII disamarkan pada daftar/log untuk peran non-finance (Blueprint §8.1, §13.3). */
export function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!name || !domain) return "***";
  const head = name.slice(0, MASK_KEEP);
  return `${head}${"*".repeat(Math.max(2, name.length - head.length))}@${domain}`;
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return "***";
  return `${digits.slice(0, 4)}****${digits.slice(-2)}`;
}

export function maskStreet(street: string): string {
  const parts = street.trim().split(/\s+/);
  if (parts.length <= 1) return "Alamat lengkap disembunyikan";
  return `${parts[0]} ${parts[1] ?? ""} ••• (disembunyikan)`.replace(/\s+/g, " ");
}
