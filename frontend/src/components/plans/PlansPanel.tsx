import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Bot, CheckCircle2, CreditCard, KeyRound, Loader2, PackageCheck, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import {
  createPlanCheckoutInterest,
  createWorkspaceBot,
  deleteWorkspaceBot,
  getCustomerPlansDashboard,
  validateWorkspaceBot
} from "../../lib/api";
import type { CustomerPlansDashboard, Plan, PlanWorkspace } from "../../types";

type BotForm = {
  botClientId: string;
  botName: string;
  token: string;
};

const emptyBotForm: BotForm = {
  botClientId: "",
  botName: "",
  token: ""
};

export function PlansPanel() {
  const [dashboard, setDashboard] = useState<CustomerPlansDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [botForm, setBotForm] = useState<BotForm>(emptyBotForm);

  async function load() {
    setLoading(true);
    setError(null);

    try {
      const next = await getCustomerPlansDashboard();
      setDashboard(next);
      setSelectedWorkspaceId((current) => current ?? next.workspaces[0]?.id ?? null);
    } catch (loadError) {
      setError(readError(loadError, "Nao foi possivel carregar seus planos."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const activeSubscriptions = dashboard?.subscriptions.filter((subscription) => subscription.status === "active") ?? [];
  const selectedWorkspace = dashboard?.workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? dashboard?.workspaces[0] ?? null;
  const selectedSubscription = selectedWorkspace
    ? activeSubscriptions.find((subscription) => subscription.workspaceId === selectedWorkspace.id) ?? null
    : null;
  const selectedPlan = selectedSubscription?.plan
    ? dashboard?.plans.find((plan) => plan.id === selectedSubscription.planId) ?? null
    : null;
  const latestOrder = dashboard?.orders[0] ?? null;
  const entitlements = selectedPlan?.entitlements ?? [];
  const bots = selectedWorkspace?.bots ?? [];
  const botLimit = selectedSubscription?.botLimit ?? selectedPlan?.botLimit ?? 0;

  async function handleInterest(plan: Plan) {
    setBusyKey(`plan:${plan.slug}`);
    setNotice(null);

    try {
      const result = await createPlanCheckoutInterest(plan.slug);
      setNotice(result.payment.message || "Interesse registrado.");
      if (result.order.checkoutUrl) {
        window.location.href = result.order.checkoutUrl;
        return;
      }
      if (result.order.pixCode || result.order.qrCode || result.order.providerOrderId) {
        window.location.href = `/pagamento/pix/${encodeURIComponent(result.order.id)}`;
        return;
      }
      await load();
    } catch (requestError) {
      setError(readError(requestError, "Nao foi possivel registrar interesse no plano."));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleBotSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedWorkspace) return;

    setBusyKey("bot:create");
    setNotice(null);

    try {
      await createWorkspaceBot(selectedWorkspace.id, botForm);
      setBotForm(emptyBotForm);
      setNotice("Bot cadastrado com token protegido. O token nao fica visivel na dashboard.");
      await load();
    } catch (requestError) {
      setError(readError(requestError, "Nao foi possivel cadastrar o bot."));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleValidateBot(credentialId: string) {
    if (!selectedWorkspace) return;

    setBusyKey(`bot:validate:${credentialId}`);
    try {
      await validateWorkspaceBot(selectedWorkspace.id, credentialId);
      await load();
    } catch (requestError) {
      setError(readError(requestError, "Nao foi possivel validar este bot."));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleDeleteBot(credentialId: string) {
    if (!selectedWorkspace) return;

    setBusyKey(`bot:delete:${credentialId}`);
    try {
      await deleteWorkspaceBot(selectedWorkspace.id, credentialId);
      await load();
    } catch (requestError) {
      setError(readError(requestError, "Nao foi possivel remover este bot."));
    } finally {
      setBusyKey(null);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex min-h-64 items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-[#FFD500]" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-lg border border-[#FFD500]/20 bg-[#101013]/95 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.28)] lg:flex-row lg:items-center lg:justify-between">
        <div>
          <Badge className="border-[#FFD500]/30 bg-[#FFD500]/10 text-[#FFEA70]" variant="muted">Planos</Badge>
          <h2 className="mt-3 text-2xl font-black text-white">Planos e workspaces</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
            Consulte planos liberados, registre interesse e gerencie os bots vinculados aos seus workspaces ativos.
          </p>
        </div>
        <Button onClick={() => void load()} variant="outline">
          <RefreshCw className="h-4 w-4" />
          Atualizar
        </Button>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>
      ) : null}

      {notice ? (
        <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{notice}</div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <MetricCard icon={PackageCheck} label="Assinaturas ativas" value={String(activeSubscriptions.length)} />
        <MetricCard icon={Bot} label="Workspaces" value={String(dashboard?.workspaces.length ?? 0)} />
        <MetricCard icon={CreditCard} label="Ultimo pedido" value={latestOrder ? statusLabel(latestOrder.status) : "Nenhum"} />
      </div>

      <section className="grid gap-4 xl:grid-cols-3">
        {(dashboard?.plans ?? []).map((plan) => (
          <PlanCard
            busy={busyKey === `plan:${plan.slug}`}
            key={plan.id}
            onInterest={() => void handleInterest(plan)}
            plan={plan}
          />
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-[#FFD500]" />
              Workspaces
            </CardTitle>
            <CardDescription>Ambientes liberados manualmente pelo DEV.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(dashboard?.workspaces ?? []).length ? dashboard?.workspaces.map((workspace) => (
              <WorkspaceButton
                key={workspace.id}
                onClick={() => setSelectedWorkspaceId(workspace.id)}
                selected={selectedWorkspace?.id === workspace.id}
                workspace={workspace}
              />
            )) : (
              <p className="rounded-lg border border-zinc-800 bg-black/25 px-4 py-6 text-center text-sm text-zinc-500">
                Nenhum workspace ativo ainda. Registre interesse em um plano para o DEV liberar sua assinatura.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-[#FFD500]" />
              Bots do workspace
            </CardTitle>
            <CardDescription>
              {selectedWorkspace ? `${selectedWorkspace.name} - ${bots.length}/${botLimit} bots cadastrados.` : "Selecione um workspace ativo."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {selectedWorkspace ? (
              <>
                <div className="grid gap-3">
                  {bots.map((bot) => (
                    <div className="flex flex-col gap-3 rounded-lg border border-zinc-800 bg-black/25 p-4 sm:flex-row sm:items-center sm:justify-between" key={bot.id}>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-white">{bot.botName}</p>
                        <p className="mt-1 font-mono text-xs text-zinc-500">client_id: {bot.botClientId}</p>
                        <p className="mt-1 text-xs text-zinc-500">fingerprint: {bot.tokenFingerprint.slice(0, 12)}...</p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Badge variant={bot.status === "validated" ? "success" : "muted"}>{bot.status === "validated" ? "Validado" : "Armazenado"}</Badge>
                        <Button disabled={busyKey === `bot:validate:${bot.id}`} onClick={() => void handleValidateBot(bot.id)} size="sm" variant="outline">
                          {busyKey === `bot:validate:${bot.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                          Validar
                        </Button>
                        <Button disabled={busyKey === `bot:delete:${bot.id}`} onClick={() => void handleDeleteBot(bot.id)} size="sm" variant="outline">
                          <Trash2 className="h-4 w-4" />
                          Remover
                        </Button>
                      </div>
                    </div>
                  ))}
                  {!bots.length ? <p className="rounded-lg border border-zinc-800 bg-black/25 px-4 py-5 text-sm text-zinc-500">Nenhum bot cadastrado neste workspace.</p> : null}
                </div>

                <form className="grid gap-3 rounded-lg border border-[#FFD500]/20 bg-[#0b0b0b]/65 p-4" onSubmit={handleBotSubmit}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1 text-sm">
                      <span className="text-zinc-300">Nome do bot</span>
                      <input className="h-11 rounded-lg border border-zinc-800 bg-black px-3 text-white outline-none focus:border-[#FFD500]/50" onChange={(event) => setBotForm((current) => ({ ...current, botName: event.target.value }))} value={botForm.botName} />
                    </label>
                    <label className="grid gap-1 text-sm">
                      <span className="text-zinc-300">Client ID</span>
                      <input className="h-11 rounded-lg border border-zinc-800 bg-black px-3 text-white outline-none focus:border-[#FFD500]/50" onChange={(event) => setBotForm((current) => ({ ...current, botClientId: event.target.value }))} value={botForm.botClientId} />
                    </label>
                  </div>
                  <label className="grid gap-1 text-sm">
                    <span className="text-zinc-300">Token do bot</span>
                    <input className="h-11 rounded-lg border border-zinc-800 bg-black px-3 text-white outline-none focus:border-[#FFD500]/50" onChange={(event) => setBotForm((current) => ({ ...current, token: event.target.value }))} type="password" value={botForm.token} />
                  </label>
                  <Button disabled={busyKey === "bot:create" || bots.length >= botLimit} type="submit">
                    {busyKey === "bot:create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                    Cadastrar bot com token protegido
                  </Button>
                </form>

                <div className="rounded-lg border border-zinc-800 bg-black/25 p-4">
                  <p className="text-sm font-semibold text-white">Entitlements do plano</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {entitlements.map((item) => (
                      <Badge key={item.key} variant={item.enabled ? "success" : "muted"}>{item.key}</Badge>
                    ))}
                    {!entitlements.length ? <span className="text-sm text-zinc-500">Sem features configuradas.</span> : null}
                  </div>
                </div>
              </>
            ) : (
              <p className="rounded-lg border border-zinc-800 bg-black/25 px-4 py-8 text-center text-sm text-zinc-500">Nenhum workspace selecionado.</p>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function PlanCard({ busy, onInterest, plan }: { busy: boolean; onInterest: () => void; plan: Plan }) {
  const visibleEntitlements = plan.entitlements.filter((item) => item.enabled).slice(0, 5);

  return (
    <Card className={plan.isRecommended ? "border-[#FFD500]/45 shadow-[0_0_30px_rgba(255,213,0,0.12)]" : ""}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{plan.name}</CardTitle>
            <CardDescription>{plan.shortDescription || plan.description}</CardDescription>
          </div>
          {plan.badge ? <Badge className="shrink-0 border-[#FFD500]/30 bg-[#FFD500]/10 text-[#FFEA70]" variant="muted">{plan.badge}</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="flex min-h-[20rem] flex-col gap-4">
        <div>
          <p className="text-3xl font-black text-white">{formatPrice(plan)}</p>
          <p className="mt-1 text-xs text-zinc-500">{plan.botLimit} bot(s) / {plan.guildLimit} servidor(es)</p>
        </div>
        <div className="grid gap-2">
          {visibleEntitlements.map((item) => (
            <div className="flex items-center gap-2 text-sm text-zinc-300" key={item.key}>
              <CheckCircle2 className="h-4 w-4 text-[#FFD500]" />
              <span>{item.key}</span>
            </div>
          ))}
        </div>
        <Button className="mt-auto" disabled={busy} onClick={onInterest} variant={plan.isRecommended ? "default" : "outline"}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
          {plan.isPurchasable ? plan.buttonText : "Registrar interesse"}
        </Button>
      </CardContent>
    </Card>
  );
}

function WorkspaceButton({ onClick, selected, workspace }: { onClick: () => void; selected: boolean; workspace: PlanWorkspace }) {
  return (
    <button
      className={[
        "w-full rounded-lg border px-4 py-3 text-left transition",
        selected ? "border-[#FFD500]/45 bg-[#FFD500]/10" : "border-zinc-800 bg-black/25 hover:border-[#FFD500]/25"
      ].join(" ")}
      onClick={onClick}
      type="button"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-semibold text-white">{workspace.name}</p>
        <Badge variant={workspace.status === "active" ? "success" : "muted"}>{workspace.status}</Badge>
      </div>
      <p className="mt-1 font-mono text-xs text-zinc-500">{workspace.slug}</p>
    </button>
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

function formatPrice(plan: Plan) {
  const value = plan.promotionalPriceInCents ?? plan.priceInCents;
  if (value <= 0) return "Sob consulta";

  return new Intl.NumberFormat("pt-BR", {
    currency: plan.currency,
    style: "currency"
  }).format(value / 100);
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    cancelled: "Cancelado",
    expired: "Expirado",
    failed: "Falhou",
    interest_registered: "Interesse",
    paid: "Pago",
    pending: "Pendente"
  };
  return labels[status] ?? status;
}

function readError(error: unknown, fallback: string) {
  const response = error as { response?: { data?: { message?: string } } };
  return response.response?.data?.message ?? fallback;
}
