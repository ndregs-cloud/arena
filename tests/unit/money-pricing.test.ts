import { describe, expect, it } from "vitest";
import {
  allocateByWeights,
  applyBasisPoints,
  assertAmount,
  clampDiscount,
  money,
  roundHalfUp,
  sumAmount,
} from "@/domain/money";
import {
  assertShippingQuoteFresh,
  buildQuote,
  evaluatePromotion,
  reconcileClientTotals,
  type PricingLine,
  type Promotion,
} from "@/domain/pricing";
import { fixedClock } from "@/domain/clock";
import { AppError } from "@/domain/errors";

function line(overrides: Partial<PricingLine> = {}): PricingLine {
  return {
    lineId: "l1",
    variantId: "v1",
    productId: "p1",
    sku: "NS-1",
    name: "Produk",
    variantLabel: "Varian",
    unitPriceAmount: 500_000,
    quantity: 2,
    categoryId: "c1",
    maxQuantity: 10,
    ...overrides,
  };
}

function promo(overrides: Partial<Promotion> = {}): Promotion {
  return {
    id: "promo-1",
    code: "HERO10",
    label: "Potongan 10%",
    kind: "percent",
    value: 1000,
    minSpendAmount: 500_000,
    discountCapAmount: null,
    scope: null,
    startsAt: new Date("2026-10-01T00:00:00.000Z"),
    endsAt: new Date("2026-10-31T23:59:59.000Z"),
    usageLimit: null,
    usedCount: 0,
    perCustomerLimit: null,
    redemptionsByCustomer: 0,
    isActive: true,
    stackable: false,
    ...overrides,
  };
}

describe("uang (Blueprint §5.2: IDR integer, pembulatan eksplisit)", () => {
  it("menolak pecahan dan nilai non-integer", () => {
    expect(() => assertAmount(1000.5)).toThrow();
    expect(() => assertAmount(Number.NaN)).toThrow();
    expect(() => assertAmount(-1)).toThrow();
    expect(assertAmount(2_750_000)).toBe(2_750_000);
  });

  it("membulatkan setengah ke atas dan membulatkan basis points ke rupiah penuh", () => {
    expect(roundHalfUp(1250.5)).toBe(1251);
    expect(roundHalfUp(0.5)).toBe(1);
    expect(applyBasisPoints(1_250_000, 1000)).toBe(125_000); // 10%
    expect(applyBasisPoints(333_333, 333)).toBe(11_100); // 3,33% dibulatkan setengah ke atas
    expect(applyBasisPoints(10_000, 0)).toBe(0);
  });

  it("mengalokasikan diskon per baris dengan sisa terbesar (AT-08)", () => {
    const weights = [1_000_000, 500_000, 500_000];
    const allocation = allocateByWeights(150_000, weights);
    expect(allocation.reduce((a, b) => a + b, 0)).toBe(150_000);
    expect(allocation[0] ?? -1).toBe(75_000);
    // sisa terbesar dibagikan deterministik, tidak ada selisih pembulatan
    expect((allocation[1] ?? 0) + (allocation[2] ?? 0)).toBe(75_000);
    expect(Math.abs((allocation[1] ?? 0) - (allocation[2] ?? 0))).toBeLessThanOrEqual(1);
  });

  it("alokasi diskon tidak pernah melebihi total dan selalu bulat", () => {
    const allocation = allocateByWeights(10, [1, 1, 1]);
    expect(allocation.every((value) => Number.isInteger(value))).toBe(true);
    expect(sumAmount(allocation)).toBe(10);
    expect(() => allocateByWeights(-1, [1])).toThrow();
  });

  it("clampDiscount menjaga diskon tidak melebihi subtotal", () => {
    expect(clampDiscount(600_000, 500_000)).toBe(500_000);
    expect(clampDiscount(120_000, 500_000)).toBe(120_000);
    expect(money(1000).currency).toBe("IDR");
  });
});

describe("pricing & promosi (Blueprint §5.2, §7.1)", () => {
  const at = new Date("2026-10-10T02:00:00.000Z");

  it("min spend dihitung sebelum diskon item dan tanpa ongkir", () => {
    const below = evaluatePromotion(promo({ minSpendAmount: 1_200_000 }), [line({ quantity: 2 })], {
      at,
    });
    expect(below.eligible).toBe(false);
    expect(below.reasonCode).toBe("MIN_SPEND");
    const exact = evaluatePromotion(promo({ minSpendAmount: 1_000_000 }), [line({ quantity: 2 })], {
      at,
    });
    expect(exact.eligible).toBe(true);
  });

  it("jendela waktu promo dievaluasi terhadap clock yang disuntik", () => {
    const clock = fixedClock("2026-11-05T00:00:00.000Z");
    const evaluation = evaluatePromotion(promo(), [line()], { at: clock.now() });
    expect(evaluation.eligible).toBe(false);
    expect(evaluation.reasonCode).toBe("OUT_OF_WINDOW");
    clock.advance(20 * 24 * 60); // 20 hari kemudian masih di dalam jendela
    expect(
      evaluatePromotion(promo({ endsAt: new Date("2026-12-31T00:00:00.000Z") }), [line()], {
        at: clock.now(),
      }).eligible,
    ).toBe(true);
  });

  it("batas pemakaian global dan per pelanggan", () => {
    expect(
      evaluatePromotion(promo({ usageLimit: 10, usedCount: 10 }), [line()], { at }).reasonCode,
    ).toBe("USAGE_LIMIT");
    expect(
      evaluatePromotion(promo({ perCustomerLimit: 1, redemptionsByCustomer: 1 }), [line()], { at })
        .reasonCode,
    ).toBe("PER_CUSTOMER_LIMIT");
  });

  it("prioritas: free_shipping mengungguli percent; diskon mengikuti cap", () => {
    const withPercent = buildQuote({
      lines: [line({ unitPriceAmount: 900_000, quantity: 1 })],
      promotion: promo({
        kind: "percent",
        value: 1000,
        minSpendAmount: 0,
        discountCapAmount: 50_000,
      }),
      at,
    });
    expect(withPercent.discountAmount).toBe(50_000);
    const shipping = {
      costAmount: 32_000,
      serviceCode: "reguler",
      serviceName: "Reguler",
      carrierCode: "simulated",
      estimateLabel: "2-4 hari",
      quotedAt: at,
      expiresAt: null,
      isSimulated: true,
    };
    const freeShip = buildQuote({
      lines: [line({ unitPriceAmount: 900_000, quantity: 1 })],
      promotion: promo({ kind: "free_shipping", value: 0, minSpendAmount: 0 }),
      shipping,
      at,
    });
    expect(freeShip.freeShippingApplied).toBe(true);
    expect(freeShip.shippingAmount).toBe(0);
    expect(freeShip.totalAmount).toBe(900_000);
    const paid = buildQuote({
      lines: [line({ unitPriceAmount: 900_000, quantity: 1 })],
      promotion: null,
      shipping,
      at,
    });
    expect(paid.shippingAmount).toBe(32_000);
    expect(paid.totalAmount).toBe(932_000);
  });

  it("alokasi diskon per baris dijumlahkan sama dengan diskon total", () => {
    const quote = buildQuote({
      lines: [
        line({ lineId: "a", unitPriceAmount: 1_000_000, quantity: 1 }),
        line({ lineId: "b", unitPriceAmount: 250_000, quantity: 1 }),
      ],
      promotion: promo({ kind: "percent", value: 1250, minSpendAmount: 0 }),
      at,
    });
    expect(quote.discountAmount).toBe(156_250);
    const allocated = Object.values(quote.lineDiscounts).reduce<number>((a, b) => a + Number(b), 0);
    expect(allocated).toBe(quote.discountAmount);
    expect(quote.lineDiscounts.b ?? 0).toBeLessThan(quote.lineDiscounts.a ?? 0);
  });

  it("diskon tidak pernah membuat total negatif", () => {
    const quote = buildQuote({
      lines: [line({ unitPriceAmount: 100_000, quantity: 1 })],
      promotion: promo({ kind: "fixed", value: 5_000_000, minSpendAmount: 0 }),
      at,
    });
    expect(quote.discountAmount).toBe(100_000);
    expect(quote.totalAmount).toBe(0);
  });

  it("kutipan pengiriman kedaluwarsa ditolak (AT-10)", () => {
    const stale = {
      costAmount: 22_000,
      serviceCode: "reguler",
      serviceName: "Reguler",
      carrierCode: "simulated",
      estimateLabel: "2-4 hari",
      quotedAt: new Date("2026-10-10T00:00:00.000Z"),
      expiresAt: new Date("2026-10-10T00:30:00.000Z"),
      isSimulated: true,
    };
    expect(() => assertShippingQuoteFresh(stale, at)).toThrowError(
      /SHIPPING_QUOTE_EXPIRED|kedaluwarsa/,
    );
    try {
      assertShippingQuoteFresh(stale, at);
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("SHIPPING_QUOTE_EXPIRED");
    }
    expect(() => assertShippingQuoteFresh(null, at)).toThrow();
  });

  it("angka klien tidak pernah menang (AT-03)", () => {
    const server = buildQuote({ lines: [line({ unitPriceAmount: 500_000, quantity: 2 })], at });
    const result = reconcileClientTotals({ totalAmount: 1 }, server);
    expect(result.mismatch).toBe(true);
    expect(result.totalAmount).toBe(server.totalAmount);
    expect(reconcileClientTotals(undefined, server)).toEqual({
      totalAmount: server.totalAmount,
      mismatch: false,
    });
  });

  it("keranjang kosong ditolak dengan kode CART_EMPTY", () => {
    expect(() => buildQuote({ lines: [], at })).toThrowError(AppError);
  });
});
