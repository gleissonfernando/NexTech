import { ArrowLeft, Bot, Check, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { getPublicPlans } from "../lib/api";
import type { Plan } from "../types";

export function PublicPlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getPublicPlans().then(setPlans).catch(() => setError("Não foi possível carregar os planos agora.")).finally(() => setLoading(false));
  }, []);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#080808] px-4 py-10 text-white sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,213,0,.13),transparent_32rem)]" />
      <div className="relative mx-auto max-w-7xl">
        <header className="flex items-center justify-between gap-4">
          <a className="flex items-center gap-2 text-[#FFD500]" href="/"><span className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#FFD500]/30 bg-[#FFD500]/10"><Bot className="h-5 w-5" /></span><strong className="text-xl">Nex Tech</strong></a>
          <a className="flex items-center gap-2 rounded-lg border border-[#FFD500]/25 px-4 py-2 text-sm text-[#FFEA70] transition hover:bg-[#FFD500]/10" href="/"><ArrowLeft className="h-4 w-4" />Voltar ao início</a>
        </header>
        <section className="py-20 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-[#FFD500]/25 bg-[#FFD500]/10 px-4 py-2 text-sm text-[#FFEA70]"><Sparkles className="h-4 w-4" />Planos Nex Tech</span>
          <h1 className="mt-6 text-4xl font-black tracking-tight sm:text-6xl">Escolha o plano ideal para sua operação</h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-zinc-400">Compare os planos públicos e entre na dashboard somente quando decidir continuar.</p>
        </section>
        {loading ? <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-[#FFD500]" /></div> : null}
        {error ? <div className="mx-auto max-w-xl rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-center text-sm text-red-200">{error}</div> : null}
        {!loading && !error ? <section aria-label="Planos disponíveis" className="grid items-stretch gap-5 md:grid-cols-2 xl:grid-cols-3">{plans.map((plan) => <PublicPlanCard key={plan.id} plan={plan} />)}</section> : null}
        {!loading && !error && !plans.length ? <p className="py-20 text-center text-zinc-500">Nenhum plano público disponível no momento.</p> : null}
        <div className="mx-auto mt-16 flex max-w-3xl items-start gap-3 rounded-xl border border-[#FFD500]/15 bg-[#FFD500]/[.05] p-5 text-sm leading-6 text-zinc-400"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#FFD500]" /><p>Esta página mostra somente informações públicas. Tokens, pagamentos e dados administrativos não são enviados ao navegador.</p></div>
      </div>
    </main>
  );
}

function PublicPlanCard({ plan }: { plan: Plan }) {
  const price = plan.promotionalPriceInCents ?? plan.priceInCents;
  const features = [`${plan.botLimit} ${plan.botLimit === 1 ? "bot" : "bots"}`, `${plan.guildLimit} ${plan.guildLimit === 1 ? "servidor" : "servidores"}`, plan.validityDays ? `${plan.validityDays} dias de validade` : "Validade contínua", "Dashboard e módulos do plano"];
  return <article className={`relative flex flex-col rounded-2xl border bg-[#121212]/95 p-6 ${plan.isRecommended ? "border-[#FFD500]/60 shadow-[0_0_42px_rgba(255,213,0,.16)]" : "border-[#FFD500]/20"}`}>
    {plan.badge || plan.isRecommended ? <span className="absolute right-4 top-4 rounded-full bg-[#FFD500] px-3 py-1 text-xs font-black text-black">{plan.badge || "Recomendado"}</span> : null}
    <p className="text-sm font-semibold text-[#FFEA70]">{cycleLabel(plan.billingCycle)}</p><h2 className="mt-3 pr-24 text-2xl font-black">{plan.name}</h2><p className="mt-3 min-h-12 text-sm leading-6 text-zinc-400">{plan.shortDescription || plan.description}</p>
    <div className="mt-6"><span className="text-4xl font-black text-[#FFD500]">{formatPrice(price, plan.currency)}</span><span className="text-sm text-zinc-500"> {price ? cycleSuffix(plan.billingCycle) : ""}</span></div>
    {plan.promotionalPriceInCents !== null && plan.promotionalPriceInCents < plan.priceInCents ? <p className="mt-1 text-sm text-zinc-600 line-through">{formatPrice(plan.priceInCents, plan.currency)}</p> : null}
    <ul className="mt-7 space-y-3">{features.map((feature) => <li className="flex gap-3 text-sm text-zinc-300" key={feature}><Check className="h-4 w-4 shrink-0 text-[#FFD500]" />{feature}</li>)}</ul>
    {plan.isPurchasable ? <a className="mt-8 flex h-12 items-center justify-center rounded-lg bg-[#FFD500] text-sm font-bold text-black transition hover:bg-[#FFEA70]" href="/dashboard">{plan.buttonText || "Escolher plano"}</a> : <span className="mt-8 flex h-12 items-center justify-center rounded-lg border border-zinc-700 text-sm font-bold text-zinc-500">Indisponível</span>}
  </article>;
}

function formatPrice(value: number, currency: Plan["currency"]) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value / 100); }
function cycleLabel(cycle: Plan["billingCycle"]) { return ({ monthly: "Mensal", quarterly: "Trimestral", semiannual: "Semestral", annual: "Anual", lifetime: "Vitalício", custom: "Personalizado" } as Record<Plan["billingCycle"], string>)[cycle]; }
function cycleSuffix(cycle: Plan["billingCycle"]) { return ({ monthly: "/mês", quarterly: "/trimestre", semiannual: "/semestre", annual: "/ano", lifetime: "pagamento único", custom: "" } as Record<Plan["billingCycle"], string>)[cycle]; }
