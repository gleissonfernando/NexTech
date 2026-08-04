import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  CheckCircle2,
  Copy,
  CreditCard,
  FileClock,
  Loader2,
  PackageCheck,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Tags,
  SlidersHorizontal,
  XCircle
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import {
  createDevPlan,
  createDevPlanFeature,
  duplicateDevPlan,
  extendPlanSubscription,
  getDevPlansDashboard,
  markPlanPaymentOrderPaidForTest,
  manuallyActivatePlanSubscription,
  setDevPlanActive,
  setPlanSubscriptionStatus,
  updateDevPlan,
  updateDevPlanFeature,
  updatePlanPaymentSettings
} from "../../lib/api";
import type { DevPlansDashboard, Plan, PlanFeature, SavePlanPayload } from "../../types";

type TabId = "overview" | "plans" | "features" | "subscriptions" | "orders" | "payments" | "logs";
type PlanLevelFilter = "basic" | "advanced";

type PlanFormState = {
  badge: string;
  botLimit: string;
  color: string;
  description: string;
  entitlements: string;
  guildLimit: string;
  id: string | null;
  isActive: boolean;
  isPublic: boolean;
  isPurchasable: boolean;
  isRecommended: boolean;
  name: string;
  order: string;
  priceInCents: string;
  shortDescription: string;
  slug: string;
  validityDays: string;
};

type FeatureFormState = {
  category: PlanFeature["category"];
  defaultLimit: string;
  description: string;
  id: string | null;
  isActive: boolean;
  isPublic: boolean;
  key: string;
  name: string;
  order: string;
  unit: string;
};

type BulkPlanPriceState = {
  isActive: boolean;
  isPublic: boolean;
  isPurchasable: boolean;
  priceInCents: string;
  promotionalPriceInCents: string;
};

const emptyPlanForm: PlanFormState = {
  badge: "",
  botLimit: "1",
  color: "#FFD500",
  description: "",
  entitlements: "",
  guildLimit: "1",
  id: null,
  isActive: true,
  isPublic: true,
  isPurchasable: false,
  isRecommended: false,
  name: "",
  order: "0",
  priceInCents: "0",
  shortDescription: "",
  slug: "",
  validityDays: ""
};

const emptyFeatureForm: FeatureFormState = {
  category: "discord",
  defaultLimit: "",
  description: "",
  id: null,
  isActive: true,
  isPublic: true,
  key: "",
  name: "",
  order: "0",
  unit: ""
};

export function DevPlansPanel() {
  const [dashboard, setDashboard] = useState<DevPlansDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabId>("overview");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [planLevelFilter, setPlanLevelFilter] = useState<PlanLevelFilter>("basic");
  const [planForm, setPlanForm] = useState<PlanFormState>(emptyPlanForm);
  const [bulkPriceForm, setBulkPriceForm] = useState<Record<string, BulkPlanPriceState>>({});
  const [featureForm, setFeatureForm] = useState<FeatureFormState>(emptyFeatureForm);
  const [activation, setActivation] = useState({ planId: "", userId: "", workspaceName: "" });
  const [paymentForm, setPaymentForm] = useState<PaymentFormState>({
    approvedRedirectUrl: "",
    botDashboardBaseUrl: "",
    botRegistrationUrl: "",
    cancelRedirectUrl: "",
    failureRedirectUrl: "",
    pendingRedirectUrl: "",
    plansPublicUrl: "",
    provider: "mercadopago" as const,
    successRedirectUrl: "",
    supportDiscordUrl: ""
  });

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const next = await getDevPlansDashboard();
      setDashboard(next);
      setActivation((current) => ({ ...current, planId: current.planId || next.plans[0]?.id || "" }));
      setPaymentForm({
        approvedRedirectUrl: next.paymentSettings.approvedRedirectUrl ?? "",
        botDashboardBaseUrl: next.paymentSettings.botDashboardBaseUrl ?? "",
        botRegistrationUrl: next.paymentSettings.botRegistrationUrl ?? "",
        cancelRedirectUrl: next.paymentSettings.cancelRedirectUrl ?? "",
        failureRedirectUrl: next.paymentSettings.failureRedirectUrl ?? "",
        pendingRedirectUrl: next.paymentSettings.pendingRedirectUrl ?? "",
        plansPublicUrl: next.paymentSettings.plansPublicUrl ?? "",
        provider: next.paymentSettings.provider === "pagbank" || next.paymentSettings.provider === "stripe" ? next.paymentSettings.provider : "mercadopago",
        successRedirectUrl: next.paymentSettings.successRedirectUrl ?? "",
        supportDiscordUrl: next.paymentSettings.supportDiscordUrl ?? ""
      });
    } catch (loadError) {
      setError(readError(loadError, "Não foi possível carregar o módulo Planos."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const tabs = useMemo<Array<{ id: TabId; label: string }>>(() => [
    { id: "overview", label: "Overview" },
    { id: "plans", label: "Planos" },
    { id: "features", label: "Features" },
    { id: "subscriptions", label: "Assinaturas" },
    { id: "orders", label: "Pedidos" },
    { id: "payments", label: "Pagamentos" },
    { id: "logs", label: "Auditoria" }
  ], []);

  const filteredPlans = useMemo(() => (
    dashboard?.plans.filter((plan) => planLevel(plan) === planLevelFilter) ?? []
  ), [dashboard?.plans, planLevelFilter]);

  useEffect(() => {
    if (!dashboard) return;
    setBulkPriceForm((current) => {
      const next: Record<string, BulkPlanPriceState> = {};
      for (const plan of dashboard.plans) {
        next[plan.id] = current[plan.id] ?? planToBulkPriceState(plan);
      }
      return next;
    });
  }, [dashboard]);

  async function withRefresh(key: string, action: () => Promise<unknown>, success: string) {
    setBusyKey(key);
    setError(null);
    setNotice(null);

    try {
      await action();
      setNotice(success);
      await load();
    } catch (requestError) {
      setError(readError(requestError, "Operação não concluída."));
    } finally {
      setBusyKey(null);
    }
  }

  async function handlePlanSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = planPayloadFromForm(planForm);
    await withRefresh("plan:save", () => (
      planForm.id ? updateDevPlan(planForm.id, payload) : createDevPlan(payload)
    ), planForm.id ? "Plano atualizado." : "Plano criado.");
    setPlanForm(emptyPlanForm);
  }

  async function handleFeatureSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      category: featureForm.category,
      defaultLimit: featureForm.defaultLimit ? Number(featureForm.defaultLimit) : null,
      description: featureForm.description,
      isActive: featureForm.isActive,
      isPublic: featureForm.isPublic,
      key: featureForm.key,
      name: featureForm.name,
      order: Number(featureForm.order || 0),
      unit: featureForm.unit || null
    };
    await withRefresh("feature:save", () => (
      featureForm.id ? updateDevPlanFeature(featureForm.id, payload) : createDevPlanFeature(payload)
    ), featureForm.id ? "Feature atualizada." : "Feature criada.");
    setFeatureForm(emptyFeatureForm);
  }

  async function handleManualActivation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await withRefresh("subscription:manual", () => manuallyActivatePlanSubscription(activation), "Assinatura ativada manualmente.");
  }

  async function handlePaymentSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await withRefresh("payments:save", () => updatePlanPaymentSettings({
      approvedRedirectUrl: paymentForm.approvedRedirectUrl || null,
      botDashboardBaseUrl: paymentForm.botDashboardBaseUrl || null,
      botRegistrationUrl: paymentForm.botRegistrationUrl || null,
      cancelRedirectUrl: paymentForm.cancelRedirectUrl || null,
      failureRedirectUrl: paymentForm.failureRedirectUrl || null,
      pendingRedirectUrl: paymentForm.pendingRedirectUrl || null,
      plansPublicUrl: paymentForm.plansPublicUrl || null,
      provider: paymentForm.provider,
      successRedirectUrl: paymentForm.successRedirectUrl || null,
      supportDiscordUrl: paymentForm.supportDiscordUrl || null
    }), "Configuração de pagamento atualizada.");
  }

  async function handleBulkPriceSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dashboard) return;

    const changedPlans = dashboard.plans.filter((plan) => hasBulkPriceChanges(plan, bulkPriceForm[plan.id]));
    if (!changedPlans.length) {
      setNotice("Nenhum valor foi alterado.");
      return;
    }

    await withRefresh("plans:bulk-prices", async () => {
      for (const plan of changedPlans) {
        await updateDevPlan(plan.id, planPayloadFromPlan(plan, bulkPriceForm[plan.id] ?? planToBulkPriceState(plan)));
      }
    }, `${changedPlans.length} plano(s) atualizado(s) de uma vez.`);
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex min-h-72 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#FFD500]" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 rounded-lg border border-[#FFD500]/20 bg-[#101013]/95 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.32)] lg:flex-row lg:items-center lg:justify-between">
        <div>
          <Badge className="border-[#FFD500]/30 bg-[#FFD500]/10 text-[#FFEA70]" variant="muted">DEV</Badge>
          <h2 className="mt-3 text-2xl font-black text-white">Módulo Planos</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
            Planos globais da dashboard, features, ativacao manual, pedidos e configuração de pagamento.
          </p>
        </div>
        <Button onClick={() => void load()} variant="outline">
          <RefreshCw className="h-4 w-4" />
          Atualizar
        </Button>
      </div>

      <div className="flex gap-2 overflow-x-auto rounded-lg border border-zinc-900 bg-black/25 p-2">
        {tabs.map((item) => (
          <Button key={item.id} onClick={() => setTab(item.id)} size="sm" variant={tab === item.id ? "default" : "outline"}>
            {item.label}
          </Button>
        ))}
      </div>

      {error ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div> : null}
      {notice ? <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{notice}</div> : null}

      {tab === "overview" && dashboard ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={PackageCheck} label="Planos ativos" value={String(dashboard.summary.activePlans)} />
          <MetricCard icon={ShieldCheck} label="Assinaturas ativas" value={String(dashboard.summary.activeSubscriptions)} />
          <MetricCard icon={FileClock} label="Interesses" value={String(dashboard.summary.interestOrders)} />
          <MetricCard icon={CreditCard} label="Pagamentos" value={dashboard.summary.paymentsEnabled ? "Ativo" : "Off"} />
        </section>
      ) : null}

      {tab === "plans" && dashboard ? (
        <section className="grid gap-5 xl:grid-cols-[1fr_24rem]">
          <div className="space-y-4">
            <PlanLevelSelector value={planLevelFilter} onChange={setPlanLevelFilter} />
            <BulkPriceEditor
              busy={busyKey === "plans:bulk-prices"}
              form={bulkPriceForm}
              onChange={setBulkPriceForm}
              onSubmit={handleBulkPriceSubmit}
              plans={filteredPlans}
            />
            <div className="grid gap-4 lg:grid-cols-2">
            {filteredPlans.map((plan) => (
              <Card key={plan.id}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle>{plan.name}</CardTitle>
                      <CardDescription>{planLevelLabel(plan)} / {plan.slug}</CardDescription>
                    </div>
                    <Badge variant={plan.isActive ? "success" : "muted"}>{plan.isActive ? "Ativo" : "Inativo"}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm leading-6 text-zinc-400">{plan.shortDescription || plan.description || defaultPlanDescription(plan)}</p>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="muted">{plan.botLimit} bot(s)</Badge>
                    <Badge variant="muted">{plan.guildLimit} servidor(es)</Badge>
                    <Badge variant="muted">{plan.validityDays ? `${plan.validityDays} dias` : "Sem vencimento fixo"}</Badge>
                    <Badge variant={plan.isPurchasable ? "success" : "muted"}>{plan.isPurchasable ? "Compra ativa" : "Interesse"}</Badge>
                  </div>
                  <PlanIncludedList features={dashboard.features} plan={plan} />
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => setPlanForm(planToForm(plan))} size="sm" variant="outline">
                      <SlidersHorizontal className="h-4 w-4" />
                      Editar
                    </Button>
                    <Button disabled={busyKey === `plan:duplicate:${plan.id}`} onClick={() => void withRefresh(`plan:duplicate:${plan.id}`, () => duplicateDevPlan(plan.id), "Plano duplicado.")} size="sm" variant="outline">
                      <Copy className="h-4 w-4" />
                      Duplicar
                    </Button>
                    <Button disabled={busyKey === `plan:toggle:${plan.id}`} onClick={() => void withRefresh(`plan:toggle:${plan.id}`, () => setDevPlanActive(plan.id, !plan.isActive), "Status do plano atualizado.")} size="sm" variant="outline">
                      {plan.isActive ? <PauseCircle className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
                      {plan.isActive ? "Desativar" : "Ativar"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            {!filteredPlans.length ? <p className="rounded-lg border border-zinc-800 bg-black/25 p-6 text-center text-sm text-zinc-500">Nenhum plano {planLevelFilter === "basic" ? "básico" : "avançado"} cadastrado.</p> : null}
            </div>
          </div>
          <PlanEditor form={planForm} busy={busyKey === "plan:save"} onChange={setPlanForm} onSubmit={handlePlanSubmit} />
        </section>
      ) : null}

      {tab === "features" && dashboard ? (
        <section className="grid gap-5 xl:grid-cols-[1fr_24rem]">
          <Card>
            <CardHeader>
              <CardTitle>Catalogo de features</CardTitle>
              <CardDescription>Chaves usadas nos entitlements dos planos.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {dashboard.features.map((feature) => (
                <button className="rounded-lg border border-zinc-800 bg-black/25 p-4 text-left transition hover:border-[#FFD500]/30" key={feature.id} onClick={() => setFeatureForm(featureToForm(feature))} type="button">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-mono text-sm text-[#FFEA70]">{feature.key}</p>
                    <Badge variant={feature.isActive ? "success" : "muted"}>{feature.category}</Badge>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-white">{feature.name}</p>
                  <p className="mt-1 text-sm text-zinc-500">{feature.description}</p>
                </button>
              ))}
            </CardContent>
          </Card>
          <FeatureEditor form={featureForm} busy={busyKey === "feature:save"} onChange={setFeatureForm} onSubmit={handleFeatureSubmit} />
        </section>
      ) : null}

      {tab === "subscriptions" && dashboard ? (
        <section className="grid gap-5 xl:grid-cols-[22rem_1fr]">
          <ManualActivationForm activation={activation} busy={busyKey === "subscription:manual"} onChange={setActivation} onSubmit={handleManualActivation} plans={dashboard.plans} />
          <Card>
            <CardHeader>
              <CardTitle>Assinaturas</CardTitle>
              <CardDescription>Ative, suspenda, cancele ou estenda manualmente.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {dashboard.subscriptions.map((subscription) => (
                <div className="rounded-lg border border-zinc-800 bg-black/25 p-4" key={subscription.id}>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="font-mono text-sm text-white">{subscription.discordId}</p>
                      <p className="mt-1 text-sm text-zinc-500">{subscription.plan?.name ?? subscription.planSlug} / {subscription.workspace?.name ?? "sem workspace"}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={subscription.status === "active" ? "success" : "muted"}>{subscription.status}</Badge>
                      <Button onClick={() => void withRefresh(`sub:reactivate:${subscription.id}`, () => setPlanSubscriptionStatus(subscription.id, "reactivate"), "Assinatura reativada.")} size="sm" variant="outline">
                        <PlayCircle className="h-4 w-4" />
                        Reativar
                      </Button>
                      <Button onClick={() => void withRefresh(`sub:suspend:${subscription.id}`, () => setPlanSubscriptionStatus(subscription.id, "suspend"), "Assinatura suspensa.")} size="sm" variant="outline">
                        <PauseCircle className="h-4 w-4" />
                        Suspender
                      </Button>
                      <Button onClick={() => void withRefresh(`sub:extend:${subscription.id}`, () => extendPlanSubscription(subscription.id, 30), "Assinatura estendida.")} size="sm" variant="outline">
                        <Plus className="h-4 w-4" />
                        +30d
                      </Button>
                      <Button onClick={() => void withRefresh(`sub:cancel:${subscription.id}`, () => setPlanSubscriptionStatus(subscription.id, "cancel"), "Assinatura cancelada.")} size="sm" variant="outline">
                        <XCircle className="h-4 w-4" />
                        Cancelar
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      ) : null}

      {tab === "orders" && dashboard ? (
        <Card>
          <CardHeader>
            <CardTitle>Pedidos e interesses</CardTitle>
            <CardDescription>Pagamentos desligados registram interesse, sem QR Code ou cobranca falsa.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {dashboard.orders.map((order) => (
              <div className="grid gap-2 rounded-lg border border-zinc-800 bg-black/25 p-4 md:grid-cols-[1fr_auto] md:items-center" key={order.id}>
                <div>
                  <p className="font-mono text-sm text-white">{order.discordId}</p>
                  <p className="mt-1 text-sm text-zinc-500">{order.planSlug} / {new Date(order.createdAt).toLocaleString("pt-BR")}</p>
                  <p className="mt-1 text-xs text-zinc-600">{order.notes}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={order.status === "paid" ? "success" : "muted"}>{order.status}</Badge>
                  {canMarkOrderPaidForTest(order.status) ? (
                    <Button disabled={busyKey === `order:test-paid:${order.id}`} onClick={() => void withRefresh(`order:test-paid:${order.id}`, () => markPlanPaymentOrderPaidForTest(order.id), "Pagamento de teste concluído e assinatura ativada.")} size="sm" variant="outline">
                      {busyKey === `order:test-paid:${order.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      Pagar teste
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {tab === "payments" && dashboard ? (
        <PaymentSettingsForm
          busy={busyKey === "payments:save"}
          form={paymentForm}
          onChange={setPaymentForm}
          onSubmit={handlePaymentSubmit}
          settings={dashboard.paymentSettings}
        />
      ) : null}

      {tab === "logs" && dashboard ? (
        <Card>
          <CardHeader>
            <CardTitle>Auditoria</CardTitle>
            <CardDescription>Eventos administrativos do módulo Planos.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {dashboard.auditLogs.map((log) => (
              <div className="rounded-lg border border-zinc-800 bg-black/25 p-4" key={log.id}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="font-mono text-sm text-[#FFEA70]">{log.action}</p>
                  <span className="text-xs text-zinc-500">{new Date(log.createdAt).toLocaleString("pt-BR")}</span>
                </div>
                <p className="mt-2 text-sm text-zinc-400">{log.actorName ?? log.actorId ?? "sistema"} / {log.targetType}:{log.targetId ?? "global"}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function PlanEditor({ busy, form, onChange, onSubmit }: { busy: boolean; form: PlanFormState; onChange: (form: PlanFormState) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{form.id ? "Editar plano" : "Novo plano"}</CardTitle>
        <CardDescription>Os dados são persistidos no MongoDB.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-3" onSubmit={onSubmit}>
          <TextField label="Nome" value={form.name} onChange={(name) => onChange({ ...form, name })} />
          <TextField label="Slug" value={form.slug} onChange={(slug) => onChange({ ...form, slug })} />
          <TextField label="Descrição curta" value={form.shortDescription} onChange={(shortDescription) => onChange({ ...form, shortDescription })} />
          <TextArea label="Descrição" value={form.description} onChange={(description) => onChange({ ...form, description })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Preco mensal (R$)" value={form.priceInCents} onChange={(priceInCents) => onChange({ ...form, priceInCents })} />
            <TextField label="Ordem" value={form.order} onChange={(order) => onChange({ ...form, order })} />
            <TextField label="Limite de bots" value={form.botLimit} onChange={(botLimit) => onChange({ ...form, botLimit })} />
            <TextField label="Limite de servidores" value={form.guildLimit} onChange={(guildLimit) => onChange({ ...form, guildLimit })} />
            <TextField label="Validade em dias" value={form.validityDays} onChange={(validityDays) => onChange({ ...form, validityDays })} />
            <TextField label="Cor" value={form.color} onChange={(color) => onChange({ ...form, color })} />
          </div>
          <TextField label="Badge" value={form.badge} onChange={(badge) => onChange({ ...form, badge })} />
          <TextArea label="Entitlements por linha" value={form.entitlements} onChange={(entitlements) => onChange({ ...form, entitlements })} />
          <FlagGrid form={form} onChange={onChange} />
          <div className="flex gap-2">
            <Button disabled={busy} type="submit">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar plano
            </Button>
            <Button onClick={() => onChange(emptyPlanForm)} type="button" variant="outline">Limpar</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function PlanLevelSelector({ onChange, value }: { onChange: (value: PlanLevelFilter) => void; value: PlanLevelFilter }) {
  const options: Array<{ description: string; label: string; value: PlanLevelFilter }> = [
    { description: "Planos de entrada, com recursos essenciais.", label: "Básico", value: "basic" },
    { description: "Planos completos, com módulos e limites maiores.", label: "Avançado", value: "advanced" }
  ];

  return (
    <div className="grid gap-3 rounded-lg border border-zinc-800 bg-black/25 p-3 sm:grid-cols-2">
      {options.map((option) => (
        <button
          className={[
            "rounded-lg border p-4 text-left transition",
            value === option.value ? "border-[#FFD500]/50 bg-[#FFD500]/10" : "border-zinc-800 bg-zinc-950/60 hover:border-[#FFD500]/25"
          ].join(" ")}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          <span className="flex items-center gap-2 text-sm font-black text-white">
            <Tags className="h-4 w-4 text-[#FFD500]" />
            {option.label}
          </span>
          <span className="mt-1 block text-xs leading-5 text-zinc-500">{option.description}</span>
        </button>
      ))}
    </div>
  );
}

function BulkPriceEditor({
  busy,
  form,
  onChange,
  onSubmit,
  plans
}: {
  busy: boolean;
  form: Record<string, BulkPlanPriceState>;
  onChange: (value: Record<string, BulkPlanPriceState>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  plans: Plan[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Valores em lote</CardTitle>
        <CardDescription>Altere preço, promoção e status dos planos selecionados e salve tudo de uma vez.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-3" onSubmit={onSubmit}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-xs uppercase text-zinc-500">
                <tr className="border-b border-zinc-800">
                  <th className="py-2 pr-3">Plano</th>
                  <th className="px-3 py-2">Preço</th>
                  <th className="px-3 py-2">Promoção</th>
                  <th className="px-3 py-2">Ativo</th>
                  <th className="px-3 py-2">Público</th>
                  <th className="px-3 py-2">Compra</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => {
                  const row = form[plan.id] ?? planToBulkPriceState(plan);
                  const updateRow = (patch: Partial<BulkPlanPriceState>) => onChange({ ...form, [plan.id]: { ...row, ...patch } });

                  return (
                    <tr className="border-b border-zinc-900" key={plan.id}>
                      <td className="py-3 pr-3">
                        <p className="font-semibold text-white">{plan.name}</p>
                        <p className="mt-1 font-mono text-xs text-zinc-600">{plan.slug}</p>
                      </td>
                      <td className="px-3 py-3">
                        <input className="h-10 w-28 rounded-lg border border-zinc-800 bg-black px-3 text-white outline-none focus:border-[#FFD500]/50" onChange={(event) => updateRow({ priceInCents: event.target.value })} value={row.priceInCents} />
                      </td>
                      <td className="px-3 py-3">
                        <input className="h-10 w-28 rounded-lg border border-zinc-800 bg-black px-3 text-white outline-none focus:border-[#FFD500]/50" onChange={(event) => updateRow({ promotionalPriceInCents: event.target.value })} placeholder="Sem promo" value={row.promotionalPriceInCents} />
                      </td>
                      <td className="px-3 py-3"><input checked={row.isActive} onChange={(event) => updateRow({ isActive: event.target.checked })} type="checkbox" /></td>
                      <td className="px-3 py-3"><input checked={row.isPublic} onChange={(event) => updateRow({ isPublic: event.target.checked })} type="checkbox" /></td>
                      <td className="px-3 py-3"><input checked={row.isPurchasable} onChange={(event) => updateRow({ isPurchasable: event.target.checked })} type="checkbox" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Button disabled={busy || !plans.length} type="submit">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar valores em lote
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function PlanIncludedList({ features, plan }: { features: PlanFeature[]; plan: Plan }) {
  const included = plan.entitlements.filter((item) => item.enabled).slice(0, 8);

  return (
    <div className="rounded-lg border border-zinc-800 bg-black/25 p-3">
      <p className="text-sm font-semibold text-white">O que inclui no {planLevelLabel(plan).toLowerCase()}</p>
      <div className="mt-3 grid gap-2">
        {included.map((item) => (
          <div className="flex items-start gap-2 text-sm text-zinc-300" key={item.key}>
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#FFD500]" />
            <span>{featureLabel(item.key, features)}</span>
          </div>
        ))}
        {!included.length ? <span className="text-sm text-zinc-500">Sem recursos vinculados.</span> : null}
      </div>
    </div>
  );
}

function FeatureEditor({ busy, form, onChange, onSubmit }: { busy: boolean; form: FeatureFormState; onChange: (form: FeatureFormState) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{form.id ? "Editar feature" : "Nova feature"}</CardTitle>
        <CardDescription>Use chaves estaveis, ex.: discord.logs.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-3" onSubmit={onSubmit}>
          <TextField label="Chave" value={form.key} onChange={(key) => onChange({ ...form, key })} />
          <TextField label="Nome" value={form.name} onChange={(name) => onChange({ ...form, name })} />
          <label className="grid gap-1 text-sm">
            <span className="text-zinc-300">Categoria</span>
            <select className="h-11 rounded-lg border border-zinc-800 bg-black px-3 text-white outline-none focus:border-[#FFD500]/50" onChange={(event) => onChange({ ...form, category: event.target.value as FeatureFormState["category"] })} value={form.category}>
              {["streamer", "fivem", "discord", "security", "support", "billing"].map((category) => <option key={category} value={category}>{category}</option>)}
            </select>
          </label>
          <TextArea label="Descrição" value={form.description} onChange={(description) => onChange({ ...form, description })} />
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField label="Limite padrão" value={form.defaultLimit} onChange={(defaultLimit) => onChange({ ...form, defaultLimit })} />
            <TextField label="Unidade" value={form.unit} onChange={(unit) => onChange({ ...form, unit })} />
            <TextField label="Ordem" value={form.order} onChange={(order) => onChange({ ...form, order })} />
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input checked={form.isActive} onChange={(event) => onChange({ ...form, isActive: event.target.checked })} type="checkbox" />
            Ativa
          </label>
          <Button disabled={busy} type="submit">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar feature
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function ManualActivationForm({ activation, busy, onChange, onSubmit, plans }: { activation: { planId: string; userId: string; workspaceName: string }; busy: boolean; onChange: (value: { planId: string; userId: string; workspaceName: string }) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; plans: Plan[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Ativacao manual</CardTitle>
        <CardDescription>Cria assinatura, workspace e membro owner.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-3" onSubmit={onSubmit}>
          <label className="grid gap-1 text-sm">
            <span className="text-zinc-300">Plano</span>
            <select className="h-11 rounded-lg border border-zinc-800 bg-black px-3 text-white outline-none focus:border-[#FFD500]/50" onChange={(event) => onChange({ ...activation, planId: event.target.value })} value={activation.planId}>
              {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
            </select>
          </label>
          <TextField label="Discord ID do cliente" value={activation.userId} onChange={(userId) => onChange({ ...activation, userId })} />
          <TextField label="Nome do workspace" value={activation.workspaceName} onChange={(workspaceName) => onChange({ ...activation, workspaceName })} />
          <Button disabled={busy} type="submit">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Ativar assinatura
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

type PaymentFormState = {
  approvedRedirectUrl: string;
  botDashboardBaseUrl: string;
  botRegistrationUrl: string;
  cancelRedirectUrl: string;
  failureRedirectUrl: string;
  pendingRedirectUrl: string;
  plansPublicUrl: string;
  provider: "mercadopago" | "pagbank" | "stripe";
  successRedirectUrl: string;
  supportDiscordUrl: string;
};

function PaymentSettingsForm({ busy, form, onChange, onSubmit, settings }: { busy: boolean; form: PaymentFormState; onChange: (value: PaymentFormState) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; settings: DevPlansDashboard["paymentSettings"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Configuração de pagamentos</CardTitle>
        <CardDescription>Selecione um gateway ativo por vez. As credenciais continuam protegidas nas variaveis de ambiente.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid max-w-2xl gap-3" onSubmit={onSubmit}>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 text-sm text-zinc-300">
            Pagamentos {settings.enabled ? "ativos" : "desativados"} via {gatewayLabel(settings.provider)}. Credenciais: public key {settings.publicKey ? "detectada" : "ausente"}, token {settings.secretConfigured ? "detectado" : "ausente"}, webhook {settings.webhookSecretConfigured ? "configurado" : "pendente"}.
          </div>
          <label className="grid gap-1 text-sm">
            <span className="text-zinc-300">Gateway ativo</span>
            <select
              className="h-11 rounded-lg border border-zinc-800 bg-black px-3 text-white outline-none focus:border-[#FFD500]/50"
              onChange={(event) => onChange({ ...form, provider: event.target.value as PaymentFormState["provider"] })}
              value={form.provider}
            >
              <option value="mercadopago">Mercado Pago</option>
              <option value="pagbank">PagBank</option>
              <option value="stripe">Stripe</option>
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="URL após pagamento" value={form.successRedirectUrl} onChange={(successRedirectUrl) => onChange({ ...form, successRedirectUrl })} />
            <TextField label="URL pagamento aprovado" value={form.approvedRedirectUrl} onChange={(approvedRedirectUrl) => onChange({ ...form, approvedRedirectUrl })} />
            <TextField label="URL pagamento pendente" value={form.pendingRedirectUrl} onChange={(pendingRedirectUrl) => onChange({ ...form, pendingRedirectUrl })} />
            <TextField label="URL pagamento recusado" value={form.failureRedirectUrl} onChange={(failureRedirectUrl) => onChange({ ...form, failureRedirectUrl })} />
            <TextField label="URL cancelamento checkout" value={form.cancelRedirectUrl} onChange={(cancelRedirectUrl) => onChange({ ...form, cancelRedirectUrl })} />
            <TextField label="URL publica de planos" value={form.plansPublicUrl} onChange={(plansPublicUrl) => onChange({ ...form, plansPublicUrl })} />
            <TextField label="URL cadastro do bot" value={form.botRegistrationUrl} onChange={(botRegistrationUrl) => onChange({ ...form, botRegistrationUrl })} />
            <TextField label="URL base dashboards" value={form.botDashboardBaseUrl} onChange={(botDashboardBaseUrl) => onChange({ ...form, botDashboardBaseUrl })} />
            <TextField label="Discord de suporte" value={form.supportDiscordUrl} onChange={(supportDiscordUrl) => onChange({ ...form, supportDiscordUrl })} />
          </div>
          <Button disabled={busy} type="submit">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar pagamentos
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function gatewayLabel(provider: DevPlansDashboard["paymentSettings"]["provider"]) {
  if (provider === "pagbank") return "PagBank";
  if (provider === "stripe") return "Stripe";
  if (provider === "mercadopago") return "Mercado Pago";
  return "desativado";
}

function FlagGrid({ form, onChange }: { form: PlanFormState; onChange: (form: PlanFormState) => void }) {
  const flags: Array<[keyof Pick<PlanFormState, "isActive" | "isPublic" | "isPurchasable" | "isRecommended">, string]> = [
    ["isActive", "Ativo"],
    ["isPublic", "Publico"],
    ["isPurchasable", "Compravel"],
    ["isRecommended", "Recomendado"]
  ];

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {flags.map(([key, label]) => (
        <label className="flex items-center gap-2 text-sm text-zinc-300" key={key}>
          <input checked={Boolean(form[key])} onChange={(event) => onChange({ ...form, [key]: event.target.checked })} type="checkbox" />
          {label}
        </label>
      ))}
    </div>
  );
}

function TextField({ label, onChange, type = "text", value }: { label: string; onChange: (value: string) => void; type?: string; value: string }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-zinc-300">{label}</span>
      <input className="h-11 rounded-lg border border-zinc-800 bg-black px-3 text-white outline-none focus:border-[#FFD500]/50" onChange={(event) => onChange(event.target.value)} type={type} value={value} />
    </label>
  );
}

function TextArea({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="text-zinc-300">{label}</span>
      <textarea className="min-h-24 rounded-lg border border-zinc-800 bg-black px-3 py-2 text-white outline-none focus:border-[#FFD500]/50" onChange={(event) => onChange(event.target.value)} value={value} />
    </label>
  );
}

function MetricCard({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-[#FFD500]/25 bg-[#FFD500]/10 text-[#FFD500]">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-2xl font-black text-white">{value}</p>
          <p className="text-sm text-zinc-500">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function planToForm(plan: Plan): PlanFormState {
  return {
    badge: plan.badge ?? "",
    botLimit: String(plan.botLimit),
    color: plan.color,
    description: plan.description,
    entitlements: plan.entitlements.map((item) => item.key).join("\n"),
    guildLimit: String(plan.guildLimit),
    id: plan.id,
    isActive: plan.isActive,
    isPublic: plan.isPublic,
    isPurchasable: plan.isPurchasable,
    isRecommended: plan.isRecommended,
    name: plan.name,
    order: String(plan.order),
    priceInCents: centsToCurrencyInput(plan.priceInCents),
    shortDescription: plan.shortDescription,
    slug: plan.slug,
    validityDays: plan.validityDays ? String(plan.validityDays) : ""
  };
}

function planToBulkPriceState(plan: Plan): BulkPlanPriceState {
  return {
    isActive: plan.isActive,
    isPublic: plan.isPublic,
    isPurchasable: plan.isPurchasable,
    priceInCents: centsToCurrencyInput(plan.priceInCents),
    promotionalPriceInCents: plan.promotionalPriceInCents === null ? "" : centsToCurrencyInput(plan.promotionalPriceInCents)
  };
}

function featureToForm(feature: PlanFeature): FeatureFormState {
  return {
    category: feature.category,
    defaultLimit: feature.defaultLimit === null ? "" : String(feature.defaultLimit),
    description: feature.description,
    id: feature.id,
    isActive: feature.isActive,
    isPublic: feature.isPublic,
    key: feature.key,
    name: feature.name,
    order: String(feature.order),
    unit: feature.unit ?? ""
  };
}

function planPayloadFromForm(form: PlanFormState): SavePlanPayload {
  return {
    badge: form.badge || null,
    botLimit: Number(form.botLimit || 0),
    color: form.color,
    currency: "BRL",
    description: form.description,
    entitlements: form.entitlements.split(/\n|,/).map((key) => key.trim()).filter(Boolean).map((key) => ({
      enabled: true,
      key,
      limit: null,
      unit: null
    })),
    guildLimit: Number(form.guildLimit || 0),
    isActive: form.isActive,
    isPublic: form.isPublic,
    isPurchasable: form.isPurchasable,
    isRecommended: form.isRecommended,
    name: form.name,
    order: Number(form.order || 0),
    priceInCents: currencyInputToCents(form.priceInCents),
    shortDescription: form.shortDescription,
    slug: form.slug || undefined,
    validityDays: form.validityDays ? Number(form.validityDays) : null
  };
}

function planPayloadFromPlan(plan: Plan, form: BulkPlanPriceState): SavePlanPayload {
  return {
    badge: plan.badge,
    billingCycle: plan.billingCycle,
    botLimit: plan.botLimit,
    buttonText: plan.buttonText,
    color: plan.color,
    currency: plan.currency,
    description: plan.description,
    entitlements: plan.entitlements,
    guildLimit: plan.guildLimit,
    icon: plan.icon,
    imageUrl: plan.imageUrl,
    isActive: form.isActive,
    isPublic: form.isPublic,
    isPurchasable: form.isPurchasable,
    isRecommended: plan.isRecommended,
    name: plan.name,
    order: plan.order,
    priceInCents: currencyInputToCents(form.priceInCents),
    promotionalPriceInCents: form.promotionalPriceInCents.trim() ? currencyInputToCents(form.promotionalPriceInCents) : null,
    shortDescription: plan.shortDescription,
    slug: plan.slug,
    validityDays: plan.validityDays
  };
}

function hasBulkPriceChanges(plan: Plan, form?: BulkPlanPriceState) {
  if (!form) return false;
  return currencyInputToCents(form.priceInCents) !== plan.priceInCents
    || (form.promotionalPriceInCents.trim() ? currencyInputToCents(form.promotionalPriceInCents) : null) !== plan.promotionalPriceInCents
    || form.isActive !== plan.isActive
    || form.isPublic !== plan.isPublic
    || form.isPurchasable !== plan.isPurchasable;
}

function planLevel(plan: Plan): PlanLevelFilter {
  const text = normalizePlanText([plan.name, plan.slug, plan.badge, plan.shortDescription, plan.description].filter(Boolean).join(" "));
  if (/\b(avancado|completo|completa|premium|profissional|pro|ultimate|enterprise)\b/.test(text)) return "advanced";
  return "basic";
}

function planLevelLabel(plan: Plan) {
  return planLevel(plan) === "advanced" ? "Avançado" : "Básico";
}

function defaultPlanDescription(plan: Plan) {
  return planLevel(plan) === "advanced"
    ? "Plano avançado com recursos completos, mais limite e automações para operação maior."
    : "Plano básico com recursos essenciais para iniciar e manter o bot funcionando.";
}

function featureLabel(key: string, features: PlanFeature[]) {
  const feature = features.find((item) => item.key === key);
  return feature?.name || key.replace(/[._-]+/g, " ");
}

function normalizePlanText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function centsToCurrencyInput(value: number) {
  return (Math.max(0, Math.round(value)) / 100).toFixed(2).replace(".", ",");
}

function currencyInputToCents(value: string) {
  const cleaned = value.replace(/[^\d,.-]/g, "");
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100)) : 0;
}

function canMarkOrderPaidForTest(status: string) {
  return status === "pending" || status === "interest_registered";
}

function readError(error: unknown, fallback: string) {
  const response = error as { response?: { data?: { message?: string } } };
  return response.response?.data?.message ?? fallback;
}
