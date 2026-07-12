import { createHash } from "node:crypto";
import { MercadoPagoConfig, Order, Payment, Preference } from "mercadopago";

type CachedMercadoPagoClient = {
  config: MercadoPagoConfig;
  order: Order;
  payment: Payment;
  preference: Preference;
};

const clients = new Map<string, CachedMercadoPagoClient>();

export function getMercadoPagoSdkClient(accessToken: string) {
  const key = createHash("sha256").update(accessToken).digest("hex");
  const cached = clients.get(key);

  if (cached) {
    return cached;
  }

  const config = new MercadoPagoConfig({
    accessToken,
    options: {
      timeout: 10_000
    }
  });
  const next = {
    config,
    order: new Order(config),
    payment: new Payment(config),
    preference: new Preference(config)
  };

  clients.set(key, next);
  return next;
}
