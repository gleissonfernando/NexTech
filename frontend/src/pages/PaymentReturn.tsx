import { useEffect, useState } from "react";
import { AlertCircle, ArrowRight, CheckCircle2, Clock3, CreditCard, Home, Loader2, ShieldCheck } from "lucide-react";
import { getCustomerPaymentOrder } from "../lib/api";
import type { PaymentOrder } from "../types";

type PaymentReturnStatus = "success" | "pending" | "failure";

type PaymentReturnPageProps = {
  status: PaymentReturnStatus;
};

const statusConfig: Record<PaymentReturnStatus, {
  accent: string;
  icon: typeof CheckCircle2;
  label: string;
  message: string;
  title: string;
}> = {
  failure: {
    accent: "text-red-300",
    icon: AlertCircle,
    label: "Pagamento nao concluido",
    message: "A compra nao foi aprovada. Voce pode tentar novamente pelo painel de planos.",
    title: "Nao conseguimos confirmar sua compra"
  },
  pending: {
    accent: "text-amber-300",
    icon: Clock3,
    label: "Pagamento em analise",
    message: "Recebemos o retorno do Mercado Pago e a confirmacao pode levar alguns minutos.",
    title: "Seu pagamento esta pendente"
  },
  success: {
    accent: "text-emerald-300",
    icon: CheckCircle2,
    label: "Pagamento confirmado",
    message: "O pedido interno foi confirmado pelo backend. Se a ativacao ainda nao aparecer, atualize o painel em alguns instantes.",
    title: "Pagamento aprovado"
  }
};

export function PaymentReturnPage({ status }: PaymentReturnPageProps) {
  const params = new URLSearchParams(window.location.search);
  const paymentId = params.get("payment_id") || params.get("collection_id");
  const paymentStatus = params.get("status") || params.get("collection_status");
  const orderReference = params.get("external_reference");
  const preferenceId = params.get("preference_id");
  const [order, setOrder] = useState<PaymentOrder | null>(null);
  const [loadingOrder, setLoadingOrder] = useState(Boolean(orderReference));
  const [orderError, setOrderError] = useState<string | null>(null);
  const verifiedStatus = order ? statusFromOrder(order.status, status) : status;
  const config = statusConfig[verifiedStatus];
  const Icon = config.icon;

  useEffect(() => {
    if (!orderReference) return;
    let cancelled = false;
    setLoadingOrder(true);
    getCustomerPaymentOrder(orderReference)
      .then((result) => {
        if (!cancelled) setOrder(result.order);
      })
      .catch(() => {
        if (!cancelled) setOrderError("Nao foi possivel consultar o pedido interno agora.");
      })
      .finally(() => {
        if (!cancelled) setLoadingOrder(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderReference]);

  return (
    <main className="min-h-screen bg-[#070707] px-4 py-8 text-white sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-4xl flex-col justify-center">
        <a className="mb-8 inline-flex w-fit items-center gap-2 text-sm font-semibold text-[#FFEA70] transition hover:text-[#FFD500]" href="/">
          <Home className="h-4 w-4" />
          Nex Tech
        </a>

        <section className="rounded-lg border border-[#FFD500]/20 bg-[#111113]/95 p-6 shadow-[0_18px_70px_rgba(0,0,0,0.36)] sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-[#FFD500]/25 bg-[#FFD500]/10">
              <Icon className={`h-7 w-7 ${config.accent}`} />
            </div>
            <div className="min-w-0 flex-1">
              <span className={`text-sm font-bold uppercase tracking-wide ${config.accent}`}>{config.label}</span>
              <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">{config.title}</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">{config.message}</p>
            </div>
          </div>

          <div className="mt-7 grid gap-3 rounded-lg border border-zinc-800 bg-black/25 p-4 sm:grid-cols-2">
            <PaymentDetail label="Status interno" value={loadingOrder ? "Consultando..." : order?.status ?? statusLabel(verifiedStatus)} />
            <PaymentDetail label="Status Mercado Pago" value={paymentStatus ?? "Aguardando webhook"} />
            <PaymentDetail label="Payment ID" value={order?.mercadoPagoPaymentId ?? paymentId ?? "Nao informado"} />
            <PaymentDetail label="Pedido interno" value={orderReference ?? "Nao informado"} />
            <PaymentDetail label="Preference ID" value={preferenceId ?? "Nao informado"} />
            <PaymentDetail label="Valor confirmado" value={order ? formatMoney(order.amountInCents, order.currency) : "Aguardando pedido"} />
          </div>
          {loadingOrder || orderError ? (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-zinc-800 bg-black/20 px-4 py-3 text-sm text-zinc-300">
              {loadingOrder ? <Loader2 className="h-4 w-4 animate-spin text-[#FFD500]" /> : <AlertCircle className="h-4 w-4 text-amber-300" />}
              {loadingOrder ? "Consultando status oficial salvo no backend..." : orderError}
            </div>
          ) : null}

          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <a className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#FFD500] px-4 text-sm font-bold text-black transition hover:bg-[#FFEA70]" href="/dashboard">
              <CreditCard className="h-4 w-4" />
              Abrir painel
            </a>
            <a className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-zinc-700 px-4 text-sm font-bold text-zinc-200 transition hover:border-[#FFD500]/40 hover:text-[#FFEA70]" href="/planos">
              Ver planos
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </section>

        <div className="mt-5 flex items-start gap-3 rounded-lg border border-[#FFD500]/15 bg-[#FFD500]/[.05] p-4 text-sm leading-6 text-zinc-400">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#FFD500]" />
          <p>O retorno do Mercado Pago e apenas visual. O plano so e liberado quando o backend confirma o pagamento pelo webhook assinado e consulta oficial da API.</p>
        </div>
      </div>
    </main>
  );
}

function statusFromOrder(orderStatus: PaymentOrder["status"], fallback: PaymentReturnStatus): PaymentReturnStatus {
  if (orderStatus === "paid") return "success";
  if (["pending", "processing", "in_review"].includes(orderStatus)) return "pending";
  if (["cancelled", "expired", "failed", "refunded", "charged_back"].includes(orderStatus)) return "failure";
  return fallback;
}

function formatMoney(cents: number, currency: PaymentOrder["currency"]) {
  return new Intl.NumberFormat("pt-BR", {
    currency,
    style: "currency"
  }).format(cents / 100);
}

function PaymentDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-bold uppercase text-zinc-500">{label}</p>
      <p className="mt-1 truncate font-mono text-sm text-zinc-200">{value}</p>
    </div>
  );
}

function statusLabel(status: PaymentReturnStatus) {
  const labels: Record<PaymentReturnStatus, string> = {
    failure: "falha",
    pending: "pendente",
    success: "aprovado"
  };
  return labels[status];
}
