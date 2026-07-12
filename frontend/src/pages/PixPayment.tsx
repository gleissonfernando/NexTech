import { AlertCircle, ArrowLeft, CheckCircle2, Clipboard, Clock3, Loader2, QrCode } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getPaymentOrderStatus } from "../lib/api";
import type { PaymentOrder, Plan, PlanSubscription } from "../types";

type PixPaymentPageProps = {
  orderId: string;
};

export function PixPaymentPage({ orderId }: PixPaymentPageProps) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<PaymentOrder | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [subscription, setSubscription] = useState<PlanSubscription | null>(null);
  const finalStatus = order ? isFinalStatus(order.status) : false;
  const qrImage = useMemo(() => normalizeQrImage(order?.qrCode), [order?.qrCode]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let attempts = 0;

    async function load() {
      attempts += 1;
      try {
        const result = await getPaymentOrderStatus(orderId);
        if (cancelled) return;
        setOrder(result.order);
        setPlan(result.plan);
        setSubscription(result.subscription);
        setError(null);

        if (!isFinalStatus(result.order.status) && attempts < 40) {
          timer = window.setTimeout(load, 5000);
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(readError(requestError, "Nao foi possivel consultar este pagamento."));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [orderId]);

  async function copyPixCode() {
    if (!order?.pixCode) return;
    await navigator.clipboard.writeText(order.pixCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#080808] px-4 py-10 text-white sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,213,0,.13),transparent_32rem)]" />
      <div className="relative mx-auto max-w-5xl">
        <header className="flex items-center justify-between gap-4">
          <a className="flex items-center gap-2 text-[#FFD500]" href="/planos">
            <ArrowLeft className="h-4 w-4" />
            Voltar aos planos
          </a>
          <span className="rounded-full border border-[#FFD500]/25 bg-[#FFD500]/10 px-3 py-1 text-xs font-semibold text-[#FFEA70]">Pix Mercado Pago</span>
        </header>

        <section className="grid gap-6 py-12 lg:grid-cols-[1fr_1.05fr]">
          <div>
            <p className="text-sm font-semibold text-[#FFEA70]">{plan?.name ?? "Plano Nex Tech"}</p>
            <h1 className="mt-4 text-4xl font-black tracking-tight sm:text-5xl">Finalize seu pagamento via Pix</h1>
            <p className="mt-4 max-w-xl text-sm leading-6 text-zinc-400">Use o QR Code ou copie o codigo Pix. A liberacao acontece automaticamente assim que o Mercado Pago confirmar o pagamento.</p>

            <div className="mt-8 grid gap-3 rounded-xl border border-[#FFD500]/15 bg-black/50 p-5 text-sm">
              <PaymentLine label="Pedido" value={order?.id ?? orderId} />
              <PaymentLine label="Valor" value={order ? formatMoney(order.amountInCents, order.currency) : "Carregando..."} />
              <PaymentLine label="Status" value={order ? statusLabel(order.status) : "Consultando..."} />
              <PaymentLine label="Expira em" value={order?.expiresAt ? new Date(order.expiresAt).toLocaleString("pt-BR") : "Nao informado"} />
            </div>

            <StatusNotice error={error} finalStatus={finalStatus} loading={loading} order={order} subscription={subscription} />
          </div>

          <div className="rounded-xl border border-[#FFD500]/20 bg-[#111]/95 p-5 shadow-[0_0_42px_rgba(255,213,0,.10)]">
            <div className="flex items-center gap-3 border-b border-zinc-800 pb-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#FFD500]/25 bg-[#FFD500]/10">
                <QrCode className="h-5 w-5 text-[#FFD500]" />
              </span>
              <div>
                <h2 className="text-lg font-bold">QR Code Pix</h2>
                <p className="text-xs text-zinc-500">Pagamento processado pelo Mercado Pago</p>
              </div>
            </div>

            <div className="mt-6 flex min-h-72 items-center justify-center rounded-xl border border-zinc-800 bg-white p-4">
              {loading ? <Loader2 className="h-8 w-8 animate-spin text-zinc-900" /> : qrImage ? <img alt="QR Code Pix" className="max-h-72 max-w-full" src={qrImage} /> : <p className="max-w-xs text-center text-sm text-zinc-800">QR Code ainda nao disponivel. Use o codigo Pix abaixo ou aguarde a atualizacao.</p>}
            </div>

            <div className="mt-5">
              <label className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Pix copia e cola</label>
              <textarea className="mt-2 h-32 w-full resize-none rounded-lg border border-zinc-800 bg-black p-3 text-xs leading-5 text-zinc-200 outline-none" readOnly value={order?.pixCode ?? ""} />
              <button className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#FFD500] text-sm font-bold text-black transition hover:bg-[#FFEA70] disabled:cursor-not-allowed disabled:opacity-60" disabled={!order?.pixCode} onClick={() => void copyPixCode()} type="button">
                <Clipboard className="h-4 w-4" />
                {copied ? "Copiado" : "Copiar codigo Pix"}
              </button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function StatusNotice({ error, finalStatus, loading, order, subscription }: { error: string | null; finalStatus: boolean; loading: boolean; order: PaymentOrder | null; subscription: PlanSubscription | null }) {
  if (error) {
    return <div className="mt-5 flex items-start gap-3 rounded-xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-200"><AlertCircle className="mt-0.5 h-5 w-5" />{error}</div>;
  }
  if (order?.status === "approved") {
    return <div className="mt-5 flex items-start gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-4 text-sm text-emerald-200"><CheckCircle2 className="mt-0.5 h-5 w-5" />Pagamento aprovado{subscription ? " e assinatura ativada." : "."}</div>;
  }
  if (finalStatus) {
    return <div className="mt-5 flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-200"><AlertCircle className="mt-0.5 h-5 w-5" />Este pedido foi finalizado com status {statusLabel(order?.status ?? "error")}.</div>;
  }
  return <div className="mt-5 flex items-start gap-3 rounded-xl border border-[#FFD500]/20 bg-[#FFD500]/10 p-4 text-sm text-[#FFEA70]">{loading ? <Loader2 className="mt-0.5 h-5 w-5 animate-spin" /> : <Clock3 className="mt-0.5 h-5 w-5" />}Aguardando confirmacao do Mercado Pago.</div>;
}

function PaymentLine({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-4"><span className="text-zinc-500">{label}</span><span className="break-all text-right font-semibold text-zinc-100">{value}</span></div>;
}

function normalizeQrImage(value?: string | null) {
  if (!value) return null;
  return value.startsWith("data:image/") ? value : `data:image/png;base64,${value}`;
}

function isFinalStatus(status: PaymentOrder["status"]) {
  return ["approved", "paid", "cancelled", "expired", "rejected", "failed", "refunded", "chargeback", "charged_back", "error"].includes(status);
}

function statusLabel(status: PaymentOrder["status"] | "error") {
  const labels: Record<string, string> = {
    approved: "Aprovado",
    cancelled: "Cancelado",
    chargeback: "Chargeback",
    charged_back: "Chargeback",
    checkout_pending: "Aguardando Pix",
    created: "Criado",
    error: "Erro",
    expired: "Expirado",
    failed: "Falhou",
    in_process: "Em processamento",
    in_review: "Em analise",
    paid: "Pago",
    pending: "Pendente",
    refunded: "Reembolsado",
    rejected: "Recusado"
  };
  return labels[status] ?? status;
}

function formatMoney(cents: number, currency: PaymentOrder["currency"]) {
  return new Intl.NumberFormat("pt-BR", { currency, style: "currency" }).format(cents / 100);
}

function readError(error: unknown, fallback: string) {
  const candidate = error as { response?: { data?: { message?: string } }; message?: string };
  return candidate.response?.data?.message || candidate.message || fallback;
}
