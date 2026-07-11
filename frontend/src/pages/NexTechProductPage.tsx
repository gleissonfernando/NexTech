import { AlertCircle, CheckCircle2, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { checkoutNexTechProduct, getPublicNexTechProduct } from "../lib/api";
import type { NexTechProductPlanConfig, PublicNexTechProduct } from "../types";
import { Button } from "../components/ui/button";

type NexTechProductPageProps = {
  slug: string;
  status?: "success" | null;
  storeId: string;
};

const featureLabels: Record<string, string> = {
  activationKey: "Chave de ativacao",
  automaticContract: "Contrato automatico",
  automaticLogin: "Login automatico",
  automaticPix: "Pix automatico",
  automaticRenewal: "Renovacao automatica",
  coupons: "Aceita cupom",
  hosting: "Hospedagem inclusa",
  passwordCreation: "Criacao de senha",
  releaseCode: "Codigo de liberacao",
  support: "Suporte",
  updates: "Atualizacoes"
};

export function NexTechProductPage({ slug, status = null, storeId }: NexTechProductPageProps) {
  const [page, setPage] = useState<PublicNexTechProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutMessage, setCheckoutMessage] = useState<string | null>(null);
  const [checkoutSuccessUrl, setCheckoutSuccessUrl] = useState<string | null>(null);
  const [checkoutPlan, setCheckoutPlan] = useState<"monthly" | "lifetime" | null>(null);
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");

  useEffect(() => {
    let mounted = true;

    getPublicNexTechProduct(storeId, slug)
      .then((data) => {
        if (mounted) setPage(data);
      })
      .catch(() => {
        if (mounted) setPage(null);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [slug, storeId]);

  const enabledFeatures = useMemo(() => {
    if (!page) return [];
    return Object.entries(page.product.toggles)
      .filter(([, enabled]) => enabled)
      .map(([key]) => featureLabels[key] ?? key);
  }, [page]);

  async function handleCheckout(planType: "monthly" | "lifetime") {
    if (!page) return;

    setCheckoutPlan(planType);
    setCheckoutMessage(null);
    setCheckoutSuccessUrl(null);
    try {
      const result = await checkoutNexTechProduct(page.settings.storeId, page.product.slug, {
        buyerEmail: buyerEmail || null,
        buyerName: buyerName || null,
        paymentProviderId: page.product.plans[planType].paymentProviderId ?? page.paymentProviders[0]?.id ?? null,
        planType
      });

      if (result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
        return;
      }

      setCheckoutSuccessUrl(result.successUrl);
      setCheckoutMessage(result.instructions || `Pedido criado. Gateway: ${result.provider}. Venda: ${result.sale.id}`);
    } catch {
      setCheckoutMessage("Nao foi possivel iniciar a compra. Confira os dados e tente novamente.");
    } finally {
      setCheckoutPlan(null);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#050506] text-white">
        <Loader2 className="h-8 w-8 animate-spin text-[#FFEA70]" />
      </main>
    );
  }

  if (!page) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#050506] px-4 text-white">
        <div className="max-w-md rounded-lg border border-zinc-800 bg-zinc-950/80 p-6 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-red-300" />
          <h1 className="mt-3 text-xl font-bold">Produto indisponivel</h1>
          <p className="mt-2 text-sm text-zinc-400">Essa pagina nao existe ou esta desativada.</p>
        </div>
      </main>
    );
  }

  const { product } = page;
  const accent = product.layout.accentColor || page.settings.panelColor || "#FFD500";

  if (status === "success") {
    const saleId = new URLSearchParams(window.location.search).get("saleId");

    return (
      <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,rgba(34,197,94,0.18),transparent_34%),linear-gradient(180deg,#050506,#09090d_48%,#050506)] px-4 text-white">
        <div className="w-full max-w-lg rounded-lg border border-emerald-400/25 bg-zinc-950/90 p-6 text-center shadow-[0_0_60px_rgba(34,197,94,0.14)]">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-300" />
          <h1 className="mt-4 text-2xl font-black">Pagamento concluido</h1>
          <p className="mt-3 text-sm font-medium leading-6 text-zinc-300">
            Recebemos o retorno do pagamento de {product.name}. Se o gateway enviar webhook, a venda sera confirmada automaticamente; caso contrario, a loja pode validar manualmente.
          </p>
          {saleId ? (
            <p className="mt-4 rounded-lg border border-zinc-800 bg-black/35 px-3 py-2 text-xs font-semibold text-zinc-400">
              Pedido: {saleId}
            </p>
          ) : null}
          <Button className="mt-5 w-full bg-emerald-500 text-white hover:bg-emerald-400" onClick={() => window.location.assign(`/nex-tech/${encodeURIComponent(storeId)}/${encodeURIComponent(slug)}`)}>
            Voltar ao produto
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(255,213,0,0.22),transparent_34%),linear-gradient(180deg,#050506,#09090d_48%,#050506)] px-4 py-8 text-white">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="overflow-hidden rounded-lg border border-[#FFD500]/20 bg-zinc-950/80 shadow-[0_0_60px_rgba(255,213,0,0.16)]">
          <div className="relative min-h-[260px] bg-black">
            {product.bannerUrl ? (
              <img alt={product.name} className="h-[360px] w-full object-cover" src={product.bannerUrl} />
            ) : (
              <div className="h-[360px] bg-[radial-gradient(circle_at_30%_20%,rgba(255,213,0,0.55),transparent_32%),linear-gradient(135deg,#18181b,#050506)]" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-[#050506] via-[#050506]/35 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-5 sm:p-8">
              <div className="max-w-3xl">
                <span className="inline-flex rounded-lg border border-[#FFEA70]/25 bg-[#FFD500]/15 px-3 py-1 text-xs font-bold text-[#FFEA70]">
                  {product.category}
                </span>
                <h1 className="mt-4 text-4xl font-black tracking-normal text-white sm:text-6xl">{product.name}</h1>
                <p className="mt-3 max-w-2xl text-base font-medium leading-7 text-zinc-200">{product.shortDescription}</p>
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="space-y-6">
            <ProductTextSection title="Descricao" text={product.fullDescription || product.shortDescription} />
            <ProductTextSection title="Como funciona" text={product.howItWorks} />
            <ProductTextSection title="Informacoes" text={product.additionalInfo} />
            <ProductTextSection title="Observacoes" text={product.observations} />
            <ProductTextSection tone="warning" title="Avisos" text={product.warnings} />

            {enabledFeatures.length ? (
              <div className="rounded-lg border border-zinc-800 bg-white/[0.04] p-5 backdrop-blur">
                <h2 className="text-lg font-bold">Recursos inclusos</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {enabledFeatures.map((feature) => (
                    <div className="flex items-center gap-3 rounded-lg border border-[#FFD500]/15 bg-[#FFD500]/[0.06] p-3" key={feature}>
                      <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                      <span className="text-sm font-semibold text-zinc-100">{feature}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-lg border border-[#FFD500]/25 bg-white/[0.06] p-4 shadow-[0_0_40px_rgba(255,213,0,0.14)] backdrop-blur-xl">
              <div className="flex items-center gap-2 text-sm font-bold text-[#FFEA70]">
                <Sparkles className="h-4 w-4" />
                Escolha seu plano
              </div>
              <div className="mt-4 space-y-3">
                <input
                  className="h-11 w-full rounded-lg border border-zinc-800 bg-black/45 px-3 text-sm text-white outline-none focus:border-[#FFEA70]"
                  onChange={(event) => setBuyerName(event.target.value)}
                  placeholder="Seu nome"
                  value={buyerName}
                />
                <input
                  className="h-11 w-full rounded-lg border border-zinc-800 bg-black/45 px-3 text-sm text-white outline-none focus:border-[#FFEA70]"
                  onChange={(event) => setBuyerEmail(event.target.value)}
                  placeholder="Seu email"
                  type="email"
                  value={buyerEmail}
                />
              </div>
              <div className="mt-4 space-y-3">
                <PlanCard accent={accent} currency={page.settings.currency} loading={checkoutPlan === "monthly"} onClick={() => void handleCheckout("monthly")} plan={product.plans.monthly} />
                <PlanCard accent={accent} currency={page.settings.currency} loading={checkoutPlan === "lifetime"} onClick={() => void handleCheckout("lifetime")} plan={product.plans.lifetime} />
              </div>
              {checkoutMessage ? (
                <div className="mt-4 space-y-2 rounded-lg border border-emerald-400/25 bg-emerald-500/10 p-3 text-sm font-semibold text-emerald-100">
                  <p>{checkoutMessage}</p>
                  {checkoutSuccessUrl ? (
                    <a className="block break-all text-xs text-emerald-200 underline decoration-emerald-300/50" href={checkoutSuccessUrl}>
                      URL de retorno apos pagamento: {checkoutSuccessUrl}
                    </a>
                  ) : null}
                </div>
              ) : null}
              <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-zinc-400">
                <ShieldCheck className="h-4 w-4 text-emerald-300" />
                Pagamento processado pela conta da loja.
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

function ProductTextSection({ text, title, tone = "default" }: { text: string; title: string; tone?: "default" | "warning" }) {
  if (!text.trim()) return null;

  return (
    <div className={`rounded-lg border p-5 backdrop-blur ${tone === "warning" ? "border-amber-400/25 bg-amber-500/[0.07]" : "border-zinc-800 bg-white/[0.04]"}`}>
      <h2 className="text-lg font-bold">{title}</h2>
      <p className="mt-3 whitespace-pre-line text-sm font-medium leading-7 text-zinc-300">{text}</p>
    </div>
  );
}

function PlanCard({
  accent,
  currency,
  loading,
  onClick,
  plan
}: {
  accent: string;
  currency: "BRL" | "USD" | "EUR";
  loading: boolean;
  onClick: () => void;
  plan: NexTechProductPlanConfig;
}) {
  if (!plan.enabled) return null;

  return (
    <div className="rounded-lg border border-zinc-800 bg-black/35 p-4">
      <p className="text-sm font-bold text-white">{plan.name}</p>
      <p className="mt-1 text-2xl font-black text-white">{plan.priceText || formatMoney(plan.priceCents, currency)}</p>
      <p className="mt-2 whitespace-pre-line text-xs font-medium leading-5 text-zinc-400">{plan.description}</p>
      {plan.benefits.length ? (
        <ul className="mt-3 space-y-2">
          {plan.benefits.map((benefit) => (
            <li className="flex gap-2 text-xs font-semibold text-zinc-200" key={benefit}>
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
              {benefit}
            </li>
          ))}
        </ul>
      ) : null}
      <Button className="mt-4 w-full text-white hover:brightness-110" disabled={loading} onClick={onClick} style={{ backgroundColor: plan.buttonColor || accent }}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {plan.buttonText}
      </Button>
    </div>
  );
}

function formatMoney(cents: number, currency: "BRL" | "USD" | "EUR") {
  return new Intl.NumberFormat("pt-BR", {
    currency,
    style: "currency"
  }).format(cents / 100);
}
