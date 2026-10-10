import "server-only";
import { resolvePaymentProvider } from "./http-provider-template";
import type { PaymentProviderAdapter } from "./provider";

let cached: PaymentProviderAdapter | null = null;

export function paymentProvider(): PaymentProviderAdapter {
  if (!cached) cached = resolvePaymentProvider();
  return cached;
}

export type { PaymentProviderAdapter };
export { ProviderNotConfiguredError } from "./provider";
