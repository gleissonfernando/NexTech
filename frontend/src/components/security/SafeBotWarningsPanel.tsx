import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, Save, ShieldAlert, Trash2 } from "lucide-react";
import {
  getSafeBotWarnings,
  removeSafeBotWarning,
  resetSafeBotWarnings,
  saveSafeBotWarningNote,
  saveSafeBotWarningSettings
} from "../../lib/api";
import { createDashboardSocket } from "../../lib/socket";
import type {
  GuildChannelOption,
  GuildRoleOption,
  SafeBotWarningAction,
  SafeBotWarningDashboard,
  SafeBotWarningLevel,
  SafeBotWarningSettings
} from "../../types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";

const actions: Array<{ id: SafeBotWarningAction | ""; label: string }> = [
  { id: "", label: "Sem ação (apenas registrar)" },
  { id: "record_only", label: "Apenas registrar" },
  { id: "dm", label: "Enviar mensagem privada" },
  { id: "channel_message", label: "Enviar mensagem em canal" },
  { id: "add_role", label: "Adicionar cargo de advertência" },
  { id: "remove_role", label: "Remover cargo" },
  { id: "timeout", label: "Timeout temporário" },
  { id: "kick", label: "Expulsar" },
  { id: "ban", label: "Banir" },
  { id: "notify_staff", label: "Avisar staff" },
  { id: "open_ticket", label: "Abrir ticket automático" },
  { id: "block_channels", label: "Bloquear acesso a canais" },
  { id: "custom", label: "Aviso personalizado configurado" }
];

export function SafeBotWarningsPanel({
  botId,
  canManage,
  channels,
  guildId,
  roles
}: {
  botId: string | null;
  canManage: boolean;
  channels: GuildChannelOption[];
  guildId: string;
  roles: GuildRoleOption[];
}) {
  const [dashboard, setDashboard] = useState<SafeBotWarningDashboard | null>(null);
  const [settings, setSettings] = useState<SafeBotWarningSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    if (!botId) return;

    setLoading(true);

    try {
      const data = await getSafeBotWarnings(guildId, botId);
      setDashboard(data);
      setSettings(data.settings);
    } catch (error) {
      setMessage(readError(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [botId, guildId]);

  useEffect(() => {
    if (!botId) return;

    const socket = createDashboardSocket();
    socket.on("safe-bot:warnings_updated", (payload: { botId?: string; guildId?: string }) => {
      if (payload.botId === botId && payload.guildId === guildId) void load();
    });

    return () => {
      socket.disconnect();
    };
  }, [botId, guildId]);

  function update(patch: Partial<SafeBotWarningSettings>) {
    setSettings((current) => current ? { ...current, ...patch } : current);
  }

  function updateLevel(index: number, next: SafeBotWarningLevel) {
    if (settings) update({ levels: settings.levels.map((level, i) => i === index ? next : level) });
  }

  function addLevel() {
    if (settings) update({ levels: [...settings.levels, newLevel(settings.levels.length + 1)] });
  }

  function removeLevel(index: number) {
    if (settings) update({ levels: settings.levels.filter((_, i) => i !== index).map((level, i) => ({ ...level, number: i + 1 })) });
  }

  function moveLevel(index: number, direction: -1 | 1) {
    if (!settings) return;

    const target = index + direction;

    if (target < 0 || target >= settings.levels.length) return;

    const levels = [...settings.levels];
    [levels[index], levels[target]] = [levels[target]!, levels[index]!];
    update({ levels: levels.map((level, i) => ({ ...level, number: i + 1 })) });
  }

  async function save() {
    if (!botId || !settings || !canManage) return;

    setSaving(true);
    setMessage(null);

    try {
      const saved = await saveSafeBotWarningSettings(guildId, botId, settings);
      setSettings(saved);
      setMessage("Configuração de advertências salva.");
      await load();
    } catch (error) {
      setMessage(readError(error));
    } finally {
      setSaving(false);
    }
  }

  async function removeWarning(id: string) {
    await removeSafeBotWarning(guildId, botId!, id);
    await load();
  }

  async function resetUser(userId: string) {
    await resetSafeBotWarnings(guildId, botId!, userId);
    await load();
  }

  async function saveNote(userId: string) {
    const node = document.getElementById(`note-${userId}`) as HTMLTextAreaElement | null;
    await saveSafeBotWarningNote(guildId, botId!, userId, node?.value ?? "");
    setMessage("Observação interna salva.");
    await load();
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex min-h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  if (!settings || !botId) return null;

  const disabled = !canManage || saving;

  return (
    <div className="space-y-5">
      {message ? <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-200">{message}</div> : null}

      <Card className="hover:translate-y-0">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5" />
                Configuração de Advertências
              </CardTitle>
              <CardDescription>As ações só executam quando o sistema e o nível exato estão configurados explicitamente.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={settings.enabled ? "success" : "muted"}>{settings.enabled ? "Ativado" : "Desativado"}</Badge>
              <Switch checked={settings.enabled} disabled={disabled} onCheckedChange={(enabled) => update({ enabled })} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Select
              disabled={disabled}
              label="Canal padrão de logs de advertência"
              onChange={(value) => update({ defaultLogChannelId: value || null })}
              options={channels.map((channel) => ({ value: channel.id, label: `#${channel.name}` }))}
              value={settings.defaultLogChannelId ?? ""}
            />
            <Select
              disabled={disabled}
              label="Após o último nível configurado"
              onChange={(value) => {
                const overflowMode = value as SafeBotWarningSettings["overflowMode"];
                update({
                  overflowMode,
                  finalLevel: overflowMode === "final_action"
                    ? settings.finalLevel ?? newLevel(settings.levels.length + 1, "Ação final")
                    : settings.finalLevel
                });
              }}
              options={[
                { value: "record_only", label: "Apenas registrar" },
                { value: "repeat_last", label: "Repetir última ação" },
                { value: "block", label: "Bloquear novas advertências" },
                { value: "final_action", label: "Usar ação final configurada" }
              ]}
              value={settings.overflowMode}
            />
          </div>

          <RoleChecklist
            disabled={disabled}
            label="Cargos autorizados a aplicar advertências"
            onChange={(authorizedRoleIds) => update({ authorizedRoleIds })}
            roles={roles}
            selected={settings.authorizedRoleIds}
          />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-white">Níveis de advertência</p>
                <p className="text-xs text-zinc-500">Crie, edite, exclua e reordene quantos níveis este servidor precisar.</p>
              </div>
              <Button disabled={disabled || settings.levels.length >= 50} onClick={addLevel} variant="outline">
                <Plus className="h-4 w-4" />
                Adicionar nível
              </Button>
            </div>
            {settings.levels.length ? settings.levels.map((level, index) => (
              <WarningLevelEditor
                channels={channels}
                disabled={disabled}
                key={level.id}
                level={level}
                onChange={(next) => updateLevel(index, next)}
                onDelete={() => removeLevel(index)}
                onMoveDown={() => moveLevel(index, 1)}
                onMoveUp={() => moveLevel(index, -1)}
                roles={roles}
              />
            )) : <div className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-sm text-zinc-500">Nenhum nível configurado. Advertências não podem ser aplicadas.</div>}
          </div>

          {settings.overflowMode === "final_action" && settings.finalLevel ? (
            <div className="space-y-2">
              <p className="font-semibold text-white">Ação final configurada</p>
              <WarningLevelEditor channels={channels} disabled={disabled} level={settings.finalLevel} onChange={(finalLevel) => update({ finalLevel })} roles={roles} />
            </div>
          ) : null}

          <Button disabled={disabled} onClick={() => void save()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar sistema de advertências
          </Button>
        </CardContent>
      </Card>

      <section className="grid gap-5 xl:grid-cols-2">
        <Card className="hover:translate-y-0">
          <CardHeader><CardTitle>Usuários mais advertidos</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {dashboard?.users.length ? dashboard.users.map((user) => (
              <div className="rounded-lg border border-zinc-900 bg-zinc-950/60 p-3" key={user.userId}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">{user.username ?? user.userId}</p>
                    <p className="text-xs text-zinc-500">{user.userId}</p>
                  </div>
                  <Badge variant={user.totalWarnings ? "warning" : "muted"}>{user.totalWarnings} advertência(s)</Badge>
                </div>
                <textarea className="mt-3 min-h-16 w-full rounded-md border border-zinc-800 bg-black p-2 text-xs text-zinc-200" defaultValue={user.internalNote} disabled={disabled} id={`note-${user.userId}`} placeholder="Observação interna da staff" />
                <div className="mt-2 flex gap-2">
                  <Button disabled={disabled} onClick={() => void saveNote(user.userId)} size="sm" variant="outline">Salvar observação</Button>
                  <Button disabled={disabled || user.totalWarnings === 0} onClick={() => void resetUser(user.userId)} size="sm" variant="destructive">Resetar advertências</Button>
                </div>
              </div>
            )) : <p className="py-8 text-center text-sm text-zinc-500">Nenhum usuário advertido.</p>}
          </CardContent>
        </Card>

        <Card className="hover:translate-y-0">
          <CardHeader><CardTitle>Histórico de advertências</CardTitle></CardHeader>
          <CardContent className="max-h-[620px] space-y-2 overflow-y-auto">
            {dashboard?.warnings.length ? dashboard.warnings.map((warning) => (
              <div className="rounded-lg border border-zinc-900 bg-zinc-950/60 p-3" key={warning.id}>
                <div className="flex justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-white">#{warning.warningNumber} • {warning.level?.name ?? "Nível não configurado"}</p>
                    <p className="text-xs text-zinc-500">{warning.username ?? warning.userId} • staff {warning.staffName ?? warning.staffId}</p>
                  </div>
                  <Badge variant={warning.status === "failed" ? "danger" : warning.status === "removed" ? "muted" : "success"}>{warning.status}</Badge>
                </div>
                <p className="mt-2 text-sm text-zinc-300">{warning.reason}</p>
                <p className="mt-1 text-xs text-zinc-500">Ação: {warning.executedAction ?? warning.configuredAction ?? "apenas registrar"} • {new Date(warning.createdAt).toLocaleString()}</p>
                {warning.error ? <p className="mt-1 text-xs text-red-300">{warning.error}</p> : null}
                {warning.status !== "removed" ? (
                  <Button className="mt-2" disabled={disabled} onClick={() => void removeWarning(warning.id)} size="sm" variant="outline">
                    <Trash2 className="h-3.5 w-3.5" />
                    Remover
                  </Button>
                ) : null}
              </div>
            )) : <p className="py-8 text-center text-sm text-zinc-500">Nenhum histórico de advertência.</p>}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function WarningLevelEditor({
  level,
  disabled,
  channels,
  roles,
  onChange,
  onDelete,
  onMoveDown,
  onMoveUp
}: {
  level: SafeBotWarningLevel;
  disabled: boolean;
  channels: GuildChannelOption[];
  roles: GuildRoleOption[];
  onChange: (level: SafeBotWarningLevel) => void;
  onDelete?: () => void;
  onMoveDown?: () => void;
  onMoveUp?: () => void;
}) {
  const patch = (next: Partial<SafeBotWarningLevel>) => onChange({ ...level, ...next });
  const needsRole = level.action === "add_role" || level.action === "remove_role";
  const needsChannel = level.action === "channel_message" || level.action === "notify_staff" || level.action === "open_ticket" || level.action === "custom";

  return (
    <div className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-950/65 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <input className="h-10 w-20 rounded-md border border-zinc-800 bg-black px-2" disabled={disabled} min={1} onChange={(event) => patch({ number: Number(event.target.value) })} type="number" value={level.number} />
        <input className="h-10 min-w-52 flex-1 rounded-md border border-zinc-800 bg-black px-3" disabled={disabled} onChange={(event) => patch({ name: event.target.value })} value={level.name} />
        <Switch checked={level.enabled} disabled={disabled} onCheckedChange={(enabled) => patch({ enabled })} />
        {onMoveUp ? <Button disabled={disabled} onClick={onMoveUp} size="sm" variant="outline"><ArrowUp className="h-4 w-4" /></Button> : null}
        {onMoveDown ? <Button disabled={disabled} onClick={onMoveDown} size="sm" variant="outline"><ArrowDown className="h-4 w-4" /></Button> : null}
        {onDelete ? <Button disabled={disabled} onClick={onDelete} size="sm" variant="destructive"><Trash2 className="h-4 w-4" /></Button> : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <Text disabled={disabled} label="Descrição" onChange={(description) => patch({ description })} value={level.description} />
        <Text disabled={disabled} label="Motivo padrão" onChange={(defaultReason) => patch({ defaultReason })} value={level.defaultReason} />
        <Select disabled={disabled} label="Ação configurada" onChange={(value) => patch({ action: value ? value as SafeBotWarningAction : null })} options={actions.map((action) => ({ value: action.id, label: action.label }))} value={level.action ?? ""} />
        <Select disabled={disabled} label="Canal de logs" onChange={(value) => patch({ logChannelId: value || null })} options={channels.map((channel) => ({ value: channel.id, label: `#${channel.name}` }))} value={level.logChannelId ?? ""} />
      </div>

      {level.action === "timeout" ? <Text disabled={disabled} label="Duração em segundos" onChange={(value) => patch({ durationSeconds: Number(value) || null })} type="number" value={String(level.durationSeconds ?? 300)} /> : null}
      {needsRole ? <Select disabled={disabled} label="Cargo configurado" onChange={(value) => patch({ roleId: value || null })} options={roles.map((role) => ({ value: role.id, label: `@${role.name}` }))} value={level.roleId ?? ""} /> : null}
      {needsChannel ? <Select disabled={disabled} label={level.action === "open_ticket" ? "Categoria/canal de referência do ticket" : "Canal da ação"} onChange={(value) => patch({ channelId: value || null })} options={channels.map((channel) => ({ value: channel.id, label: `#${channel.name}` }))} value={level.channelId ?? ""} /> : null}
      {level.action === "block_channels" ? <RoleChecklist disabled={disabled} label="Canais a bloquear" onChange={(targetChannelIds) => patch({ targetChannelIds })} prefix="#" roles={channels} selected={level.targetChannelIds} /> : null}

      <div className="grid gap-3 md:grid-cols-2">
        <Text area disabled={disabled} label="Mensagem para o usuário" onChange={(userMessage) => patch({ userMessage })} value={level.userMessage} />
        <Text area disabled={disabled} label="Mensagem para a staff" onChange={(staffMessage) => patch({ staffMessage })} value={level.staffMessage} />
      </div>

      {level.action === "custom" ? <Text area disabled={disabled} label="Aviso exato da ação personalizada" onChange={(customAction) => patch({ customAction })} value={level.customAction} /> : null}
    </div>
  );
}

function newLevel(number: number, name = `Advertência ${number}`): SafeBotWarningLevel {
  return { id: crypto.randomUUID(), number, name, description: "", defaultReason: "", action: null, durationSeconds: null, roleId: null, channelId: null, targetChannelIds: [], logChannelId: null, userMessage: "", staffMessage: "", customAction: "", enabled: false };
}

function Select({ label, value, disabled, onChange, options }: { label: string; value: string; disabled: boolean; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return <label className="grid gap-2 text-sm"><span className="font-medium text-zinc-200">{label}</span><select className="h-11 rounded-lg border border-zinc-800 bg-zinc-950 px-3" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value}><option value="">Não configurado</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function Text({ label, value, disabled, onChange, area = false, type = "text" }: { label: string; value: string; disabled: boolean; onChange: (value: string) => void; area?: boolean; type?: string }) {
  return <label className="grid gap-2 text-sm"><span className="font-medium text-zinc-200">{label}</span>{area ? <textarea className="min-h-20 rounded-lg border border-zinc-800 bg-black p-3" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value} /> : <input className="h-11 rounded-lg border border-zinc-800 bg-black px-3" disabled={disabled} onChange={(event) => onChange(event.target.value)} type={type} value={value} />}</label>;
}

function RoleChecklist({ label, roles, selected, disabled, onChange, prefix = "@" }: { label: string; roles: Array<{ id: string; name: string }>; selected: string[]; disabled: boolean; onChange: (ids: string[]) => void; prefix?: string }) {
  const selectedSet = new Set(selected);

  return <div><p className="mb-2 text-sm font-medium text-zinc-200">{label}</p><div className="grid max-h-44 gap-2 overflow-y-auto rounded-lg border border-zinc-800 p-3 sm:grid-cols-2">{roles.map((role) => <label className="flex items-center gap-2 text-sm" key={role.id}><input checked={selectedSet.has(role.id)} disabled={disabled} onChange={() => onChange(selectedSet.has(role.id) ? selected.filter((id) => id !== role.id) : [...selected, role.id])} type="checkbox" />{prefix}{role.name}</label>)}</div></div>;
}

function readError(error: unknown) {
  if (typeof error === "object" && error && "response" in error) {
    const message = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message;
    if (typeof message === "string") return message;
  }

  return error instanceof Error ? error.message : "A requisição do sistema de advertências falhou.";
}
