import { AsaasPaymentService } from "./asaasPaymentService";
import { StripePaymentService } from "./stripePaymentService";
import { PAYMENT_METHODS, type GatewayPaymentResult, type PaymentGatewayService, type PaymentMethod, type PaymentOrderInput } from "./types";

export class PaymentService {
  constructor(
    private readonly stripePaymentService: PaymentGatewayService = new StripePaymentService(),
    private readonly asaasPaymentService: PaymentGatewayService = new AsaasPaymentService()
  ) {}

  createPayment(order: PaymentOrderInput): Promise<GatewayPaymentResult> {
    return this.gatewayFor(order.method).createPayment(order);
  }

  private gatewayFor(method: PaymentMethod) {
    switch (method) {
      case PAYMENT_METHODS.PIX:
        return this.asaasPaymentService;
      case PAYMENT_METHODS.CREDIT_CARD:
      case PAYMENT_METHODS.DEBIT_CARD:
        return this.stripePaymentService;
      default:
        throw Object.assign(new Error("Método de pagamento não suportado."), { statusCode: 400 });
    }
  }
}

export function checkoutMethodToPaymentMethod(method: "checkout" | "pix" | "card" | "credit_card" | "debit_card"): PaymentMethod {
  if (method === "pix") return PAYMENT_METHODS.PIX;
  if (method === "debit_card") return PAYMENT_METHODS.DEBIT_CARD;
  return PAYMENT_METHODS.CREDIT_CARD;
}
