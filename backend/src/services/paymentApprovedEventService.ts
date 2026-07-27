import { devBotRealtimeRoom, emitRealtime, emitRealtimeToRoom } from "../realtime/events";

export type PaymentApprovedEvent = {
  approvedAt: string;
  botId: string | null;
  buyerId: string;
  buyerName: string | null;
  currency: "BRL" | "USD" | "EUR";
  gateway: string | null;
  guildId: string;
  moduleId: string;
  paymentId: string;
  paymentMethod: string | null;
  productId: string | null;
  productName: string;
  productPlanType: string | null;
  productPrice: number;
};

export const PAYMENT_APPROVED_EVENT = "payment:approved";

export function emitPaymentApprovedEvent(input: PaymentApprovedEvent) {
  const payload: PaymentApprovedEvent = {
    ...input,
    buyerName: input.buyerName?.trim() || null,
    gateway: input.gateway?.trim() || null,
    paymentMethod: input.paymentMethod?.trim() || null,
    productId: input.productId?.trim() || null,
    productName: input.productName.trim().slice(0, 120) || "Produto",
    productPlanType: input.productPlanType?.trim() || null
  };

  emitRealtime(PAYMENT_APPROVED_EVENT, payload);
  if (payload.botId) {
    emitRealtimeToRoom(devBotRealtimeRoom(payload.botId), PAYMENT_APPROVED_EVENT, payload);
  }
}
