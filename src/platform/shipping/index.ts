import "server-only";
import { HttpShippingProviderStub, MockShippingProvider } from "./mock-provider";
import type { ShippingProviderAdapter } from "./provider";

let cached: ShippingProviderAdapter | null = null;

/** Default = simulasi. Provider nyata dipakai hanya bila kredensial + kontrak tersedia. */
export function shippingProvider(): ShippingProviderAdapter {
  if (cached) return cached;
  const code = (process.env.SHIPPING_PROVIDER ?? "mock").trim();
  if (code === "biteship") {
    const stub = new HttpShippingProviderStub(
      "biteship",
      "BiteSpeed/BiteShip aggregator",
      process.env.BITESHIP_API_KEY,
      process.env.BITESHIP_BASE_URL,
    );
    cached = stub.unavailableReason() ? new MockShippingProvider() : stub;
  } else {
    cached = new MockShippingProvider();
  }
  return cached;
}

export type { ShippingProviderAdapter };
