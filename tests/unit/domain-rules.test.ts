import { describe, expect, it } from "vitest";
import {
  allowedTransitions,
  assertCanCancelAutomatically,
  assertTransitionAllowed,
  findTransition,
  labelStatus,
  lineRefundable,
  refundableAmount,
} from "@/domain/orders";
import { AppError } from "@/domain/errors";
import { ORDER_STATUS_LABELS, type OrderSnapshot } from "@/domain/orders";
import {
  computeReturnRefund,
  evaluateReturnEligibility,
  reasonRequiresPhoto,
  remainingReturnableQuantity,
  RETURN_REASONS,
  shouldRefundShipping,
  shouldRestockOnResolution,
  assertReturnTransition,
  returnWindowEndsAt,
} from "@/domain/returns";
import {
  assertWithinRefundable,
  isTerminal,
  refundableAmountOfOrder,
  requiresApproval,
  assertAttemptTransition,
  webhookDedupeKey,
  assertEventMatchesAttempt,
  type PaymentAttempt,
  type NormalizedPaymentEvent,
} from "@/domain/payments";
import {
  adminNavForPermissions,
  can,
  canAll,
  canAny,
  maskEmail,
  maskPhone,
  maskStreet,
  ownsOrder,
  permissionsForRole,
  permissionsForRoles,
} from "@/domain/rbac";
import {
  availableToSell,
  isReservationExpired,
  isSellable,
  requiresStockApproval,
  validateAdjustment,
  reservationTtlMinutes,
} from "@/domain/inventory";
import {
  mapProviderTrackingState,
  quoteSimulatedServices,
  shouldApplyTrackingEvent,
  zoneForProvince,
  isQuoteExpired,
  SHIPMENT_STATUS_LABELS,
} from "@/domain/shipping";
import {
  computeStockView,
  discountPercentage,
  deriveSlug,
  isPubliclyVisible,
  primaryMedia,
  type ProductVariant,
} from "@/domain/catalog";
import { isValidIdPhone, isValidPostalCode, normalizePhone } from "@/domain/validation";
import { ID_PHONE_RE } from "@/domain/validation";
import {
  generateOrderNumber,
  generateReference,
  generateSimulatedVaNumber,
  generateTrackingToken,
} from "@/domain/ids";
import {
  base32Decode,
  base32Encode,
  totpCode,
  verifyTotp,
  generateTotpSecret,
} from "@/platform/totp";
import { randomBytes } from "node:crypto";
void randomBytes;
import { makeLine, makeOrder } from "../helpers/order-fixture";

describe("transisi status pesanan (Blueprint §6.4 - satu sumber kebenaran)", () => {
  it("menunggu pembayaran dapat dibayar (dengan efek) atau dibatalkan", () => {
    const targets = allowedTransitions("pending_payment").map((t) => t.to);
    expect(targets).toEqual(expect.arrayContaining(["paid", "cancelled"]));
    const toPaid = findTransition("pending_payment", "paid");
    expect(toPaid?.effects).toEqual(
      expect.arrayContaining(["set_paid_at", "consume_reservations", "notify_customer"]),
    );
    expect(findTransition("pending_payment", "cancelled")?.effects).toContain(
      "release_reservations",
    );
  });

  it("pembayaran belum terkonfirmasi memblokir pemrosesan", () => {
    const order = makeOrder({ status: "pending_payment", paymentStatus: "awaiting_payment" });
    expect(() => assertTransitionAllowed(order, "paid", {})).toThrowError(/belum terkonfirmasi/);
    try {
      assertTransitionAllowed(order, "paid", {});
    } catch (error) {
      expect((error as AppError).code).toBe("PAYMENT_NOT_CONFIRMED");
    }
  });

  it("pakit yang sudah keluar gudang tidak bisa dibatalkan - harus lewat retur", () => {
    const order = makeOrder({ status: "processing" });
    expect(() =>
      assertTransitionAllowed(order, "cancelled", {
        reasonProvided: true,
        shipmentState: "in_transit",
      }),
    ).toThrowError(/keluar dari gudang/);
    expect(() =>
      assertTransitionAllowed(order, "cancelled", { reasonProvided: true, shipmentState: "none" }),
    ).not.toThrow();
    expect(() =>
      assertTransitionAllowed(makeOrder({ status: "shipped" }), "cancelled", {
        reasonProvided: true,
        shipmentState: "in_transit",
      }),
    ).toThrowError(/tidak dapat diubah/);
  });

  it("pembatalan wajib disertai alasan dan melewati ledger refund", () => {
    expect(() =>
      assertTransitionAllowed(makeOrder({ status: "paid" }), "cancelled", {
        reasonProvided: false,
      }),
    ).toThrowError();
    const rule = assertTransitionAllowed(makeOrder({ status: "paid" }), "cancelled", {
      reasonProvided: true,
    });
    expect(rule.effects).toEqual(
      expect.arrayContaining(["release_reservations", "open_refund", "set_cancelled_at"]),
    );
  });

  it("status final tidak punya jalan keluar", () => {
    expect(allowedTransitions("cancelled")).toHaveLength(0);
    expect(allowedTransitions("refunded")).toHaveLength(0);
    expect(() =>
      assertTransitionAllowed(makeOrder({ status: "cancelled" }), "paid", {}),
    ).toThrowError(/INVALID_STATE_TRANSITION|tidak dapat diubah/);
  });

  it("delivered -> completed menutup jendela retur; return_requested masih terbuka sebelum itu", () => {
    expect(findTransition("delivered", "completed")?.effects).toContain("prevent_new_returns");
    expect(findTransition("delivered", "return_requested")).not.toBeNull();
    expect(labelStatus("pending_payment")).toBe(ORDER_STATUS_LABELS.pending_payment);
  });

  it("pembatalan otomatis hanya sebelum penyerahan kurir", () => {
    expect(() =>
      assertCanCancelAutomatically(makeOrder({ status: "pending_payment" })),
    ).not.toThrow();
    expect(() =>
      assertCanCancelAutomatically(
        makeOrder({ status: "shipped", fulfillmentStatus: "shipped", shippedAt: new Date() }),
      ),
    ).toThrowError();
  });

  it("nilai refundable mengikuti alokasi diskon per baris", () => {
    const order = makeOrder({
      lines: [
        makeLine({
          unitPriceAmount: 1_000_000,
          quantity: 2,
          discountAllocatedAmount: 150_000,
          lineTotalAmount: 2_000_000,
        }),
      ],
      totalAmount: 1_872_000,
    });
    expect(lineRefundable(order.lines[0]!)).toBe(1_850_000);
    expect(refundableAmount(order)).toBe(1_872_000);
    expect(refundableAmount({ ...order, refundedAmount: 500_000 })).toBe(1_372_000);
  });
});

describe("retur & refund (Blueprint §7.3, §9.1)", () => {
  const deliveredAt = new Date("2026-09-20T04:00:00.000Z");
  const order = makeOrder({
    status: "delivered",
    deliveredAt,
    lines: [
      makeLine({
        orderItemId: "i1",
        unitPriceAmount: 1_000_000,
        quantity: 2,
        discountAllocatedAmount: 100_000,
        lineTotalAmount: 2_000_000,
      }),
      makeLine({
        orderItemId: "i2",
        unitPriceAmount: 300_000,
        quantity: 1,
        discountAllocatedAmount: 50_000,
        lineTotalAmount: 300_000,
        isReturnable: false,
        nameSnapshot: "Kopi (tidak dapat diretur)",
      }),
    ],
    shippingAmount: 22_000,
  });

  function eligibility(
    daysAfter: number,
    quantities: Record<string, number>,
    extra: Record<string, number> = {},
  ) {
    return evaluateReturnEligibility({
      order,
      orderItemIds: Object.keys(quantities),
      quantities,
      alreadyReturnedQuantities: extra,
      deliveredAt,
      returnWindowDays: 14,
      at: new Date(deliveredAt.getTime() + daysAfter * 86_400_000),
    });
  }

  it("dalam jendela 14 hari dan qty cukup -> layak", () => {
    const result = eligibility(3, { i1: 1 });
    expect(result.eligible).toBe(true);
    expect(result.windowEndsAt?.toISOString()).toBe(
      new Date(deliveredAt.getTime() + 14 * 86_400_000).toISOString(),
    );
  });

  it("setelah 14 hari ditolak", () => {
    const result = eligibility(15, { i1: 1 });
    expect(result.eligible).toBe(false);
    expect(result.lines[0]?.reasonCode).toBe("WINDOW_CLOSED");
  });

  it("jumlah yang sudah diretur sebelumnya dikurangi", () => {
    const result = eligibility(2, { i1: 2 }, { i1: 1 });
    expect(result.lines[0]?.reasonCode).toBe("QUANTITY");
    expect(result.lines[0]?.returnableQuantity).toBe(1);
    expect(remainingReturnableQuantity(2, 1)).toBe(1);
  });

  it("baris yang tidak returnable dan item di luar order ditolak", () => {
    expect(eligibility(1, { i2: 1 }).lines[0]?.reasonCode).toBe("NOT_RETURNABLE");
    expect(eligibility(1, { nope: 1 }).lines[0]?.reasonCode).toBe("NOT_IN_ORDER");
  });

  it("belum dikirim -> belum bisa diretur", () => {
    const result = evaluateReturnEligibility({
      order: { ...order, status: "shipped", deliveredAt: null },
      orderItemIds: ["i1"],
      quantities: { i1: 1 },
      deliveredAt: null,
      returnWindowDays: 14,
      at: new Date(),
    });
    expect(result.lines[0]?.reasonCode).toBe("NOT_DELIVERED");
    expect(returnWindowEndsAt(null, 14)).toBeNull();
  });

  it("AT-08: refund parsial memakai diskon yang dialokasikan, dibulatkan, dan di-cap", () => {
    const one = computeReturnRefund({
      order,
      lines: [{ orderItemId: "i1", returnQuantity: 1 }],
      includeShipping: false,
    });
    expect(one.amount).toBe(950_000); // (2.000.000 - 100.000) / 2
    expect(one.capped).toBe(false);
    const both = computeReturnRefund({
      order,
      lines: [{ orderItemId: "i1", returnQuantity: 2 }],
      includeShipping: true,
    });
    expect(both.amount).toBe(1_900_000 + 22_000);
    const almostRefunded: OrderSnapshot = { ...order, refundedAmount: order.totalAmount - 100_000 };
    const capped = computeReturnRefund({
      order: almostRefunded,
      lines: [{ orderItemId: "i1", returnQuantity: 2 }],
      includeShipping: true,
    });
    expect(capped.capped).toBe(true);
    expect(capped.amount).toBe(100_000);
    expect(capped.refundable).toBe(100_000);
  });

  it("ongkir hanya dikembalikan untuk kesalahan penjual; foto wajib untuk barang rusak", () => {
    expect(shouldRefundShipping("damaged_on_arrival")).toBe(true);
    expect(shouldRefundShipping("changed_mind")).toBe(false);
    expect(reasonRequiresPhoto("damaged_on_arrival")).toBe(true);
    expect(RETURN_REASONS.some((r) => r.code === "size_unfit")).toBe(true);
  });

  it("restok hanya bila pemeriksaan lolos dan barang tidak rusak", () => {
    expect(shouldRestockOnResolution("refund", true, false)).toBe(true);
    expect(shouldRestockOnResolution("refund", false, false)).toBe(false);
    expect(shouldRestockOnResolution("refund", true, true)).toBe(false);
  });

  it("status retur mengikuti mesin status dan tidak bisa melompat", () => {
    expect(() => assertReturnTransition("requested", "item_received")).toThrowError();
    expect(() => assertReturnTransition("requested", "approved")).not.toThrow();
  });

  it("nominal refund dibatasi nilai refundable order", () => {
    expect(() => assertWithinRefundable(1_200_000, 1_000_000)).toThrowError(/melebihi/);
    expect(() => assertWithinRefundable(0, 1_000_000)).toThrowError();
    expect(() => assertWithinRefundable(1_000_000, 1_000_000)).not.toThrow();
    expect(refundableAmountOfOrder(2_000_000, 500_000)).toBe(1_500_000);
    expect(refundableAmountOfOrder(2_000_000, 2_500_000)).toBe(0);
  });

  it("maker-checker: di atas ambang wajib disetujui aktor lain (belum ada penyetuju = perlu approval)", () => {
    expect(requiresApproval(400_000, 500_000, "user-1", null)).toBe(false); // di bawah ambang -> auto
    expect(requiresApproval(600_000, 500_000, "user-1", null)).toBe(true); // di atas ambang -> butuh penyetuju
    expect(requiresApproval(600_000, 500_000, "user-1", "user-2")).toBe(false); // sudah ada penyetuju berbeda
    expect(requiresApproval(100, 500_000, "user-1", "user-1")).toBe(false); // di bawah ambang: auto
    expect(requiresApproval(600_000, 500_000, "user-1", "user-1")).toBe(true); // penyetuju tidak boleh orang yang sama
  });
});

describe("pembayaran (Blueprint §6.2, AT-04/AT-05)", () => {
  it("status terminal tidak dapat berubah lagi", () => {
    expect(isTerminal("succeeded")).toBe(true);
    expect(isTerminal("pending")).toBe(false);
    expect(() => assertAttemptTransition("succeeded", "failed")).toThrowError();
    expect(() => assertAttemptTransition("created", "pending")).not.toThrow();
  });

  it("kunci dedup webhook kombinasi provider + event id", () => {
    expect(webhookDedupeKey("mock", "evt-1")).toContain("mock");
    expect(webhookDedupeKey("mock", "evt-1")).toBe(webhookDedupeKey("mock", "evt-1"));
    expect(webhookDedupeKey("mock", "evt-1")).not.toBe(webhookDedupeKey("mock", "evt-2"));
  });

  it("event dengan nominal atau mata uang berbeda ditolak sebelum status berubah", () => {
    const attempt: PaymentAttempt = {
      id: "a1",
      orderId: "o1",
      orderNumber: "NS-20261010-ABC123",
      providerCode: "mock",
      providerRef: "ref-1",
      methodCode: "qris",
      methodName: "QRIS (Simulasi)",
      amount: 1_000_000,
      currency: "IDR",
      status: "pending",
      idempotencyKey: "key-1",
      createdAt: new Date(),
      updatedAt: new Date(),
      succeededAt: null,
      instructions: null,
      redirectUrl: null,
      isSimulated: true,
      failureReason: null,
    };
    const event: NormalizedPaymentEvent = {
      provider: "mock",
      eventId: "e1",
      kind: "payment.success",
      attemptRef: "ref-1",
      amount: 999,
      currency: "IDR",
      occurredAt: new Date(),
      rawSummary: {},
    };
    expect(() => assertEventMatchesAttempt(event, attempt)).toThrowError(/tidak cocok/);
    expect(() => assertEventMatchesAttempt({ ...event, amount: 1_000_000 }, attempt)).not.toThrow();
  });
});

describe("stok (Blueprint §9.2, AT-02)", () => {
  const balance = { onHand: 10, reserved: 3, damaged: 2, safetyStock: 1 };

  it("availableToSell mengecualikan reservasi dan safety stock, tidak termasuk rusak", () => {
    expect(availableToSell(balance)).toBe(6);
    expect(isSellable(balance, 6)).toBe(true);
    expect(isSellable(balance, 7)).toBe(false);
  });

  it("penyesuaian divalidasi: bulat, bukan nol, alasan dikenal, tidak melebihi tersedia", () => {
    expect(
      validateAdjustment(
        { sku: "A", locationCode: "MAIN", delta: 0, reason: "cycle_count_variance" },
        balance,
      ).ok,
    ).toBe(false);
    expect(
      validateAdjustment(
        { sku: "A", locationCode: "MAIN", delta: 1.5, reason: "cycle_count_variance" },
        balance,
      ).ok,
    ).toBe(false);
    expect(
      validateAdjustment(
        { sku: "A", locationCode: "MAIN", delta: -6, reason: "cycle_count_variance" },
        balance,
      ).ok,
    ).toBe(true);
    expect(
      validateAdjustment(
        { sku: "A", locationCode: "MAIN", delta: -7, reason: "cycle_count_variance" },
        balance,
      ).ok,
    ).toBe(false);
  });

  it("ambang approval dihitung dari unit yang terdampak", () => {
    expect(requiresStockApproval(50_000, 100_000)).toBe(false);
    expect(requiresStockApproval(150_000, 100_000)).toBe(true);
    expect(requiresStockApproval(-150_000, 100_000)).toBe(true);
  });

  it("reservasi kedaluwarsa dan TTL memiliki batas bawah yang aman", () => {
    const now = new Date("2026-10-10T04:00:00.000Z");
    expect(isReservationExpired(new Date(now.getTime() - 1000), now)).toBe(true);
    expect(isReservationExpired(new Date(now.getTime() + 60_000), now)).toBe(false);
    expect(reservationTtlMinutes(undefined)).toBeGreaterThan(0);
    expect(reservationTtlMinutes(0)).toBeGreaterThan(0);
  });
});

describe("RBAC default deny (Blueprint §3.1, §12.2)", () => {
  it("tanpa peran = tanpa permission", () => {
    expect(permissionsForRoles([]).size).toBe(0);
    expect(can(new Set(), "order.process")).toBe(false);
    expect(can([], "order.process")).toBe(false);
  });

  it("pemisahan tugas: CS tidak menyetujui refund, merchandiser tidak menyentuh keuangan", () => {
    const cs = new Set(permissionsForRole("customer_support"));
    expect(cs.has("return.manage")).toBe(true);
    expect(cs.has("refund.approve")).toBe(false);
    const merch = new Set(permissionsForRole("merchandiser"));
    expect(merch.has("promotion.manage")).toBe(true);
    expect(merch.has("order.refund")).toBe(false);
    const finance = new Set(permissionsForRole("finance"));
    expect(finance.has("refund.approve")).toBe(true);
    expect(finance.has("catalog.update")).toBe(false);
    expect(canAll(cs, ["order.view", "return.manage"])).toBe(true);
    expect(canAny(cs, ["refund.approve", "return.manage"])).toBe(true);
  });

  it("sistem_admin memegang semua permission, auditor hanya baca", () => {
    const admin = permissionsForRoles(["system_admin"]);
    expect(admin.has("settings.manage")).toBe(true);
    expect(admin.has("user.role.assign")).toBe(true);
    const auditor = new Set(permissionsForRole("auditor"));
    expect(auditor.has("audit.view")).toBe(true);
    expect(auditor.has("settings.manage")).toBe(false);
  });

  it("navigasi admin mengikuti permission, kepemilikan order diverifikasi di server", () => {
    const nav = adminNavForPermissions(new Set(["order.view", "return.manage"]));
    expect(nav).toContain("/admin/pesanan");
    expect(nav).not.toContain("/admin/pengaturan");
    expect(ownsOrder("u1", "u1")).toBe(true);
    expect(ownsOrder("u1", "u2")).toBe(false);
    expect(ownsOrder(null, "u1")).toBe(false);
  });

  it("masking PII untuk tampilan daftar", () => {
    expect(maskEmail("budi.santoso@example.co.id")).toMatch(/^b.*\*.*@/);
    expect(maskEmail("a@b.co")).toContain("*");
    expect(maskPhone("081234567890")).toMatch(/^\d{4}\*{4}\d{2}$/);
    expect(maskPhone("123")).toBe("***");
    expect(maskStreet("Jl. Raya Bogor Km 18 No. 27, RT 04/RW 02")).not.toContain("RT 04");
  });
});

describe("katalog & ketersediaan (AT-01)", () => {
  it("draft dan arsip tidak tampil publik; staf berwenang boleh pratinjau", () => {
    expect(isPubliclyVisible("published", { canPreview: false })).toBe(true);
    expect(isPubliclyVisible("draft", { canPreview: false })).toBe(false);
    expect(isPubliclyVisible("draft", { canPreview: true })).toBe(true);
    expect(isPubliclyVisible("archived", { canPreview: true })).toBe(true);
  });

  it("label stok faktual - tanpa urgensi palsu", () => {
    const variant: ProductVariant = {
      id: "v1",
      productId: "p1",
      sku: "NS-1",
      label: "Midnight",
      options: {},
      priceAmount: 1000,
      compareAtAmount: null,
      currency: "IDR" as const,
      onHand: 2,
      reserved: 0,
      safetyStock: 0,
      lowStockThreshold: 5,
      maxQuantityPerOrder: 10,
      minQuantityPerOrder: 1,
      isActive: true,
      mediaIds: [],
      isDeleted: false,
    };
    const view = computeStockView(variant, 2);
    expect(view.state).toBe("low_stock");
    expect(view.label).not.toMatch(/segera|hampir|buruan|countdown/i);
    expect(view.maxPurchaseQuantity).toBe(2);
    expect(computeStockView({ ...variant, onHand: 0 }, 0).state).toBe("out_of_stock");
    expect(computeStockView({ ...variant, onHand: null }, 0).state).toBe("not_tracked");
    expect(computeStockView(null, 0).quantity).toBeNull();
  });

  it("diskon persen untuk price block dan slug", () => {
    expect(discountPercentage(900_000, 1_200_000)).toBe(25);
    expect(discountPercentage(1_200_000, 900_000)).toBeNull();
    expect(discountPercentage(1000, null)).toBeNull();
    expect(deriveSlug("Headphone Nirkabel  Aureo H2!")).toBe("headphone-nirkabel-aureo-h2");
    expect(primaryMedia([])).toBeNull();
  });
});

describe("pengiriman & tracking (Blueprint §7.2)", () => {
  it("provinsi dipetakan ke zona; tarif simulasi diberi label dan kedaluwarsa", () => {
    expect(zoneForProvince("DKI Jakarta")).toBe("JAWA");
    expect(zoneForProvince("Papua")).toBe("PAPUA");
    const at = new Date("2026-10-10T04:00:00.000Z");
    const quotes = quoteSimulatedServices(
      { province: "DKI Jakarta", weightGrams: 2500, itemCount: 2 },
      at,
    );
    expect(quotes.length).toBeGreaterThan(1);
    for (const quote of quotes) {
      expect(quote.serviceName).toContain("Simulasi");
      expect(quote.isSimulated).toBe(true);
      expect(quote.estimateLabel).toMatch(/Estimasi .* hari kerja/);
      expect(quote.expiresAt.getTime()).toBeGreaterThan(at.getTime());
      expect(Number.isInteger(quote.costAmount)).toBe(true);
    }
    const heavier = quoteSimulatedServices(
      { province: "DKI Jakarta", weightGrams: 8000, itemCount: 2 },
      at,
    );
    const reg = (list: typeof quotes) => list.find((q) => q.serviceCode === "reg")!;
    expect(reg(heavier).costAmount).toBeGreaterThan(reg(quotes).costAmount);
    const distant = quoteSimulatedServices(
      { province: "Papua", weightGrams: 2500, itemCount: 2 },
      at,
    );
    expect(reg(distant).costAmount).toBeGreaterThan(reg(quotes).costAmount);
    expect(reg(distant).estimateLabel).toMatch(/hari kerja/);
    expect(isQuoteExpired(new Date(at.getTime() - 1000), at)).toBe(true);
    expect(isQuoteExpired(null, at)).toBe(false);
  });

  it("event tracking tidak menurunkan status yang lebih maju", () => {
    expect(shouldApplyTrackingEvent("in_transit", "out_for_delivery")).toBe(true);
    expect(shouldApplyTrackingEvent("delivered", "in_transit")).toBe(false);
    expect(shouldApplyTrackingEvent("delivered", "delivered")).toBe(false);
    expect(mapProviderTrackingState("IN_TRANSIT")).toBe("in_transit");
    expect(mapProviderTrackingState("sesuatu yang asing")).toBeNull();
    expect(SHIPMENT_STATUS_LABELS.delivered).toBeTruthy();
  });
});

describe("validasi lokal & ID (Blueprint §13.2, §14)", () => {
  it("nomor ponsel Indonesia dinormalisasi dan divalidasi", () => {
    expect(isValidIdPhone("081234567890")).toBe(true);
    expect(isValidIdPhone("+62 812-3456-7890")).toBe(true); // spasi/strip dinormalisasi
    expect(isValidIdPhone(normalizePhone("+6281234567890"))).toBe(true);
    expect(normalizePhone("0812-3456-7890")).toBe("081234567890");
    expect(isValidIdPhone("6281234567890")).toBe(true); // prefik 62 diterima dan dinormalisasi
    expect(isValidIdPhone("0215551234")).toBe(false); // nomor telepon rumah
    expect(isValidIdPhone("0812")).toBe(false);
    expect(ID_PHONE_RE.test("08123456789012345")).toBe(false);
  });

  it("kode pos 5 digit", () => {
    expect(isValidPostalCode("13840")).toBe(true);
    expect(isValidPostalCode("1384")).toBe(false);
  });

  it("nomor referensi dan token acak", () => {
    expect(generateOrderNumber(new Date("2026-10-10T00:00:00Z"))).toMatch(
      /^NS-20261010-[A-Z0-9]{6}$/,
    );
    expect(generateReference("RET", new Date("2026-10-10T00:00:00Z"))).toMatch(
      /^RET-20261010-[A-Z0-9]{6}$/,
    );
    const tokens = new Set([
      generateTrackingToken(),
      generateTrackingToken(),
      generateTrackingToken(),
    ]);
    expect(tokens.size).toBe(3);
    expect(generateTrackingToken().length).toBeGreaterThanOrEqual(20);
    expect(generateSimulatedVaNumber("seed-1")).toMatch(/^SIMULASI-9\d{15}0$/);
    expect(generateSimulatedVaNumber("seed-1")).toBe(generateSimulatedVaNumber("seed-1"));
  });

  it("TOTP cocok dengan vektor RFC 6238 dan punya jendela toleransi", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890", "ascii"));
    expect(secret).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(totpCode(secret, new Date(59_000))).toBe("287082");
    expect(totpCode(secret, new Date(1_111_111_109_000), 30, 8)).toBe("07081804");
    expect(totpCode(secret, new Date(1_111_111_109_000))).toBe("081804");
    expect(verifyTotp(secret, "287082", { at: new Date(59_000) })).toBe(true);
    expect(verifyTotp(secret, "287082", { at: new Date(59_000 + 29_000), window: 1 })).toBe(true);
    expect(verifyTotp(secret, "287082", { at: new Date(59_000 + 5 * 30_000), window: 1 })).toBe(
      false,
    );
    expect(verifyTotp(secret, "abc123")).toBe(false);
    expect(base32Decode(base32Encode(randomBytes(20))).length).toBe(20);
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{26,}$/);
  });
});
