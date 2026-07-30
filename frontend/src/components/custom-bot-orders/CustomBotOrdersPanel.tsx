import { Bot, CheckCircle2, ExternalLink, Loader2, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  deleteCustomBotOrderPanel,
  getCustomBotOrdersDashboard,
  getGuildLiveOptions,
  publishCustomBotOrderPanel,
  saveCustomBotOrderSettings
} from "../../lib/api";
import type { CustomBotOrderSettings, CustomBotOrdersDashboard, DashboardGuild, GuildCategoryOption, GuildChannelOption, GuildRoleOption } from "../../types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";

type Props = {
  botId?: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
};

const DEFAULT_BENEFITS = [
  "Bots personalizados para Discord",
  "Sistemas administrativos",
  "Dashboards integradas",
  "Sistemas de tickets",
  "Sistemas de vendas",
  "Integrações com APIs",
  "Sistemas para FiveM",
  "Painéis em Componentes V2"
];

const PREVIEW_BULLET_EMOJI = "<:visto:1525682264300716082>";

export function CustomBotOrdersPanel({ botId, canManage, guild }: Props) {
  const [dashboard, setDashboard] = useState<CustomBotOrdersDashboard | null>(null);
  const [draft, setDraft] = useState<CustomBotOrderSettings | null>(null);
  const [options, setOptions] = useState<{ categories: GuildCategoryOption[]; channels: GuildChannelOption[]; roles: GuildRoleOption[] }>({ categories: [], channels: [], roles: [] });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!guild || !botId) return;
    setLoading(true);
    Promise.all([
      getCustomBotOrdersDashboard(botId, guild.id),
      getGuildLiveOptions(guild.id, botId)
    ]).then(([data, liveOptions]) => {
      setDashboard(data);
      setDraft(data.settings);
      setOptions({ categories: liveOptions.categories ?? [], channels: liveOptions.channels, roles: liveOptions.roles });
    }).catch((error) => {
      setMessage(readMessage(error) || "Não foi possível carregar pedidos de bots.");
    }).finally(() => setLoading(false));
  }, [botId, guild]);

  const visibleOrders = useMemo(() => dashboard?.orders ?? [], [dashboard]);
  const activeStatuses = draft?.statusDefinitions ?? [];

  async function save() {
    if (!guild || !botId || !draft) return;
    setSaving(true);
    setMessage(null);
    try {
      const settings = await saveCustomBotOrderSettings(botId, guild.id, draft);
      setDraft(settings);
      setDashboard((current) => current ? { ...current, settings } : current);
      setMessage("Configurações salvas.");
    } catch (error) {
      setMessage(readMessage(error) || "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!guild || !botId || !draft) return;
    await save();
    try {
      const settings = await publishCustomBotOrderPanel(botId, guild.id);
      setDraft(settings);
      setMessage("Publicação solicitada ao bot. Se já existir mensagem, ela será atualizada.");
    } catch (error) {
      setMessage(readMessage(error) || "Não foi possível publicar.");
    }
  }

  async function removePanel() {
    if (!guild || !botId) return;
    try {
      const settings = await deleteCustomBotOrderPanel(botId, guild.id);
      setDraft(settings);
      setMessage("Exclusão solicitada ao bot. A mensagem será apagada e o vínculo será limpo.");
    } catch (error) {
      setMessage(readMessage(error) || "Não foi possível excluir o painel.");
    }
  }

  if (!guild || !botId) return <Card><CardContent className="p-6 text-sm text-zinc-400">Selecione um bot e servidor.</CardContent></Card>;
  if (loading || !draft || !dashboard) return <Card><CardContent className="flex min-h-40 items-center justify-center gap-2 p-6 text-sm text-zinc-300"><Loader2 className="h-4 w-4 animate-spin" />Carregando...</CardContent></Card>;

  return (
    <div className="space-y-4">
      {message ? <div className="rounded-lg border border-[#FFD500]/25 bg-[#FFD500]/10 px-4 py-3 text-sm font-semibold text-white">{message}</div> : null}

      <div className="grid gap-3 md:grid-cols-6">
        <Metric label="Abertos" value={dashboard.metrics.open} />
        <Metric label="Aguardando" value={dashboard.metrics.waitingStaff} />
        <Metric label="Desenvolvimento" value={dashboard.metrics.inDevelopment} />
        <Metric label="Cliente" value={dashboard.metrics.waitingCustomer} />
        <Metric label="Finalizados" value={dashboard.metrics.finished} />
        <Metric label="Cancelados" value={dashboard.metrics.cancelled} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Bot className="h-5 w-5 text-[#FFD500]" /> Pedidos de Bots Personalizados</CardTitle>
          <CardDescription>Painel público em Components V2, tickets privados, avisos por DM e acompanhamento pela dashboard.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center justify-between rounded-lg border border-zinc-800 p-3">
            <span><span className="block text-sm font-semibold text-white">Ativar sistema</span><span className="text-xs text-zinc-500">O bot só aceitará pedidos se estiver ativo e liberado na aba Dev.</span></span>
            <Switch checked={draft.enabled} disabled={!canManage} onCheckedChange={(checked) => setDraft({ ...draft, enabled: checked })} />
          </label>

          <div className="grid gap-3 md:grid-cols-3">
            <Field disabled={!canManage} label="Título" value={draft.title} onChange={(value) => setDraft({ ...draft, title: value })} />
            <Field disabled={!canManage} label="Subtítulo" value={draft.subtitle} onChange={(value) => setDraft({ ...draft, subtitle: value })} />
            <Field disabled={!canManage} label="Cor" type="color" value={draft.color} onChange={(value) => setDraft({ ...draft, color: value })} />
            <Select disabled={!canManage} label="Canal do painel" value={draft.panelChannelId ?? ""} onChange={(value) => setDraft({ ...draft, panelChannelId: value || null })} options={options.channels.map((channel) => ({ label: `#${channel.name}`, value: channel.id }))} />
            <Select disabled={!canManage} label="Categoria dos tickets" value={draft.categoryId ?? ""} onChange={(value) => setDraft({ ...draft, categoryId: value || null })} options={options.categories.map((category) => ({ label: category.name, value: category.id }))} />
            <Select disabled={!canManage} label="Canal de logs" value={draft.logChannelId ?? ""} onChange={(value) => setDraft({ ...draft, logChannelId: value || null })} options={options.channels.map((channel) => ({ label: `#${channel.name}`, value: channel.id }))} />
            <Select disabled={!canManage} label="Canal de transcripts" value={draft.transcriptChannelId ?? ""} onChange={(value) => setDraft({ ...draft, transcriptChannelId: value || null })} options={options.channels.map((channel) => ({ label: `#${channel.name}`, value: channel.id }))} />
            <Select disabled={!canManage} label="Cargo mencionado" value={draft.mentionRoleId ?? ""} onChange={(value) => setDraft({ ...draft, mentionRoleId: value || null })} options={options.roles.map((role) => ({ label: role.name, value: role.id }))} />
            <Field disabled={!canManage} label="Cooldown de aviso (min)" type="number" value={String(draft.noticeCooldownMinutes)} onChange={(value) => setDraft({ ...draft, noticeCooldownMinutes: Number(value) || 5 })} />
          </div>

          <Area disabled={!canManage} label="Descrição" value={draft.description} onChange={(value) => setDraft({ ...draft, description: value })} />
          <Area disabled={!canManage} label="Texto final" value={draft.introText} onChange={(value) => setDraft({ ...draft, introText: value })} />

          <div className="grid gap-3 md:grid-cols-3">
            <Field disabled={!canManage} label="Banner" value={draft.bannerUrl ?? ""} onChange={(value) => setDraft({ ...draft, bannerUrl: value || null })} />
            <Field disabled={!canManage} label="Miniatura" value={draft.thumbnailUrl ?? ""} onChange={(value) => setDraft({ ...draft, thumbnailUrl: value || null })} />
            <Field disabled={!canManage} label="Imagem do rodapé" value={draft.footerImageUrl ?? ""} onChange={(value) => setDraft({ ...draft, footerImageUrl: value || null })} />
            <Field disabled={!canManage} label="Emoji do painel" value={draft.panelEmoji} onChange={(value) => setDraft({ ...draft, panelEmoji: value })} />
            <Field disabled={!canManage} label="Emoji do botão" value={draft.buttonEmoji} onChange={(value) => setDraft({ ...draft, buttonEmoji: value })} />
            <Field disabled={!canManage} label="Nome do botão" value={draft.buttonLabel} onChange={(value) => setDraft({ ...draft, buttonLabel: value })} />
          </div>

          <RoleMulti disabled={!canManage} label="Cargos responsáveis" roles={options.roles} values={draft.staffRoleIds} onChange={(values) => setDraft({ ...draft, staffRoleIds: values })} />
          <RoleMulti disabled={!canManage} label="Cargos que assumem" roles={options.roles} values={draft.assignRoleIds} onChange={(values) => setDraft({ ...draft, assignRoleIds: values })} />
          <RoleMulti disabled={!canManage} label="Cargos que fecham" roles={options.roles} values={draft.closeRoleIds} onChange={(values) => setDraft({ ...draft, closeRoleIds: values })} />
          <RoleMulti disabled={!canManage} label="Administradores" roles={options.roles} values={draft.adminRoleIds} onChange={(values) => setDraft({ ...draft, adminRoleIds: values })} />

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-white">Status do fluxo</p>
                <Button disabled={!canManage} size="sm" variant="secondary" onClick={() => setDraft({ ...draft, statusDefinitions: [...draft.statusDefinitions, { color: "#8b5cf6", dmEnabled: false, emoji: "<:pranchetaaa:1525682920789114940>", id: `custom-${Date.now()}`, name: "Novo status", order: draft.statusDefinitions.length + 1 }] })}><Plus className="h-4 w-4" />Status</Button>
              </div>
              {activeStatuses.map((status, index) => (
                <div className="grid gap-2 rounded-lg border border-zinc-800 p-3 md:grid-cols-[4rem_minmax(0,1fr)_8rem_auto]" key={status.id}>
                  <input className="h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-2 text-sm text-white" disabled={!canManage} value={status.emoji} onChange={(event) => updateStatus(index, { emoji: event.target.value })} />
                  <input className="h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-2 text-sm text-white" disabled={!canManage} value={status.name} onChange={(event) => updateStatus(index, { name: event.target.value })} />
                  <input className="h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-2 text-sm text-white" disabled={!canManage} type="color" value={status.color} onChange={(event) => updateStatus(index, { color: event.target.value })} />
                  <Button disabled={!canManage || status.locked} size="sm" variant="destructive" onClick={() => setDraft({ ...draft, statusDefinitions: draft.statusDefinitions.filter((_, itemIndex) => itemIndex !== index).map((item, order) => ({ ...item, order: order + 1 })) })}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
            <Preview settings={draft} />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button disabled={!canManage || saving} onClick={() => void save()} variant="secondary">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Salvar configurações</Button>
            <Button disabled={!canManage || saving || !draft.panelChannelId} onClick={() => void publish()}><Upload className="h-4 w-4" />Publicar painel</Button>
            <Button disabled={!canManage || saving || !draft.panelMessageId} onClick={() => void publish()} variant="secondary"><RefreshCw className="h-4 w-4" />Atualizar painel existente</Button>
            <Button disabled={!canManage || saving || !draft.panelMessageId} onClick={() => void removePanel()} variant="destructive"><Trash2 className="h-4 w-4" />Excluir painel</Button>
            {draft.panelMessageId ? <Badge variant="muted">Mensagem: {draft.panelMessageId}</Badge> : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Acompanhamento</CardTitle>
          <CardDescription>Pedidos abertos, responsáveis, status e links para tickets.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs uppercase text-zinc-500"><tr><th className="py-2">Número</th><th>Cliente</th><th>Projeto</th><th>Status</th><th>Responsável</th><th>Atualizado</th><th>Ações</th></tr></thead>
            <tbody className="divide-y divide-zinc-800">
              {visibleOrders.map((order) => {
                const status = draft.statusDefinitions.find((item) => item.id === order.status);
                return (
                  <tr key={order.id}>
                    <td className="py-3 font-semibold text-white">{order.ticketId}</td>
                    <td className="text-zinc-300">{order.customerName ?? order.customerId}</td>
                    <td className="text-zinc-300">{order.projectName}</td>
                    <td><Badge variant="muted">{status?.emoji} {status?.name ?? order.status}</Badge></td>
                    <td className="text-zinc-300">{order.assignedStaffId ?? "Aguardando"}</td>
                    <td className="text-zinc-400">{new Date(order.updatedAt).toLocaleString("pt-BR")}</td>
                    <td>{order.channelId ? <a className="inline-flex items-center gap-1 text-[#FFD500]" href={`https://discord.com/channels/${guild.id}/${order.channelId}`} rel="noreferrer" target="_blank">Abrir <ExternalLink className="h-3 w-3" /></a> : "Sem canal"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );

  function updateStatus(index: number, patch: Partial<CustomBotOrderSettings["statusDefinitions"][number]>) {
    setDraft((current) => current ? { ...current, statusDefinitions: current.statusDefinitions.map((status, itemIndex) => itemIndex === index ? { ...status, ...patch } : status) } : current);
  }
}

function Metric({ label, value }: { label: string; value: number }) {
  return <Card><CardContent className="p-3"><p className="text-xs text-zinc-500">{label}</p><p className="text-2xl font-bold text-white">{value}</p></CardContent></Card>;
}

function Field({ disabled, label, onChange, type = "text", value }: { disabled: boolean; label: string; onChange: (value: string) => void; type?: string; value: string }) {
  return <label className="space-y-1"><span className="text-xs font-semibold text-zinc-400">{label}</span><input className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-[#FFD500]" disabled={disabled} type={type} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function Area({ disabled, label, onChange, value }: { disabled: boolean; label: string; onChange: (value: string) => void; value: string }) {
  return <label className="space-y-1"><span className="text-xs font-semibold text-zinc-400">{label}</span><textarea className="min-h-24 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-[#FFD500]" disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function Select({ disabled, label, onChange, options, value }: { disabled: boolean; label: string; onChange: (value: string) => void; options: Array<{ label: string; value: string }>; value: string }) {
  return <label className="space-y-1"><span className="text-xs font-semibold text-zinc-400">{label}</span><select className="h-10 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-sm text-white outline-none focus:border-[#FFD500]" disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}><option value="">Não selecionado</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function RoleMulti({ disabled, label, onChange, roles, values }: { disabled: boolean; label: string; onChange: (value: string[]) => void; roles: GuildRoleOption[]; values: string[] }) {
  return <div className="space-y-2"><p className="text-xs font-semibold text-zinc-400">{label}</p><div className="grid gap-2 md:grid-cols-4">{roles.map((role) => <label className="flex items-center gap-2 rounded-lg border border-zinc-800 p-2 text-xs text-zinc-300" key={role.id}><input checked={values.includes(role.id)} disabled={disabled} type="checkbox" onChange={(event) => onChange(event.target.checked ? [...values, role.id] : values.filter((id) => id !== role.id))} />{role.name}</label>)}</div></div>;
}

function Preview({ settings }: { settings: CustomBotOrderSettings }) {
  return <div className="rounded-lg border border-zinc-800 bg-[#313338] p-3 text-white"><div className="border-l-4 pl-3" style={{ borderColor: settings.color }}><h3 className="font-extrabold">{settings.panelEmoji} {settings.title}</h3><p className="mt-1 text-xs font-bold">{settings.subtitle}</p><p className="mt-3 text-xs leading-relaxed">{settings.description}</p><div className="mt-3 border-l border-zinc-500 pl-2 text-xs">{DEFAULT_BENEFITS.slice(0, 5).map((item) => <p key={item}>{PREVIEW_BULLET_EMOJI} {item}</p>)}</div><p className="mt-3 text-xs italic">{settings.introText}</p>{settings.bannerUrl ? <img alt="" className="mt-3 max-h-32 w-full rounded-md object-cover" src={settings.bannerUrl} /> : null}<p className="mt-2 text-[11px] text-zinc-300">{settings.footerText}</p></div><button className="mt-3 rounded-md bg-[#5865F2] px-3 py-2 text-xs font-bold">{settings.buttonEmoji} {settings.buttonLabel}</button></div>;
}

function readMessage(error: unknown) {
  return (error as { response?: { data?: { message?: string } } }).response?.data?.message;
}
