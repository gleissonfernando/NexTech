import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Save, Send, Trash2 } from "lucide-react";
import { getManualPaymentsDashboard, publishManualPaymentPanel, saveManualPaymentSettings } from "../../lib/api";
import type { DashboardGuild, ManualPaymentOrder, ManualPaymentService, ManualPaymentSettings, SaveManualPaymentSettingsPayload } from "../../types";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";

type Props = {
  botId: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
};

const defaultDraft: SaveManualPaymentSettingsPayload = {
  approveRoleIds: [],
  enabled: false,
  finalizeRoleIds: [],
  maxPaymentMinutes: 60,
  paymentInstructions: "Envie o comprovante no canal de pagamento e aguarde a aprovação da equipe.",
  pixKeyType: "random",
  services: []
};

function emptyService(order: number): ManualPaymentService {
  return {
    active: true,
    amount: 0,
    bannerUrl: null,
    createServiceChannel: true,
    customText: null,
    description: "",
    id: crypto.randomUUID(),
    manualApproval: true,
    name: "Novo serviço",
    order,
    serviceType: "service"
  };
}

export function ManualPaymentsPanel({ botId, canManage, guild }: Props) {
  const [settings, setSettings] = useState<ManualPaymentSettings | null>(null);
  const [draft, setDraft] = useState<SaveManualPaymentSettingsPayload>(defaultDraft);
  const [orders, setOrders] = useState<ManualPaymentOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const services = useMemo(() => [...(draft.services ?? [])].sort((a, b) => a.order - b.order), [draft.services]);

  useEffect(() => {
    if (!botId || !guild) return;
    setLoading(true);
    getManualPaymentsDashboard(botId, guild.id)
      .then((data) => {
        setSettings(data.settings);
        setDraft(toPayload(data.settings));
        setOrders(data.orders);
      })
      .catch((error) => setMessage(readError(error, "Não foi possível carregar o pagamento manual.")))
      .finally(() => setLoading(false));
  }, [botId, guild]);

  function patch(patchValue: SaveManualPaymentSettingsPayload) {
    setDraft((current) => ({ ...current, ...patchValue }));
  }

  function patchService(serviceId: string, patchValue: Partial<ManualPaymentService>) {
    patch({ services: (draft.services ?? []).map((service) => service.id === serviceId ? { ...service, ...patchValue } : service) });
  }

  function moveService(serviceId: string, direction: -1 | 1) {
    const next = [...services];
    const index = next.findIndex((service) => service.id === serviceId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= next.length) return;
    const current = next[index];
    const replacement = next[target];
    if (!current || !replacement) return;
    next[index] = replacement;
    next[target] = current;
    patch({ services: next.map((service, order) => ({ ...service, order })) });
  }

  async function save() {
    if (!botId || !guild) return;
    setSaving(true);
    try {
      const saved = await saveManualPaymentSettings(botId, guild.id, draft);
      setSettings(saved);
      setDraft(toPayload(saved));
      setMessage("Configurações do pagamento manual salvas.");
    } catch (error) {
      setMessage(readError(error, "Não foi possível salvar o pagamento manual."));
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!botId || !guild) return;
    setSaving(true);
    try {
      await saveManualPaymentSettings(botId, guild.id, draft);
      const saved = await publishManualPaymentPanel(botId, guild.id);
      setSettings(saved);
      setDraft(toPayload(saved));
      setMessage("Publicação enviada ao bot.");
    } catch (error) {
      setMessage(readError(error, "Não foi possível publicar o painel."));
    } finally {
      setSaving(false);
    }
  }

  if (!botId || !guild) {
    return <Card><CardContent className="p-6 text-sm text-zinc-500">Selecione um bot e servidor para configurar o pagamento manual.</CardContent></Card>;
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <CardTitle>Pagamento Manual</CardTitle>
            <CardDescription>{loading ? "Carregando..." : "Pix manual, comprovantes, canais temporarios e aprovação humana. Não confirma automaticamente."}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 md:grid-cols-2">
              <Toggle checked={Boolean(draft.enabled)} disabled={!canManage} label="Módulo ativo" onChange={(checked) => patch({ enabled: checked })} />
              <Field disabled={!canManage} label="Canal do painel de vendas" onChange={(value) => patch({ salePanelChannelId: value || null })} value={draft.salePanelChannelId ?? ""} />
              <Field disabled={!canManage} label="Categoria de pagamento" onChange={(value) => patch({ paymentCategoryId: value || null })} value={draft.paymentCategoryId ?? ""} />
              <Field disabled={!canManage} label="Categoria de atendimento" onChange={(value) => patch({ attendanceCategoryId: value || null })} value={draft.attendanceCategoryId ?? ""} />
              <Field disabled={!canManage} label="Canal de logs" onChange={(value) => patch({ logChannelId: value || null })} value={draft.logChannelId ?? ""} />
              <Field disabled={!canManage} label="Canal de suporte" onChange={(value) => patch({ supportPanelChannelId: value || null })} value={draft.supportPanelChannelId ?? ""} />
              <Field disabled={!canManage} label="Cargos que aprovam" onChange={(value) => patch({ approveRoleIds: splitIds(value) })} value={(draft.approveRoleIds ?? []).join(", ")} />
              <Field disabled={!canManage} label="Cargos que finalizam" onChange={(value) => patch({ finalizeRoleIds: splitIds(value) })} value={(draft.finalizeRoleIds ?? []).join(", ")} />
              <Field disabled={!canManage} label="Tempo limite em minutos" onChange={(value) => patch({ maxPaymentMinutes: Number(value) || 1 })} type="number" value={String(draft.maxPaymentMinutes ?? 60)} />
              <Field disabled={!canManage} label="Banner do painel" onChange={(value) => patch({ bannerUrl: value || null })} value={draft.bannerUrl ?? ""} />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Field disabled={!canManage} label="Chave Pix" onChange={(value) => patch({ pixKey: value || null })} value={draft.pixKey ?? ""} />
              <Select disabled={!canManage} label="Tipo da chave" onChange={(value) => patch({ pixKeyType: value as ManualPaymentSettings["pixKeyType"] })} options={["cpf", "cnpj", "email", "phone", "random"]} value={draft.pixKeyType ?? "random"} />
              <Field disabled={!canManage} label="Nome do recebedor" onChange={(value) => patch({ receiverName: value || null })} value={draft.receiverName ?? ""} />
              <Field disabled={!canManage} label="Banco" onChange={(value) => patch({ receiverBank: value || null })} value={draft.receiverBank ?? ""} />
              <Field disabled={!canManage} label="URL do QR Code" onChange={(value) => patch({ pixQrCodeUrl: value || null })} value={draft.pixQrCodeUrl ?? ""} />
            </div>

            <Textarea disabled={!canManage} label="Instrucoes de pagamento" onChange={(value) => patch({ paymentInstructions: value })} value={draft.paymentInstructions ?? ""} />

            <div className="flex flex-wrap gap-3">
              <Button disabled={!canManage || saving} onClick={() => void save()} type="button"><Save className="mr-2 h-4 w-4" />Salvar</Button>
              <Button disabled={!canManage || saving} onClick={() => void publish()} type="button" variant="secondary"><Send className="mr-2 h-4 w-4" />Publicar painel</Button>
            </div>
            {message ? <p className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">{message}</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Resumo</CardTitle>
            <CardDescription>{settings?.salePanelMessageId ? `Painel ${settings.salePanelMessageId}` : "Painel ainda não publicado"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-zinc-400">
            <Summary label="Servicos ativos" value={String(services.filter((service) => service.active).length)} />
            <Summary label="Pedidos recentes" value={String(orders.length)} />
            <Summary label="Aguardando equipe" value={String(orders.filter((order) => order.status === "WAITING_STAFF_APPROVAL").length)} />
            <Summary label="Em atendimento" value={String(orders.filter((order) => order.status === "IN_PROGRESS" || order.status === "WAITING_CUSTOMER" || order.status === "DELIVERED").length)} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Catalogo de serviços</CardTitle>
              <CardDescription>Itens que aparecem no painel de venda do Discord.</CardDescription>
            </div>
            <Button disabled={!canManage} onClick={() => patch({ services: [...(draft.services ?? []), emptyService(draft.services?.length ?? 0)] })} size="sm" type="button">
              <Plus className="mr-2 h-4 w-4" />Adicionar
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {services.map((service) => (
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3" key={service.id}>
              <div className="grid gap-3 lg:grid-cols-[1fr_140px_160px_auto]">
                <Field disabled={!canManage} label="Nome" onChange={(value) => patchService(service.id, { name: value })} value={service.name} />
                <Field disabled={!canManage} label="Valor" onChange={(value) => patchService(service.id, { amount: Number(value) || 0 })} type="number" value={String(service.amount)} />
                <Select disabled={!canManage} label="Tipo" onChange={(value) => patchService(service.id, { serviceType: value as ManualPaymentService["serviceType"] })} options={["product", "service", "subscription", "custom"]} value={service.serviceType} />
                <div className="flex items-end gap-2">
                  <IconButton disabled={!canManage} icon={ArrowUp} onClick={() => moveService(service.id, -1)} />
                  <IconButton disabled={!canManage} icon={ArrowDown} onClick={() => moveService(service.id, 1)} />
                  <IconButton disabled={!canManage} icon={Trash2} onClick={() => patch({ services: services.filter((item) => item.id !== service.id).map((item, order) => ({ ...item, order })) })} />
                </div>
              </div>
              <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr_150px_150px_120px]">
                <Field disabled={!canManage} label="Descrição" onChange={(value) => patchService(service.id, { description: value || null })} value={service.description ?? ""} />
                <Field disabled={!canManage} label="Banner" onChange={(value) => patchService(service.id, { bannerUrl: value || null })} value={service.bannerUrl ?? ""} />
                <Toggle checked={service.active} disabled={!canManage} label="Ativo" onChange={(checked) => patchService(service.id, { active: checked })} />
                <Toggle checked={service.createServiceChannel} disabled={!canManage} label="Criar canal" onChange={(checked) => patchService(service.id, { createServiceChannel: checked })} />
                <Toggle checked={service.manualApproval} disabled={!canManage} label="Aprovar" onChange={(checked) => patchService(service.id, { manualApproval: checked })} />
              </div>
              <Textarea disabled={!canManage} label="Texto especifico do serviço" onChange={(value) => patchService(service.id, { customText: value || null })} value={service.customText ?? ""} />
            </div>
          ))}
          {services.length === 0 ? <p className="text-sm text-zinc-500">Nenhum serviço cadastrado.</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pedidos recentes</CardTitle>
          <CardDescription>Últimas compras e estados persistidos.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {orders.slice(0, 12).map((order) => (
            <div className="grid gap-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-400 md:grid-cols-[110px_1fr_130px_150px]" key={order.id}>
              <span className="font-semibold text-white">#{String(order.orderNumber).padStart(3, "0")}</span>
              <span>{order.serviceName} por {order.username ?? order.userId}</span>
              <span>{money(order.amount)}</span>
              <span>{statusLabel(order.status)}</span>
            </div>
          ))}
          {orders.length === 0 ? <p className="text-sm text-zinc-500">Nenhum pedido registrado.</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ disabled, label, onChange, type = "text", value }: { disabled?: boolean; label: string; onChange: (value: string) => void; type?: string; value: string }) {
  return <label className="block text-xs font-medium text-zinc-500">{label}<input className="mt-1 h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-[#FFD500]/50" disabled={disabled} onChange={(event) => onChange(event.target.value)} type={type} value={value} /></label>;
}

function Textarea({ disabled, label, onChange, value }: { disabled?: boolean; label: string; onChange: (value: string) => void; value: string }) {
  return <label className="block text-xs font-medium text-zinc-500">{label}<textarea className="mt-1 min-h-24 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-[#FFD500]/50" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value} /></label>;
}

function Select({ disabled, label, onChange, options, value }: { disabled?: boolean; label: string; onChange: (value: string) => void; options: string[]; value: string }) {
  return <label className="block text-xs font-medium text-zinc-500">{label}<select className="mt-1 h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-[#FFD500]/50" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}

function Toggle({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) {
  return <div className="flex h-10 items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-3"><span className="text-xs text-zinc-400">{label}</span><Switch checked={checked} disabled={disabled} onCheckedChange={onChange} /></div>;
}

function IconButton({ disabled, icon: Icon, onClick }: { disabled?: boolean; icon: typeof ArrowUp; onClick: () => void }) {
  return <button className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-800 text-zinc-400 transition hover:border-[#FFD500]/40 hover:text-white disabled:opacity-50" disabled={disabled} onClick={onClick} type="button"><Icon className="h-4 w-4" /></button>;
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2"><span>{label}</span><strong className="text-white">{value}</strong></div>;
}

function toPayload(settings: ManualPaymentSettings): SaveManualPaymentSettingsPayload {
  const { botId: _botId, guildId: _guildId, id: _id, salePanelMessageId: _messageId, updatedAt: _updatedAt, updatedBy: _updatedBy, ...payload } = settings;
  return payload;
}

function splitIds(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { currency: "BRL", style: "currency" }).format(value);
}

function statusLabel(status: ManualPaymentOrder["status"]) {
  return {
    APPROVED: "Aprovado",
    CANCELLED_BY_CUSTOMER: "Cancelado pelo cliente",
    CANCELLED_BY_STAFF: "Cancelado pela equipe",
    DELIVERED: "Entregue",
    FINISHED: "Finalizado",
    IN_PROGRESS: "Em atendimento",
    PENDING_PAYMENT: "Aguardando pagamento",
    REJECTED: "Recusado",
    WAITING_CUSTOMER: "Aguardando cliente",
    WAITING_STAFF_APPROVAL: "Aguardando equipe"
  }[status];
}

function readError(error: unknown, fallback: string) {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message ?? fallback;
  }
  return error instanceof Error ? error.message : fallback;
}
