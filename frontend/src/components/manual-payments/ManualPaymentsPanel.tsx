import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, RefreshCw, Save, Send, Trash2, Upload } from "lucide-react";
import { API_URL, getGuildLiveOptions, getManualPaymentsDashboard, publishManualPaymentPanel, saveManualPaymentSettings, uploadManualPaymentQrCode } from "../../lib/api";
import { createDashboardSocket } from "../../lib/socket";
import type {
  DashboardGuild,
  GuildCategoryOption,
  GuildChannelOption,
  GuildRoleOption,
  ManualPaymentOrder,
  ManualPaymentService,
  ManualPaymentSettings,
  SaveManualPaymentSettingsPayload
} from "../../types";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";

type Props = {
  botId: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
};

const defaultDraft: SaveManualPaymentSettingsPayload = {
  allowedReceiptImageFormats: ["png", "jpg", "jpeg", "webp"],
  allowReceiptPdf: true,
  approveRoleIds: [],
  autoReceiptDetectionEnabled: true,
  enabled: false,
  finalizeRoleIds: [],
  maxPaymentMinutes: 60,
  approvalMessage: "Seu pagamento foi aprovado. Seu pedido foi liberado para atendimento.",
  customerReceiptMessage: "Recebemos o seu comprovante de pagamento com sucesso. Seu pagamento foi encaminhado para análise da nossa equipe.",
  paymentInstructions: "Envie uma foto ou imagem do comprovante de pagamento.",
  pixKeyType: "random",
  receiptChannelId: null,
  rejectionMessage: "Seu pagamento foi recusado. Motivo: {reason}",
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
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [categories, setCategories] = useState<GuildCategoryOption[]>([]);
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingQr, setUploadingQr] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const services = useMemo(() => [...(draft.services ?? [])].sort((a, b) => a.order - b.order), [draft.services]);
  const todayOrders = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return orders.filter((order) => order.createdAt.slice(0, 10) === today);
  }, [orders]);

  useEffect(() => {
    if (!botId || !guild) return;
    setLoading(true);
    Promise.all([
      getManualPaymentsDashboard(botId, guild.id),
      getGuildLiveOptions(guild.id, botId)
    ])
      .then(([data, options]) => {
        setSettings(data.settings);
        setDraft(toPayload(data.settings));
        setOrders(data.orders);
        setChannels(options.channels ?? []);
        setCategories(options.categories ?? []);
        setRoles(options.roles ?? []);
      })
      .catch((error) => setMessage(readError(error, "Não foi possível carregar o pagamento manual.")))
      .finally(() => setLoading(false));
  }, [botId, guild]);

  useEffect(() => {
    if (!botId || !guild) return;
    const socket = createDashboardSocket();
    const refresh = (payload: { botId?: string | null; guildId: string }) => {
      if (payload.guildId !== guild.id || (payload.botId ?? null) !== (botId ?? null)) return;
      void getManualPaymentsDashboard(botId, guild.id).then((data) => {
        setSettings(data.settings);
        setDraft(toPayload(data.settings));
        setOrders(data.orders);
      }).catch(() => null);
    };
    socket.on("manual-payments:updated", refresh);
    return () => {
      socket.off("manual-payments:updated", refresh);
      socket.disconnect();
    };
  }, [botId, guild?.id]);

  function patch(patchValue: SaveManualPaymentSettingsPayload) {
    setDraft((current) => ({ ...current, ...patchValue }));
  }

  function patchService(serviceId: string, patchValue: Partial<ManualPaymentService>) {
    patch({ services: (draft.services ?? []).map((service) => service.id === serviceId ? { ...service, ...patchValue } : service) });
  }

  async function refreshOptions() {
    if (!botId || !guild) return;
    setLoading(true);
    try {
      const options = await getGuildLiveOptions(guild.id, botId, true);
      setChannels(options.channels ?? []);
      setCategories(options.categories ?? []);
      setRoles(options.roles ?? []);
      setMessage("Canais, categorias e cargos atualizados.");
    } catch (error) {
      setMessage(readError(error, "Não foi possível atualizar canais, categorias e cargos."));
    } finally {
      setLoading(false);
    }
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

  async function uploadQrCode(file: File | null | undefined) {
    if (!botId || !guild || !file) return;
    setUploadingQr(true);
    try {
      const saved = await uploadManualPaymentQrCode(botId, guild.id, file);
      setSettings(saved);
      setDraft((current) => ({ ...current, pixQrCodeUrl: saved.pixQrCodeUrl }));
      setMessage("QR Code enviado e salvo com armazenamento persistente.");
    } catch (error) {
      setMessage(readError(error, "Não foi possível enviar o QR Code."));
    } finally {
      setUploadingQr(false);
    }
  }

  async function removeQrCode() {
    if (!botId || !guild) return;
    setSaving(true);
    try {
      const saved = await saveManualPaymentSettings(botId, guild.id, { ...draft, pixQrCodeUrl: null });
      setSettings(saved);
      setDraft(toPayload(saved));
      setMessage("QR Code removido.");
    } catch (error) {
      setMessage(readError(error, "Não foi possível remover o QR Code."));
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
            <CardTitle>Sistema de Vendas Manuais</CardTitle>
            <CardDescription>{loading ? "Carregando..." : "Modo dinâmico: painel Components V2, ticket temporário, aprovação humana e projeto/atendimento após aprovação."}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 md:grid-cols-2">
              <Toggle checked={Boolean(draft.enabled)} disabled={!canManage} label="Módulo ativo" onChange={(checked) => patch({ enabled: checked })} />
              <ChannelSelect channels={channels} disabled={!canManage} label="Canal do painel de vendas" onChange={(value) => patch({ salePanelChannelId: value })} value={draft.salePanelChannelId ?? null} />
              <CategorySelect categories={categories} disabled={!canManage} label="Categoria dos tickets de compra" onChange={(value) => patch({ paymentCategoryId: value })} value={draft.paymentCategoryId ?? null} />
              <CategorySelect categories={categories} disabled={!canManage} label="Categoria dos projetos/atendimentos" onChange={(value) => patch({ attendanceCategoryId: value })} value={draft.attendanceCategoryId ?? null} />
              <ChannelSelect channels={channels} disabled={!canManage} label="Canal de recebimento dos comprovantes" onChange={(value) => patch({ receiptChannelId: value })} value={draft.receiptChannelId ?? null} />
              <ChannelSelect channels={channels} disabled={!canManage} label="Canal de análise da equipe" onChange={(value) => patch({ logChannelId: value })} value={draft.logChannelId ?? null} />
              <ChannelSelect channels={channels} disabled={!canManage} label="Canal de suporte" onChange={(value) => patch({ supportPanelChannelId: value })} value={draft.supportPanelChannelId ?? null} />
              <RoleMultiSelect disabled={!canManage} label="Cargos da equipe" onChange={(values) => patch({ logViewRoleIds: values })} roles={roles} values={draft.logViewRoleIds ?? []} />
              <RoleMultiSelect disabled={!canManage} label="Cargo autorizado para aprovar pagamentos" onChange={(values) => patch({ approveRoleIds: values })} roles={roles} values={draft.approveRoleIds ?? []} />
              <RoleMultiSelect disabled={!canManage} label="Cargo autorizado para recusar pagamentos" onChange={(values) => patch({ rejectRoleIds: values })} roles={roles} values={draft.rejectRoleIds ?? []} />
              <RoleMultiSelect disabled={!canManage} label="Cargos finalizadores" onChange={(values) => patch({ finalizeRoleIds: values })} roles={roles} values={draft.finalizeRoleIds ?? []} />
              <Field disabled={!canManage} label="Tempo máximo para análise" onChange={(value) => patch({ maxPaymentMinutes: Number(value) || 1 })} type="number" value={String(draft.maxPaymentMinutes ?? 60)} />
              <Field disabled={!canManage} label="Banner do painel" onChange={(value) => patch({ bannerUrl: value || null })} value={draft.bannerUrl ?? ""} />
              <Field disabled={!canManage} label="Cor dos embeds" onChange={(value) => patch({ color: value })} type="color" value={draft.color ?? "#22c55e"} />
              <Toggle checked={draft.autoReceiptDetectionEnabled !== false} disabled={!canManage} label="Ativar detecção automática de comprovantes" onChange={(checked) => patch({ autoReceiptDetectionEnabled: checked })} />
              <Toggle checked={draft.allowReceiptPdf !== false} disabled={!canManage} label="Permitir PDF como alternativa" onChange={(checked) => patch({ allowReceiptPdf: checked })} />
            </div>
            <ReceiptFormatSelect disabled={!canManage} formats={draft.allowedReceiptImageFormats ?? ["png", "jpg", "jpeg", "webp"]} onChange={(formats) => patch({ allowedReceiptImageFormats: formats })} />

            <div className="grid gap-3 md:grid-cols-2">
              <Field disabled={!canManage} label="Chave Pix" onChange={(value) => patch({ pixKey: value || null })} value={draft.pixKey ?? ""} />
              <ValueSelect disabled={!canManage} label="Tipo da chave" onChange={(value) => patch({ pixKeyType: value as ManualPaymentSettings["pixKeyType"] })} options={["cpf", "cnpj", "email", "phone", "random"]} value={draft.pixKeyType ?? "random"} />
              <Field disabled={!canManage} label="Código Pix Copia e Cola" onChange={(value) => patch({ pixCopyPasteCode: value || null })} value={draft.pixCopyPasteCode ?? ""} />
              <Field disabled={!canManage} label="Nome do recebedor" onChange={(value) => patch({ receiverName: value || null })} value={draft.receiverName ?? ""} />
              <Field disabled={!canManage} label="Banco" onChange={(value) => patch({ receiverBank: value || null })} value={draft.receiverBank ?? ""} />
              <QrCodeUploadControl disabled={!canManage || uploadingQr || saving} imageUrl={draft.pixQrCodeUrl ?? null} onRemove={() => void removeQrCode()} onUpload={(file) => void uploadQrCode(file)} uploading={uploadingQr} />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Field disabled={!canManage} label="Título do painel" onChange={(value) => patch({ salePanelTitle: value })} value={draft.salePanelTitle ?? ""} />
              <Field disabled={!canManage} label="Descrição do painel" onChange={(value) => patch({ salePanelDescription: value })} value={draft.salePanelDescription ?? ""} />
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-white">Pagamentos Manuais</h3>
                <p className="mt-1 text-xs text-zinc-500">Mensagens usadas no atendimento, análise e retorno ao cliente.</p>
              </div>
              <div className="space-y-3">
                <Textarea disabled={!canManage} label="Mensagem automática enviada ao cliente" onChange={(value) => patch({ customerReceiptMessage: value })} value={draft.customerReceiptMessage ?? ""} />
                <Textarea disabled={!canManage} label="Mensagem em caso de aprovação" onChange={(value) => patch({ approvalMessage: value })} value={draft.approvalMessage ?? ""} />
                <Textarea disabled={!canManage} label="Mensagem em caso de recusa" onChange={(value) => patch({ rejectionMessage: value })} value={draft.rejectionMessage ?? ""} />
              </div>
            </div>
            <Textarea disabled={!canManage} label="Instruções de pagamento" onChange={(value) => patch({ paymentInstructions: value })} value={draft.paymentInstructions ?? ""} />

            <div className="flex flex-wrap gap-3">
              <Button disabled={!canManage || saving} onClick={() => void save()} type="button"><Save className="mr-2 h-4 w-4" />Salvar</Button>
              <Button disabled={!canManage || saving} onClick={() => void publish()} type="button" variant="secondary"><Send className="mr-2 h-4 w-4" />Publicar painel</Button>
              <Button disabled={loading || saving} onClick={() => void refreshOptions()} type="button" variant="outline"><RefreshCw className="mr-2 h-4 w-4" />Atualizar opções</Button>
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
            <Summary label="Pedidos hoje" value={String(todayOrders.length)} />
            <Summary label="Pedidos recentes" value={String(orders.length)} />
            <Summary label="Pendentes" value={String(orders.filter((order) => order.status === "PENDING_PAYMENT").length)} />
            <Summary label="Aguardando equipe" value={String(orders.filter((order) => order.status === "WAITING_STAFF_APPROVAL").length)} />
            <Summary label="Em atendimento" value={String(orders.filter((order) => order.status === "IN_PROGRESS" || order.status === "WAITING_CUSTOMER" || order.status === "DELIVERED").length)} />
            <Summary label="Concluídos" value={String(orders.filter((order) => order.status === "FINISHED").length)} />
            <Summary label="Total vendido" value={money(orders.filter((order) => ["APPROVED", "IN_PROGRESS", "WAITING_CUSTOMER", "DELIVERED", "FINISHED"].includes(order.status)).reduce((total, order) => total + order.amount, 0))} />
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
                <ValueSelect disabled={!canManage} label="Tipo" onChange={(value) => patchService(service.id, { serviceType: value as ManualPaymentService["serviceType"] })} options={["product", "service", "subscription", "custom"]} value={service.serviceType} />
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

function ValueSelect({ disabled, label, onChange, options, value }: { disabled?: boolean; label: string; onChange: (value: string) => void; options: string[]; value: string }) {
  return <label className="block text-xs font-medium text-zinc-500">{label}<select className="mt-1 h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-[#FFD500]/50" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value}>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
}

function QrCodeUploadControl({ disabled, imageUrl, onRemove, onUpload, uploading }: { disabled?: boolean; imageUrl: string | null; onRemove: () => void; onUpload: (file: File | null) => void; uploading: boolean }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-zinc-500">QR Code Pix</p>
          <p className="mt-1 text-xs text-zinc-600">Upload validado e salvo de forma persistente.</p>
        </div>
        {imageUrl ? <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-300">Salvo</span> : null}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[96px,minmax(0,1fr)]">
        <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-md border border-zinc-800 bg-black">
          {imageUrl ? <img alt="QR Code Pix" className="h-full w-full object-contain" src={dashboardImageUrl(imageUrl)} /> : <Upload className="h-5 w-5 text-zinc-600" />}
        </div>
        <div className="space-y-2">
          <input
            accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
            className="block w-full text-xs text-zinc-400 file:mr-3 file:rounded-md file:border-0 file:bg-[#FFD500] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-black disabled:opacity-50"
            disabled={disabled}
            onChange={(event) => {
              onUpload(event.target.files?.[0] ?? null);
              event.currentTarget.value = "";
            }}
            type="file"
          />
          <div className="flex flex-wrap gap-2">
            <Button disabled={disabled || !imageUrl} onClick={onRemove} size="sm" type="button" variant="outline"><Trash2 className="mr-2 h-4 w-4" />Remover QR</Button>
            {uploading ? <span className="px-2 py-1 text-xs text-zinc-500">Enviando...</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function ChannelSelect({ channels, disabled, label, onChange, value }: { channels: GuildChannelOption[]; disabled?: boolean; label: string; onChange: (value: string | null) => void; value: string | null }) {
  return (
    <label className="block text-xs font-medium text-zinc-500">
      {label}
      <select className="mt-1 h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-[#FFD500]/50" disabled={disabled} onChange={(event) => onChange(event.target.value || null)} value={value ?? ""}>
        <option value="">Selecionar canal</option>
        {channels.map((channel) => <option key={channel.id} value={channel.id}># {channel.name}</option>)}
      </select>
    </label>
  );
}

function CategorySelect({ categories, disabled, label, onChange, value }: { categories: GuildCategoryOption[]; disabled?: boolean; label: string; onChange: (value: string | null) => void; value: string | null }) {
  return (
    <label className="block text-xs font-medium text-zinc-500">
      {label}
      <select className="mt-1 h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-[#FFD500]/50" disabled={disabled} onChange={(event) => onChange(event.target.value || null)} value={value ?? ""}>
        <option value="">Selecionar categoria</option>
        {categories.map((category) => <option key={category.id} value={category.id}>📁 {category.name}</option>)}
      </select>
    </label>
  );
}

function RoleMultiSelect({ disabled, label, onChange, roles, values }: { disabled?: boolean; label: string; onChange: (values: string[]) => void; roles: GuildRoleOption[]; values: string[] }) {
  const selected = new Set(values);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <div className="mt-2 grid max-h-40 gap-2 overflow-y-auto sm:grid-cols-2">
        {roles.map((role) => (
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-zinc-800 bg-black/25 px-2 py-1.5 text-xs text-zinc-300" key={role.id}>
            <input
              checked={selected.has(role.id)}
              disabled={disabled}
              onChange={() => {
                const next = selected.has(role.id)
                  ? values.filter((id) => id !== role.id)
                  : [...values, role.id];
                onChange(next);
              }}
              type="checkbox"
            />
            <span className="truncate">@{role.name}</span>
          </label>
        ))}
        {!roles.length ? <p className="text-xs text-zinc-600">Nenhum cargo carregado.</p> : null}
      </div>
    </div>
  );
}

function ReceiptFormatSelect({ disabled, formats, onChange }: { disabled?: boolean; formats: string[]; onChange: (values: string[]) => void }) {
  const selected = new Set(formats);
  const options = ["png", "jpg", "jpeg", "webp", "gif"];
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
      <p className="text-xs font-medium text-zinc-500">Formatos de imagem permitidos</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((format) => (
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-zinc-800 bg-black/25 px-3 py-2 text-xs uppercase text-zinc-300" key={format}>
            <input
              checked={selected.has(format)}
              disabled={disabled}
              onChange={() => {
                const next = selected.has(format)
                  ? formats.filter((item) => item !== format)
                  : [...formats, format];
                onChange(next.length ? next : ["png", "jpg", "jpeg", "webp"]);
              }}
              type="checkbox"
            />
            {format}
          </label>
        ))}
      </div>
    </div>
  );
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

function dashboardImageUrl(imageUrl: string) {
  try {
    const url = new URL(imageUrl);
    if (url.pathname.startsWith("/api/persistent-images/")) return `${url.pathname}${url.search}`;
  } catch {
    if (imageUrl.startsWith("/api/")) return imageUrl;
  }
  if (imageUrl.startsWith("/api/")) {
    const apiOrigin = new URL(API_URL, window.location.origin).origin;
    return `${apiOrigin}${imageUrl}`;
  }
  return imageUrl;
}

function readError(error: unknown, fallback: string) {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message ?? fallback;
  }
  return error instanceof Error ? error.message : fallback;
}
