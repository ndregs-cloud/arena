import type { AddressSnapshot, OrderLineSnapshot, OrderSnapshot } from "@/domain/orders";

export const ADDRESS: AddressSnapshot = {
  fullName: "Budi Santoso",
  phone: "081234567890",
  province: "DKI Jakarta",
  city: "Jakarta Timur",
  district: "Cipayung",
  postalCode: "13840",
  street: "Jl. Raya Bogor Km 18 No. 27",
  landmark: null,
  zoneCode: "JAWA",
};

export function makeLine(overrides: Partial<OrderLineSnapshot> = {}): OrderLineSnapshot {
  const unitPriceAmount = overrides.unitPriceAmount ?? 1_250_000;
  const quantity = overrides.quantity ?? 1;
  const discountAllocatedAmount = overrides.discountAllocatedAmount ?? 0;
  return {
    orderItemId: "item-1",
    productId: "product-1",
    variantId: "variant-1",
    sku: "NS-HP-001-01",
    nameSnapshot: "Headphone Nirkabel Aureo H2",
    variantLabelSnapshot: "Midnight / Standar",
    unitPriceAmount,
    quantity,
    discountAllocatedAmount,
    lineTotalAmount: unitPriceAmount * quantity,
    imageUrl: "/img/products/headphone-nirkabel-aureo-h2-1.svg",
    isReturnable: true,
    ...overrides,
  };
}

export function makeOrder(overrides: Partial<OrderSnapshot> = {}): OrderSnapshot {
  const lines = overrides.lines ?? [makeLine()];
  const subtotalAmount =
    overrides.subtotalAmount ??
    lines.reduce((acc, line) => acc + line.unitPriceAmount * line.quantity, 0);
  const discountAmount =
    overrides.discountAmount ?? lines.reduce((acc, line) => acc + line.discountAllocatedAmount, 0);
  const shippingAmount = overrides.shippingAmount ?? 22_000;
  return {
    id: "order-1",
    orderNumber: "NS-20261010-ABC123",
    trackingToken: "tok-00000000000000000000ab",
    customerId: "customer-1",
    email: "budi@example.test",
    phone: "081234567890",
    status: "paid",
    paymentStatus: "succeeded",
    fulfillmentStatus: "unfulfilled",
    currency: "IDR",
    subtotalAmount,
    discountAmount,
    shippingAmount,
    feeAmount: 0,
    totalAmount: subtotalAmount - discountAmount + shippingAmount,
    refundedAmount: 0,
    promotionId: null,
    shippingAddress: ADDRESS,
    shippingSelection: {
      carrierCode: "simulated",
      serviceCode: "reguler",
      serviceName: "Reguler (Simulasi)",
      estimateLabel: "Estimasi 2-4 hari kerja",
    },
    lines,
    policyVersion: "syarat-v1",
    marketingConsent: false,
    campaignSource: null,
    createdAt: new Date("2026-10-08T02:00:00.000Z"),
    updatedAt: new Date("2026-10-08T02:00:00.000Z"),
    paidAt: new Date("2026-10-08T02:05:00.000Z"),
    shippedAt: null,
    deliveredAt: null,
    cancelledAt: null,
    cancelReason: null,
    internalNoteCount: 0,
    customerNote: null,
    ...overrides,
  };
}
