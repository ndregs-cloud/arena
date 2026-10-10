import { AppError } from "@/domain/errors";
import type { CurrencyCode } from "@/domain/money";

/**
 * State machine order (Blueprint §9.1-§9.2). Status hanya boleh berubah lewat command
 * yang memvalidasi transisi + permission + prasyarat; tidak ada "edit status bebas".
 */

export const ORDER_STATUSES = [
  "pending_payment",
  "paid",
  "processing",
  "on_hold",
  "shipped",
  "delivered",
  "completed",
  "cancelled",
  "return_requested",
  "return_approved",
  "returned",
  "refunded",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = [
  "unconfirmed",
  "awaiting_payment",
  "pending",
  "succeeded",
  "failed",
  "expired",
  "partially_refunded",
  "refunded",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const FULFILLMENT_STATUSES = [
  "unfulfilled",
  "picking",
  "packed",
  "shipped",
  "delivered",
  "partially_returned",
  "returned",
  "cancelled",
] as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

export const ORDER_EVENT_VISIBILITY = ["customer", "internal"] as const;
export type OrderEventVisibility = (typeof ORDER_EVENT_VISIBILITY)[number];

export interface OrderLineSnapshot {
  orderItemId: string;
  productId: string;
  variantId: string;
  sku: string;
  nameSnapshot: string;
  variantLabelSnapshot: string;
  unitPriceAmount: number;
  quantity: number;
  discountAllocatedAmount: number;
  lineTotalAmount: number;
  imageUrl: string | null;
  isReturnable: boolean;
}

export interface AddressSnapshot {
  fullName: string;
  phone: string;
  province: string;
  city: string;
  district: string;
  postalCode: string;
  street: string;
  landmark: string | null;
  zoneCode: ShippingZoneCode;
}

export type ShippingZoneCode =
  "JAWA" | "SUMATERA" | "BALI_NUSA" | "KALIMANTAN" | "SULAWESI_TIMUR" | "PAPUA";

export interface OrderSnapshot {
  id: string;
  orderNumber: string;
  trackingToken: string;
  customerId: string | null;
  email: string;
  phone: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  currency: CurrencyCode;
  subtotalAmount: number;
  discountAmount: number;
  shippingAmount: number;
  feeAmount: number;
  totalAmount: number;
  refundedAmount: number;
  promotionId: string | null;
  shippingAddress: AddressSnapshot;
  shippingSelection: {
    carrierCode: string;
    serviceCode: string;
    serviceName: string;
    estimateLabel: string;
  };
  lines: OrderLineSnapshot[];
  policyVersion: string;
  marketingConsent: boolean;
  campaignSource: string | null;
  createdAt: Date;
  updatedAt: Date;
  paidAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  internalNoteCount: number;
  customerNote: string | null;
}

export interface TransitionRule {
  to: OrderStatus;
  /** Prasyarat yang dievaluasi oleh service (lihat guardFor). */
  requires: Array<
    | "payment_succeeded"
    | "no_active_shipment"
    | "shipment_created"
    | "shipment_delivered"
    | "return_approved"
    | "refund_settled"
    | "cancel_reason"
    | "never"
  >;
  /** Efek samping yang WAJIB terjadi pada transisi ini (dijalankan service dalam transaksi yang sama). */
  effects: Array<
    | "set_paid_at"
    | "enqueue_fulfillment"
    | "release_reservations"
    | "consume_reservations"
    | "set_shipped_at"
    | "set_delivered_at"
    | "set_cancelled_at"
    | "notify_customer"
    | "open_refund"
    | "prevent_new_returns"
  >;
  description: string;
}

/** Tabel transisi. Sumber kebenaran untuk UI (tombol mana yang tampil) dan API (mana yang sah). */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly TransitionRule[]> = {
  pending_payment: [
    {
      to: "paid",
      requires: ["payment_succeeded"],
      effects: ["set_paid_at", "enqueue_fulfillment", "consume_reservations", "notify_customer"],
      description: "Provider mengonfirmasi pembayaran; amount/currency/order reference cocok.",
    },
    {
      to: "cancelled",
      requires: [],
      effects: ["release_reservations", "set_cancelled_at", "notify_customer"],
      description: "Batas waktu habis atau dibatalkan; belum ada capture sukses.",
    },
  ],
  paid: [
    {
      to: "processing",
      requires: ["payment_succeeded"],
      effects: ["enqueue_fulfillment"],
      description: "Aturan fraud/approval lolos; alokasi stok valid.",
    },
    {
      to: "on_hold",
      requires: ["cancel_reason"],
      effects: [],
      description: "Ditahan untuk verifikasi/manual review.",
    },
    {
      to: "cancelled",
      requires: ["cancel_reason"],
      effects: ["release_reservations", "open_refund", "set_cancelled_at", "notify_customer"],
      description: "Pembatalan setelah bayar wajib melalui ledger refund.",
    },
  ],
  processing: [
    {
      to: "shipped",
      requires: ["payment_succeeded", "shipment_created"],
      effects: ["set_shipped_at", "consume_reservations", "notify_customer"],
      description: "Paket & shipment tercatat; carrier reference tervalidasi.",
    },
    {
      to: "on_hold",
      requires: ["cancel_reason"],
      effects: [],
      description: "Eksepsi gudang/kurir.",
    },
    {
      to: "cancelled",
      requires: ["cancel_reason", "no_active_shipment"],
      effects: ["release_reservations", "open_refund", "set_cancelled_at", "notify_customer"],
      description: "Hanya sebelum paket keluar dari gudang.",
    },
  ],
  on_hold: [
    {
      to: "processing",
      requires: ["payment_succeeded"],
      effects: [],
      description: "Dilanjutkan setelah klarifikasi.",
    },
    {
      to: "cancelled",
      requires: ["cancel_reason"],
      effects: ["release_reservations", "open_refund", "set_cancelled_at", "notify_customer"],
      description: "Dibatalkan dari hold; stok dikembalikan, refund diajukan.",
    },
  ],
  shipped: [
    {
      to: "delivered",
      requires: ["shipment_delivered"],
      effects: ["set_delivered_at", "notify_customer"],
      description: "Kurir mengonfirmasi terkirim.",
    },
    {
      to: "on_hold",
      requires: ["cancel_reason"],
      effects: [],
      description: "Eksepsi pengiriman (gagal kirim, alamat).",
    },
  ],
  delivered: [
    {
      to: "completed",
      requires: [],
      effects: ["prevent_new_returns"],
      description: "Riwayat final setelah masa retur selesai.",
    },
    {
      to: "return_requested",
      requires: [],
      effects: ["notify_customer"],
      description: "Pelanggan mengajukan retur dalam batas kebijakan.",
    },
  ],
  completed: [
    {
      to: "return_requested",
      requires: [],
      effects: ["notify_customer"],
      description: "Retur diajukan setelah selesai (bila kebijakan masih mengizinkan).",
    },
  ],
  return_requested: [
    {
      to: "return_approved",
      requires: [],
      effects: ["notify_customer"],
      description: "Customer service menyetujui pengembalian.",
    },
    {
      to: "completed",
      requires: ["cancel_reason"],
      effects: ["notify_customer"],
      description: "Retur ditolak; order kembali ke kondisi akhir.",
    },
  ],
  return_approved: [
    {
      to: "returned",
      requires: ["refund_settled"],
      effects: ["notify_customer"],
      description: "Barang diterima + diperiksa + penyelesaian (refund) terkonfirmasi.",
    },
    {
      to: "completed",
      requires: ["cancel_reason"],
      effects: ["notify_customer"],
      description: "Retur ditutup tanpa refund (ditolak setelah inspeksi).",
    },
  ],
  returned: [
    {
      to: "refunded",
      requires: ["refund_settled"],
      effects: ["open_refund", "notify_customer"],
      description: "Refund terkonfirmasi provider; ledger refund final.",
    },
  ],
  cancelled: [],
  refunded: [],
};

export function allowedTransitions(from: OrderStatus): TransitionRule[] {
  return [...(ORDER_TRANSITIONS[from] ?? [])];
}

export function findTransition(from: OrderStatus, to: OrderStatus): TransitionRule | null {
  return allowedTransitions(from).find((t) => t.to === to) ?? null;
}

/**
 * Guard utama. Dipanggil service SEBELUM menulis.
 * Invariant Blueprint §9.1: order unpaid tidak ke gudang; delivered tidak langsung cancelled;
 * refund tidak melebihi refundable.
 */
export function assertTransitionAllowed(
  order: OrderSnapshot,
  to: OrderStatus,
  ctx: { shipmentState?: string | null; reasonProvided?: boolean } = {},
): TransitionRule {
  const rule = findTransition(order.status, to);
  if (!rule) {
    throw new AppError(
      "INVALID_STATE_TRANSITION",
      `Status tidak dapat diubah dari ${labelStatus(order.status)} ke ${labelStatus(to)}.`,
      {
        status: 422,
        details: {
          from: order.status,
          to,
          allowed: allowedTransitions(order.status).map((t) => t.to),
        },
      },
    );
  }
  for (const requirement of rule.requires) {
    switch (requirement) {
      case "payment_succeeded":
        if (order.paymentStatus !== "succeeded") {
          throw new AppError(
            "PAYMENT_NOT_CONFIRMED",
            "Pembayaran belum terkonfirmasi oleh penyedia. Pesanan tidak dapat diproses.",
            {
              status: 422,
              details: { paymentStatus: order.paymentStatus },
            },
          );
        }
        break;
      case "no_active_shipment":
        if (ctx.shipmentState && !["none", "cancelled"].includes(ctx.shipmentState)) {
          throw new AppError(
            "CONFLICT",
            "Paket sudah keluar dari gudang. Gunakan proses retur, bukan pembatalan.",
            { status: 409 },
          );
        }
        break;
      case "shipment_created":
        if (
          ctx.shipmentState !== "created" &&
          ctx.shipmentState !== "label_ready" &&
          ctx.shipmentState !== "in_transit"
        ) {
          throw new AppError(
            "VALIDATION_FAILED",
            "Nomor resi/paket belum dicatat untuk order ini.",
            { status: 422 },
          );
        }
        break;
      case "shipment_delivered":
        if (ctx.shipmentState !== "delivered") {
          throw new AppError(
            "VALIDATION_FAILED",
            "Status terkirim belum dikonfirmasi sumber tracking.",
            { status: 422 },
          );
        }
        break;
      case "refund_settled":
        if (!["refunded", "partially_refunded"].includes(order.paymentStatus)) {
          throw new AppError(
            "PAYMENT_NOT_CONFIRMED",
            "Refund belum terkonfirmasi. Jangan menandai retur selesai sebelum ledger keuangan final.",
            {
              status: 422,
            },
          );
        }
        break;
      case "cancel_reason":
        if (!ctx.reasonProvided) {
          throw new AppError("VALIDATION_FAILED", "Tindakan ini wajib menyertakan alasan.", {
            status: 422,
          });
        }
        break;
      case "return_approved":
        if (order.status !== "return_approved") {
          throw new AppError("INVALID_STATE_TRANSITION", "Retur harus disetujui terlebih dahulu.", {
            status: 422,
          });
        }
        break;
      case "never":
        throw new AppError(
          "INVALID_STATE_TRANSITION",
          "Transisi ini dinonaktifkan oleh kebijakan.",
          { status: 422 },
        );
    }
  }
  return rule;
}

export function assertCanCancelAutomatically(order: OrderSnapshot): void {
  if (["shipped", "delivered", "completed", "returned", "refunded"].includes(order.status)) {
    throw new AppError(
      "INVALID_STATE_TRANSITION",
      "Pesanan yang sudah dikirim tidak dapat dibatalkan; ajukan retur.",
      { status: 422 },
    );
  }
}

/** Nilai masih dapat di-refund = total - (diskon dialokasikan ke baris yang diretur) - refund sebelumnya. */
export function refundableAmount(order: OrderSnapshot): number {
  return Math.max(0, order.totalAmount - order.refundedAmount);
}

export function lineRefundable(line: OrderLineSnapshot): number {
  return Math.max(0, line.lineTotalAmount - line.discountAllocatedAmount);
}

export function labelStatus(status: OrderStatus): string {
  return ORDER_STATUS_LABELS[status] ?? status;
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: "Menunggu pembayaran",
  paid: "Dibayar",
  processing: "Diproses",
  on_hold: "Ditahan sementara",
  shipped: "Dikirim",
  delivered: "Tiba di alamat",
  completed: "Selesai",
  cancelled: "Dibatalkan",
  return_requested: "Retur diajukan",
  return_approved: "Retur disetujui",
  returned: "Barang retur diterima",
  refunded: "Dana dikembalikan",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  unconfirmed: "Belum terkonfirmasi",
  awaiting_payment: "Menunggu pembayaran",
  pending: "Pembayaran diproses",
  succeeded: "Pembayaran berhasil",
  failed: "Pembayaran gagal",
  expired: "Batas waktu bayar habis",
  partially_refunded: "Sebagian dana dikembalikan",
  refunded: "Dana dikembalikan",
};

export const FULFILLMENT_STATUS_LABELS: Record<FulfillmentStatus, string> = {
  unfulfilled: "Belum diproses",
  picking: "Sedang dipick",
  packed: "Dipak",
  shipped: "Diserahkan ke kurir",
  delivered: "Terkirim",
  partially_returned: "Sebagian diretur",
  returned: "Diretur",
  cancelled: "Dibatalkan",
};

/** Pemetaan tampilan status -> tone semantik (desain §11.2). Warna SELALU disertai label teks. */
export const STATUS_TONES = {
  pending_payment: "warning",
  paid: "info",
  processing: "info",
  on_hold: "warning",
  shipped: "info",
  delivered: "success",
  completed: "success",
  cancelled: "neutral",
  return_requested: "warning",
  return_approved: "warning",
  returned: "info",
  refunded: "neutral",
} as const satisfies Record<OrderStatus, "warning" | "info" | "success" | "neutral">;
