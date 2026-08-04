import { ArrowLeft, Bot, CalendarDays, Check, CreditCard, Loader2, QrCode, Server, ShieldCheck, ShoppingCart, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPlanCheckoutInterest, getPublicPlans } from "../lib/api";
import type { Plan } from "../types";

type PlanPeriodicityFilter = "all" | "monthly";
type PlanLevelFilter = "basic" | "advanced";

const PERIODICITY_FILTERS: Array<{ label: string; value: PlanPeriodicityFilter }> = [
  { label: "Todos", value: "all" },
  { label: "Mensal", value: "monthly" }
];

const LEVEL_FILTERS: Array<{ label: string; value: PlanLevelFilter }> = [
  { label: "Básico", value: "basic" },
  { label: "Avançado", value: "advanced" }
];

export function PublicPlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyPlanSlug, setBusyPlanSlug] = useState<string | null>(null);
  const [busyPaymentMethod, setBusyPaymentMethod] = useState<"card" | "pix" | null>(null);
  const [paymentPlan, setPaymentPlan] = useState<Plan | null>(null);
  const [periodicityFilter, setPeriodicityFilter] = useState<PlanPeriodicityFilter>("all");
  const [levelFilter, setLevelFilter] = useState<PlanLevelFilter>("basic");

  const filteredPlans = useMemo(() => plans.filter((plan) => {
    const periodicityMatches = periodicityFilter === "all" || planPeriodicity(plan) === periodicityFilter;
    const levelMatches = planLevel(plan) === levelFilter;
    return periodicityMatches && levelMatches;
  }), [levelFilter, periodicityFilter, plans]);

  useEffect(() => {
    void getPublicPlans().then(setPlans).catch(() => setError("Não foi possível carregar os planos agora.")).finally(() => setLoading(false));
  }, []);

  async function startCheckout(plan: Plan, paymentMethod: "card" | "pix", cpfCnpj?: string | null) {
    setBusyPlanSlug(plan.slug);
    setBusyPaymentMethod(paymentMethod);
    setError(null);

    try {
      const result = await createPlanCheckoutInterest(plan.id, paymentMethod === "pix" ? "pix" : "checkout", { cpfCnpj });
      if (result.order.pixCode || result.order.qrCode) {
        window.location.assign(`/pagamento/pix/${encodeURIComponent(result.order.id)}`);
        return;
      }
      if (result.order.checkoutUrl) {
        window.location.assign(result.order.checkoutUrl);
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
    <main className="min-h-screen bg-[var(--nextech-bg)] px-4 py-6 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-primary/15 pb-5">
          <a className="flex min-w-0 items-center gap-3 text-primary" href="/">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-primary/35 bg-primary/10 shadow-[0_0_24px_rgba(255,213,0,.14)]"><Bot className="h-5 w-5" /></span>
            <span className="min-w-0">
              <strong className="block truncate text-xl font-black text-white">NexTech</strong>
              <span className="block truncate text-xs font-semibold uppercase text-[var(--nextech-accent-soft)]">Planos públicos</span>
            </span>
          </a>
          <a className="flex h-10 items-center gap-2 rounded-lg border border-primary/25 px-4 text-sm font-bold text-[var(--nextech-accent-soft)] transition hover:bg-primary/10" href="/"><ArrowLeft className="h-4 w-4" />Voltar</a>
        </header>
        <section className="grid gap-6 py-10 lg:grid-cols-[1.1fr_.9fr] lg:items-end">
          <div>
            <span className="inline-flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/10 px-3 py-2 text-sm font-bold text-[var(--nextech-accent-soft)]"><Sparkles className="h-4 w-4" />Loja NexTech</span>
            <h1 className="mt-5 max-w-3xl text-4xl font-black leading-tight sm:text-5xl">Escolha o sistema para sua operação</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-400">Compare Básico e Avançado sem misturar os planos. Cada card mostra o que vem incluso, o prazo e o checkout disponível.</p>
          </div>
          <div className="grid gap-3 rounded-lg border border-primary/20 bg-[#101010] p-4 shadow-[0_0_36px_rgba(255,213,0,.08)] sm:grid-cols-3">
            <MetricTile icon={Bot} label="Bot" value="1 por plano" />
            <MetricTile icon={Server} label="Servidor" value="1 incluso" />
            <MetricTile icon={CalendarDays} label="Validade" value="30 dias" />
          </div>
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
        {!loading && !error && plans.length > 0 && !filteredPlans.length ? <p className="plans-grid-transition py-20 text-center text-zinc-500" key={`${periodicityFilter}-${levelFilter}-empty`}>Nenhum plano {levelFilter === "basic" ? "básico" : "avançado"} encontrado para este filtro.</p> : null}
        <div className="mx-auto mt-12 flex max-w-3xl items-start gap-3 rounded-lg border border-primary/15 bg-[#101010] p-4 text-sm leading-6 text-zinc-400"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><p>Esta página mostra somente informações públicas. Tokens, pagamentos e dados administrativos não são enviados ao navegador.</p></div>
      </div>
      {paymentPlan ? (
        <PaymentMethodDialog
          busyMethod={busyPlanSlug === paymentPlan.slug ? busyPaymentMethod : null}
          onClose={() => busyPlanSlug ? null : setPaymentPlan(null)}
          onSelect={(method, cpfCnpj) => void startCheckout(paymentPlan, method, cpfCnpj)}
          plan={paymentPlan}
        />
      ) : null}
    </main>
  );
}

function MetricTile({ icon: Icon, label, value }: { icon: typeof Bot; label: string; value: string }) {
  return (
    <div className="min-w-0 border-l border-primary/25 pl-3 first:border-l-0 first:pl-0 sm:first:border-l sm:first:pl-3">
      <Icon className="h-4 w-4 text-primary" />
      <p className="mt-3 text-xs font-black uppercase text-zinc-500">{label}</p>
      <p className="mt-1 truncate text-sm font-bold text-zinc-100">{value}</p>
    </div>
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
  onSelect: (method: "card" | "pix", cpfCnpj?: string | null) => void;
  plan: Plan;
}) {
  const [cpfCnpj, setCpfCnpj] = useState("");
  const disabled = Boolean(busyMethod);
  const cpfCnpjDigits = cpfCnpj.replace(/\D/g, "");
  const pixDisabled = disabled || ![11, 14].includes(cpfCnpjDigits.length);

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
          <label className="grid gap-2 text-sm font-semibold text-zinc-300">
            CPF ou CNPJ para Pix
            <input
              className="h-11 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-white outline-none transition focus:border-primary disabled:opacity-60"
              disabled={disabled}
              inputMode="numeric"
              maxLength={18}
              onChange={(event) => setCpfCnpj(event.target.value)}
              placeholder="Somente números"
              value={cpfCnpj}
            />
          </label>
          <button className="flex min-h-16 items-center gap-3 rounded-lg border border-primary/30 bg-primary px-4 text-left text-black transition hover:bg-[var(--nextech-accent-soft)] disabled:cursor-not-allowed disabled:opacity-70" disabled={pixDisabled} onClick={() => onSelect("pix", cpfCnpjDigits)} type="button">
            {busyMethod === "pix" ? <Loader2 className="h-5 w-5 animate-spin" /> : <QrCode className="h-5 w-5" />}
            <span>
              <span className="block text-sm font-black">Pagar com Pix</span>
              <span className="block text-xs font-semibold opacity-80">Gerar QR Code Asaas</span>
            </span>
          </button>
          <button className="flex min-h-16 items-center gap-3 rounded-lg border border-zinc-700 bg-black px-4 text-left text-zinc-100 transition hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-70" disabled={disabled} onClick={() => onSelect("card")} type="button">
            {busyMethod === "card" ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : <CreditCard className="h-5 w-5 text-primary" />}
            <span>
              <span className="block text-sm font-black">Pagar com cartão</span>
              <span className="block text-xs font-semibold text-zinc-500">Checkout seguro do gateway ativo</span>
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
    <div className="mb-6 grid gap-4 rounded-lg border border-primary/20 bg-[#101010] p-4 shadow-[0_12px_40px_rgba(0,0,0,.28)] lg:grid-cols-2 lg:items-center">
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
      <span className="mr-1 min-w-28 text-xs font-black uppercase text-zinc-500">{label}</span>
      {filters.map((filter) => (
        <button
          className={filter.value === value
            ? "h-10 rounded-lg border border-primary bg-primary px-4 text-sm font-black text-black transition"
            : "h-10 rounded-lg border border-primary/25 bg-black px-4 text-sm font-bold text-[var(--nextech-accent-soft)] transition hover:border-primary/60 hover:bg-primary/10"}
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
  const level = planLevel(plan);
  const includedFeatures = plan.entitlements.filter((feature) => feature.enabled).map((feature) => readablePlanFeature(feature.key));
  const features = includedFeatures.slice(0, 6);
  const extraCount = Math.max(0, includedFeatures.length - features.length);
  return <article className={`relative flex min-h-full flex-col overflow-hidden rounded-lg border bg-[#101010] ${plan.isRecommended ? "border-primary/70 shadow-[0_0_38px_rgba(255,213,0,.18)]" : "border-primary/20"}`}>
    <div className="h-1 bg-primary" />
    <div className="flex flex-1 flex-col p-5">
      <div className="flex min-h-9 flex-wrap items-start justify-between gap-2">
        <span className="rounded-lg border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-black uppercase text-[var(--nextech-accent-soft)]">{level === "basic" ? "Básico" : "Avançado"}</span>
        {plan.badge || plan.isRecommended ? <span className="rounded-lg bg-primary px-3 py-1 text-xs font-black text-black">{plan.badge || "Recomendado"}</span> : null}
      </div>
      <p className="mt-5 text-xs font-black uppercase text-zinc-500">{cycleLabel(plan.billingCycle)}</p>
      <h2 className="mt-2 text-2xl font-black leading-tight text-white">{plan.name}</h2>
      <p className="mt-3 min-h-14 text-sm leading-6 text-zinc-400">{plan.shortDescription || plan.description}</p>
      <div className="mt-5 border-y border-white/10 py-5">
        <span className="text-4xl font-black text-primary">{formatPrice(price, plan.currency)}</span>
        <span className="text-sm font-semibold text-zinc-500"> {price ? cycleSuffix(plan.billingCycle) : ""}</span>
        {plan.promotionalPriceInCents !== null && plan.promotionalPriceInCents < plan.priceInCents ? <p className="mt-1 text-sm text-zinc-600 line-through">{formatPrice(plan.priceInCents, plan.currency)}</p> : null}
      </div>
      <div className="grid grid-cols-2 gap-2 border-b border-white/10 py-4">
        <PlanFact label="Bots" value={String(plan.botLimit)} />
        <PlanFact label="Servidor" value={String(plan.guildLimit)} />
        <PlanFact label="Validade" value={plan.validityDays ? `${plan.validityDays} dias` : "Contínua"} />
        <PlanFact label="Hospedagem" value={(plan.badge ?? "").toLowerCase().includes("sem hospedagem") ? "Não inclusa" : "Conferir"} />
      </div>
      <p className="mt-5 text-xs font-black uppercase text-[var(--nextech-accent-soft)]">Recursos inclusos</p>
      <ul className="mt-3 flex-1 space-y-3">{features.map((feature) => <li className="flex gap-3 text-sm leading-5 text-zinc-300" key={feature}><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{feature}</li>)}</ul>
      {extraCount > 0 ? <p className="mt-3 text-xs font-semibold text-zinc-500">+{extraCount} recurso(s) adicional(is)</p> : null}
    </div>
    {plan.isPurchasable ? <div className="border-t border-white/10 p-5 pt-0">
      <button className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-black text-black transition hover:bg-[var(--nextech-accent-soft)] disabled:cursor-not-allowed disabled:opacity-70" disabled={busy} onClick={onBuy} type="button">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}Comprar</button>
      <p className="mt-2 text-center text-xs font-medium text-zinc-500">Pix e cartão conforme disponibilidade do checkout</p>
    </div> : <span className="mt-8 flex h-12 items-center justify-center rounded-lg border border-zinc-700 text-sm font-bold text-zinc-500">Indisponível</span>}
  </article>;
}

function PlanFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/10 bg-black/35 px-3 py-2">
      <p className="truncate text-[11px] font-black uppercase text-zinc-500">{label}</p>
      <p className="mt-1 truncate text-sm font-bold text-zinc-100">{value}</p>
    </div>
  );
}

function readablePlanFeature(key: string) {
  const features: Record<string, string> = {
    "billing.free_hosting_30d": "30 dias de hospedagem grátis",
    "billing.future_updates": "Atualizações futuras incluídas",
    "billing.lifetime_license": "Licença vitalícia do módulo",
    "discord.courses": "Cursos, provas e publicações",
    "discord.dashboard": "Dashboard para configurar e acompanhar",
    "discord.logs": "Logs do Discord em tempo real",
    "discord.tickets": "Tickets de atendimento e suporte",
    "fivem.faction_basic": "Facção RP Básico: membros e ações essenciais",
    "fivem.faction": "Facção RP Completo: membros, metas e estoque",
    "fivem.finance": "Financeiro FiveM com auditoria",
    "fivem.hierarchy": "Hierarquia FiveM e cargos",
    "fivem.police_basic": "Polícia RP Básico: ações, QRU e ponto",
    "fivem.police": "Polícia RP Completo: patentes, metas e plantão",
    "security.anti_ban": "Anti Ban administrativo",
    "security.role_protection_basic": "Proteção básica contra alteração de cargos",
    "security.role_protection": "Proteção completa de cargos e permissões",
    "security.self_bot": "SelfBot Protection",
    "streamer.ai": "Recursos de IA para comunidade",
    "streamer.clip_automation": "Automação de clips",
    "streamer.giveaways": "Sorteios e campanhas",
    "streamer.kick_alerts": "Alertas Kick",
    "streamer.ranking": "Ranking de engajamento",
    "streamer.twitch_alerts": "Alertas Twitch",
    "streamer.vip": "Sistema VIP",
    "support.24h": "Atendimento prioritário 24 horas",
    "support.priority": "Suporte prioritário"
  };

  return features[key] ?? key.replace(/[._-]+/g, " ");
}

function planPeriodicity(_plan: Plan): Exclude<PlanPeriodicityFilter, "all"> {
  return "monthly";
}

function planLevel(plan: Plan): PlanLevelFilter {
  const text = normalizePlanText([plan.name, plan.slug, plan.badge, plan.shortDescription, plan.description].filter(Boolean).join(" "));
  if (/\b(avancado|completo|completa|premium|profissional|pro|ultimate|enterprise)\b/.test(text)) return "advanced";
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
