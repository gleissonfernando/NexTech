import { ArrowLeft, Bot, Check, CreditCard, Loader2, QrCode, ShieldCheck, ShoppingCart, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPlanCheckoutInterest, getPublicPlans } from "../lib/api";
import type { Plan } from "../types";

type PlanPeriodicityFilter = "all" | "monthly" | "lifetime";
type PlanLevelFilter = "all" | "basic" | "complete";

const PERIODICITY_FILTERS: Array<{ label: string; value: PlanPeriodicityFilter }> = [
  { label: "Todos", value: "all" },
  { label: "Mensal", value: "monthly" },
  { label: "Vitalício", value: "lifetime" }
];

const LEVEL_FILTERS: Array<{ label: string; value: PlanLevelFilter }> = [
  { label: "Todos", value: "all" },
  { label: "Básico", value: "basic" },
  { label: "Completo", value: "complete" }
];

export function PublicPlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyPlanSlug, setBusyPlanSlug] = useState<string | null>(null);
  const [busyPaymentMethod, setBusyPaymentMethod] = useState<"card" | "pix" | null>(null);
  const [paymentPlan, setPaymentPlan] = useState<Plan | null>(null);
  const [periodicityFilter, setPeriodicityFilter] = useState<PlanPeriodicityFilter>("all");
  const [levelFilter, setLevelFilter] = useState<PlanLevelFilter>("all");

  const filteredPlans = useMemo(() => plans.filter((plan) => {
    const periodicityMatches = periodicityFilter === "all" || planPeriodicity(plan) === periodicityFilter;
    const levelMatches = levelFilter === "all" || planLevel(plan) === levelFilter;
    return periodicityMatches && levelMatches;
  }), [levelFilter, periodicityFilter, plans]);

  useEffect(() => {
    void getPublicPlans().then(setPlans).catch(() => setError("Não foi possível carregar os planos agora.")).finally(() => setLoading(false));
  }, []);

  async function startCheckout(plan: Plan, paymentMethod: "card" | "pix") {
    setBusyPlanSlug(plan.slug);
    setBusyPaymentMethod(paymentMethod);
    setError(null);

    try {
      const result = await createPlanCheckoutInterest(plan.id, paymentMethod === "pix" ? "pix" : "checkout");
      if (result.order.checkoutUrl) {
        window.location.assign(result.order.checkoutUrl);
        return;
      }
      if (result.order.pixCode || result.order.qrCode || result.order.providerOrderId) {
        window.location.assign(`/pagamento/pix/${encodeURIComponent(result.order.id)}`);
        return;
      }

      setError(result.payment.message || "Pagamento indisponível para este plano no momento.");
    } catch (requestError) {
      setError(readError(requestError, "Não foi possível iniciar o checkout agora."));
    } finally {
      setBusyPlanSlug(null);
      setBusyPaymentMethod(null);
      setPaymentPlan(null);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[var(--nextech-bg)] px-4 py-10 text-white sm:px-6 lg:px-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,213,0,.13),transparent_32rem)]" />
      <div className="relative mx-auto max-w-7xl">
        <header className="flex items-center justify-between gap-4">
          <a className="flex items-center gap-2 text-primary" href="/"><span className="flex h-10 w-10 items-center justify-center rounded-lg border border-primary/30 bg-primary/10"><Bot className="h-5 w-5" /></span><strong className="text-xl">Nex Tech</strong></a>
          <a className="flex items-center gap-2 rounded-lg border border-primary/25 px-4 py-2 text-sm text-[var(--nextech-accent-soft)] transition hover:bg-primary/10" href="/"><ArrowLeft className="h-4 w-4" />Voltar ao início</a>
        </header>
        <section className="py-20 text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-4 py-2 text-sm text-[var(--nextech-accent-soft)]"><Sparkles className="h-4 w-4" />Planos Nex Tech</span>
          <h1 className="mt-6 text-4xl font-black tracking-tight sm:text-6xl">Escolha o plano ideal para sua operação</h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-zinc-400">Compare os planos públicos e entre na dashboard somente quando decidir continuar.</p>
        </section>
        {!loading && !error ? (
          <PlanFilterBar
            levelFilter={levelFilter}
            onLevelChange={setLevelFilter}
            onPeriodicityChange={setPeriodicityFilter}
            periodicityFilter={periodicityFilter}
          />
        ) : null}
        {loading ? <div className="flex min-h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div> : null}
        {error ? <div className="mx-auto max-w-xl rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-center text-sm text-red-200">{error}</div> : null}
        {!loading && !error && filteredPlans.length ? <section aria-label="Planos disponíveis" className="plans-grid-transition grid items-stretch gap-5 md:grid-cols-2 xl:grid-cols-3" key={`${periodicityFilter}-${levelFilter}`}>{filteredPlans.map((plan) => <PublicPlanCard busy={busyPlanSlug === plan.slug} key={plan.id} onBuy={() => setPaymentPlan(plan)} plan={plan} />)}</section> : null}
        {!loading && !error && !plans.length ? <p className="py-20 text-center text-zinc-500">Nenhum plano público disponível no momento.</p> : null}
        {!loading && !error && plans.length > 0 && !filteredPlans.length ? <p className="plans-grid-transition py-20 text-center text-zinc-500" key={`${periodicityFilter}-${levelFilter}-empty`}>Nenhum plano encontrado para este filtro.</p> : null}
        <div className="mx-auto mt-16 flex max-w-3xl items-start gap-3 rounded-xl border border-primary/15 bg-primary/[.05] p-5 text-sm leading-6 text-zinc-400"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><p>Esta página mostra somente informações públicas. Tokens, pagamentos e dados administrativos não são enviados ao navegador.</p></div>
      </div>
      {paymentPlan ? (
        <PaymentMethodDialog
          busyMethod={busyPlanSlug === paymentPlan.slug ? busyPaymentMethod : null}
          onClose={() => busyPlanSlug ? null : setPaymentPlan(null)}
          onSelect={(method) => void startCheckout(paymentPlan, method)}
          plan={paymentPlan}
        />
      ) : null}
    </main>
  );
}

function PaymentMethodDialog({
  busyMethod,
  onClose,
  onSelect,
  plan
}: {
  busyMethod: "card" | "pix" | null;
  onClose: () => void;
  onSelect: (method: "card" | "pix") => void;
  plan: Plan;
}) {
  const disabled = Boolean(busyMethod);

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 px-4 py-6 sm:items-center" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-xl border border-primary/20 bg-[#101010] p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[var(--nextech-accent-soft)]">Finalizar compra</p>
            <h2 className="mt-1 text-xl font-black text-white">{plan.name}</h2>
            <p className="mt-1 text-sm text-zinc-400">{formatPrice(plan.promotionalPriceInCents ?? plan.priceInCents, plan.currency)}</p>
          </div>
          <button className="rounded-lg border border-zinc-800 p-2 text-zinc-400 transition hover:text-white disabled:opacity-50" disabled={disabled} onClick={onClose} type="button">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 grid gap-3">
          <button className="flex min-h-16 items-center gap-3 rounded-lg border border-primary/30 bg-primary px-4 text-left text-black transition hover:bg-[var(--nextech-accent-soft)] disabled:cursor-not-allowed disabled:opacity-70" disabled={disabled} onClick={() => onSelect("pix")} type="button">
            {busyMethod === "pix" ? <Loader2 className="h-5 w-5 animate-spin" /> : <QrCode className="h-5 w-5" />}
            <span>
              <span className="block text-sm font-black">Pagar com Pix</span>
              <span className="block text-xs font-semibold opacity-80">QR Code e copia e cola gerado na NexTech</span>
            </span>
          </button>
          <button className="flex min-h-16 items-center gap-3 rounded-lg border border-zinc-700 bg-black px-4 text-left text-zinc-100 transition hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-70" disabled={disabled} onClick={() => onSelect("card")} type="button">
            {busyMethod === "card" ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : <CreditCard className="h-5 w-5 text-primary" />}
            <span>
              <span className="block text-sm font-black">Pagar com cartão</span>
              <span className="block text-xs font-semibold text-zinc-500">Checkout seguro do Mercado Pago</span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function PlanFilterBar({
  levelFilter,
  onLevelChange,
  onPeriodicityChange,
  periodicityFilter
}: {
  levelFilter: PlanLevelFilter;
  onLevelChange: (filter: PlanLevelFilter) => void;
  onPeriodicityChange: (filter: PlanPeriodicityFilter) => void;
  periodicityFilter: PlanPeriodicityFilter;
}) {
  return (
    <div className="mb-8 grid gap-3 rounded-xl border border-primary/15 bg-card/70 p-3 sm:grid-cols-2 sm:items-center">
      <FilterGroup filters={PERIODICITY_FILTERS} label="Periodicidade" onChange={onPeriodicityChange} value={periodicityFilter} />
      <FilterGroup filters={LEVEL_FILTERS} label="Nível do plano" onChange={onLevelChange} value={levelFilter} />
    </div>
  );
}

function FilterGroup<T extends string>({
  filters,
  label,
  onChange,
  value
}: {
  filters: Array<{ label: string; value: T }>;
  label: string;
  onChange: (filter: T) => void;
  value: T;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-xs font-semibold uppercase text-zinc-500">{label}</span>
      {filters.map((filter) => (
        <button
          className={filter.value === value
            ? "rounded-full border border-primary bg-primary px-4 py-2 text-sm font-black text-black transition"
            : "rounded-full border border-primary/35 bg-transparent px-4 py-2 text-sm font-bold text-[var(--nextech-accent-soft)] transition hover:bg-primary/10"}
          key={filter.value}
          onClick={() => onChange(filter.value)}
          type="button"
        >
          {filter.label}
        </button>
      ))}
    </div>
  );
}

function PublicPlanCard({ busy, onBuy, plan }: { busy: boolean; onBuy: () => void; plan: Plan }) {
  const price = plan.promotionalPriceInCents ?? plan.priceInCents;
  const includedFeatures = plan.entitlements.filter((feature) => feature.enabled).map((feature) => feature.key.replace(/[._-]+/g, " "));
  const features = [`${plan.botLimit} ${plan.botLimit === 1 ? "bot" : "bots"}`, `${plan.guildLimit} ${plan.guildLimit === 1 ? "servidor" : "servidores"}`, plan.validityDays ? `${plan.validityDays} dias de validade` : "Validade contínua", ...includedFeatures];
  return <article className={`relative flex flex-col rounded-2xl border bg-[var(--nextech-surface)] p-6 ${plan.isRecommended ? "border-primary/60 shadow-[0_0_42px_rgba(255,213,0,.16)]" : "border-primary/20"}`}>
    {plan.badge || plan.isRecommended ? <span className="absolute right-4 top-4 rounded-full bg-primary px-3 py-1 text-xs font-black text-black">{plan.badge || "Recomendado"}</span> : null}
    <p className="text-sm font-semibold text-[var(--nextech-accent-soft)]">{cycleLabel(plan.billingCycle)}</p><h2 className="mt-3 pr-24 text-2xl font-black">{plan.name}</h2><p className="mt-3 min-h-12 text-sm leading-6 text-zinc-400">{plan.shortDescription || plan.description}</p>
    <div className="mt-6"><span className="text-4xl font-black text-primary">{formatPrice(price, plan.currency)}</span><span className="text-sm text-zinc-500"> {price ? cycleSuffix(plan.billingCycle) : ""}</span></div>
    {plan.promotionalPriceInCents !== null && plan.promotionalPriceInCents < plan.priceInCents ? <p className="mt-1 text-sm text-zinc-600 line-through">{formatPrice(plan.priceInCents, plan.currency)}</p> : null}
    <ul className="mt-7 space-y-3">{features.map((feature) => <li className="flex gap-3 text-sm text-zinc-300" key={feature}><Check className="h-4 w-4 shrink-0 text-primary" />{feature}</li>)}</ul>
    {plan.billingCycle === "lifetime" ? (
      <p className="mt-5 rounded-lg border border-primary/20 bg-primary/10 p-3 text-sm font-semibold leading-6 text-[var(--nextech-accent-soft)]">
        Após o período gratuito será cobrada apenas a hospedagem, a partir de R$12,00 por mês. Sua licença continuará sendo vitalícia.
      </p>
    ) : null}
    {plan.isPurchasable ? <div className="mt-8">
      <button className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-bold text-black transition hover:bg-[var(--nextech-accent-soft)] disabled:cursor-not-allowed disabled:opacity-70" disabled={busy} onClick={onBuy} type="button">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}Comprar</button>
      <p className="mt-2 text-center text-xs font-medium text-zinc-500">Pix e cartão pelo Mercado Pago</p>
    </div> : <span className="mt-8 flex h-12 items-center justify-center rounded-lg border border-zinc-700 text-sm font-bold text-zinc-500">Indisponível</span>}
  </article>;
}

function planPeriodicity(plan: Plan): Exclude<PlanPeriodicityFilter, "all"> {
  return plan.billingCycle === "lifetime" ? "lifetime" : "monthly";
}

function planLevel(plan: Plan): Exclude<PlanLevelFilter, "all"> {
  const text = normalizePlanText([plan.name, plan.slug, plan.badge, plan.shortDescription, plan.description].filter(Boolean).join(" "));
  if (/\b(completo|completa|premium|profissional|pro)\b/.test(text) || plan.billingCycle === "lifetime") return "complete";
  return "basic";
}

function normalizePlanText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function formatPrice(value: number, currency: Plan["currency"]) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value / 100); }
function cycleLabel(cycle: Plan["billingCycle"]) { return ({ monthly: "Mensal", quarterly: "Trimestral", semiannual: "Semestral", annual: "Anual", lifetime: "Vitalício", custom: "Personalizado" } as Record<Plan["billingCycle"], string>)[cycle]; }
function cycleSuffix(cycle: Plan["billingCycle"]) { return ({ monthly: "/mês", quarterly: "/trimestre", semiannual: "/semestre", annual: "/ano", lifetime: "pagamento único", custom: "" } as Record<Plan["billingCycle"], string>)[cycle]; }
function readError(error: unknown, fallback: string) {
  const candidate = error as { response?: { data?: { message?: string } }; message?: string };
  return candidate.response?.data?.message || candidate.message || fallback;
}
