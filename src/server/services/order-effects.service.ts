import "server-only";

/**
 * Efek samping transisi order yang dibutuhkan lintas service (payment <-> order).
 * Dibuat modul terpisah untuk menghindari import melingkar, tetap internal domain.
 */
export {
  consumeReservationsForOrder,
  releaseReservationsForOrder,
} from "@/server/services/payment.service";
export { releasePromotion as releasePromotionForOrder } from "@/server/services/promotion.service";
export { loadOrderSnapshot, mapOrderSnapshot } from "@/server/services/checkout.service";
