import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Ban, Bot, CheckCircle2, Clock3, FlaskConical, Hash, Loader2, Save, ShieldCheck, UserMinus, UserPlus, Users } from "lucide-react";
import { getAntiBanConfig, getAntiBanLogs, getGuildLiveOptions, saveAntiBanConfig, testAntiBanProtection } from "../../lib/api";
import type { AntiBanConfig, AntiBanLog, AntiBanReadiness, DashboardGuild, GuildChannelOption, GuildRoleOption } from "../../types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";

type Props = { botId: string | null; canManage: boolean; guild: DashboardGuild | null };

const EMPTY: AntiBanConfig = {
  id: null, botId: "", guildId: "", enabled: false, banLimit: 3, kickLimit: 3, timeWindow: 60,
  logChannelId: null, whitelistUsers: [], whitelistRoles: [], whitelistRoleMode: "ignore",
  protectedRoles: [], actionOnTrigger: "remove_admin_roles", autoRecovery: "unban", createdAt: null, updatedAt: null
};

export function AntiBanPanel({ botId, canManage, guild }: Props) {
  const [draft, setDraft] = useState<AntiBanConfig>(EMPTY);
  const [readiness, setReadiness] = useState<AntiBanReadiness | null>(null);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [logs, setLogs] = useState<AntiBanLog[]>([]);
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!botId || !guild) { setLoading(false); return; }
    setLoading(true); setError(null);
    Promise.all([
      getAntiBanConfig(botId, guild.id),
      getGuildLiveOptions(guild.id, botId),
      getAntiBanLogs(botId, guild.id).catch(() => [])
    ]).then(([result, options, recentLogs]) => {
      if (!active) return;
      setDraft(result.config); setReadiness(result.readiness); setChannels(options.channels); setRoles(options.roles.filter((role) => !role.managed && role.id !== guild.id)); setLogs(recentLogs);
    }).catch((requestError) => active && setError(readError(requestError, "Não foi possível carregar o Anti Ban.")))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [botId, guild]);

  const status = useMemo(() => {
    if (!readiness?.ready) return { label: "Sem permissão", variant: "danger" as const };
    if (!draft.logChannelId) return { label: "Configuração incompleta", variant: "warning" as const };
    return draft.enabled ? { label: "Proteção ativa", variant: "success" as const } : { label: "Inativo", variant: "muted" as const };
  }, [draft.enabled, draft.logChannelId, readiness]);

  function patch<K extends keyof AntiBanConfig>(key: K, value: AntiBanConfig[K]) { setDraft((current) => ({ ...current, [key]: value })); }
  function toggleRole(key: "whitelistRoles" | "protectedRoles", roleId: string) {
    patch(key, draft[key].includes(roleId) ? draft[key].filter((id) => id !== roleId) : [...draft[key], roleId]);
  }
  function addUser() {
    const id = userId.trim();
    if (!/^\d{5,32}$/.test(id)) { setError("Informe um ID Discord válido."); return; }
    patch("whitelistUsers", [...new Set([...draft.whitelistUsers, id])]); setUserId(""); setError(null);
  }

  async function save() {
    if (!botId || !guild || !canManage) return;
    if (draft.enabled && !draft.logChannelId) { setError("Selecione o canal de logs antes de ativar."); return; }
    if (draft.enabled && !readiness?.ready) { setError(`Faltam permissões: ${readiness?.missingPermissions.join(", ") || "não foi possível validar"}.`); return; }
    setSaving(true); setError(null); setNotice(null);
    try {
      const result = await saveAntiBanConfig(botId, guild.id, draft);
      setDraft(result.config); setReadiness(result.readiness); setNotice("Configuração Anti Ban salva com sucesso.");
    } catch (requestError) { setError(readError(requestError, "Não foi possível salvar o Anti Ban.")); }
    finally { setSaving(false); }
  }

  async function test() {
    if (!botId || !guild) return;
    setTesting(true); setError(null); setNotice(null);
    try { const result = await testAntiBanProtection(botId, guild.id); setReadiness(result.readiness); setNotice("Log de teste enviado ao canal configurado."); }
    catch (requestError) { setError(readError(requestError, "Não foi possível testar a proteção.")); }
    finally { setTesting(false); }
  }

  if (!botId || !guild) return <Card><CardContent className="flex min-h-40 items-center justify-center p-6 text-sm text-zinc-500">Escolha um bot e um servidor.</CardContent></Card>;
  if (loading) return <Card><CardContent className="flex min-h-40 items-center justify-center gap-3 p-6"><Loader2 className="h-5 w-5 animate-spin" /> Carregando Anti Ban...</CardContent></Card>;
  const disabled = !canManage || saving || testing;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-2">
        <ScopeCard icon={Bot} label="Bot selecionado" value={botId} />
        <ScopeCard icon={Users} label="Servidor atual" value={`${guild.name} · ${guild.id}`} />
      </div>
      <div className="flex flex-wrap gap-2"><Badge variant="success">Anti Ban liberado</Badge><Badge variant={status.variant}>{status.label}</Badge></div>
      {notice ? <Message tone="success">{notice}</Message> : null}
      {error ? <Message tone="error">{error}</Message> : null}
      {!readiness?.ready ? <Message tone="error"><strong>Permissões insuficientes.</strong> Adicione ao bot: {readiness?.missingPermissions.join(", ") || "Administrador, Banir membros, Expulsar membros, Gerenciar cargos e Ver registro de auditoria"}.{readiness?.error ? ` Diagnóstico: ${readiness.error}` : ""}</Message> : null}

      <Card>
        <CardHeader><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle>Sistema Anti Ban</CardTitle><CardDescription>Protege o servidor contra bans, kicks e ações administrativas suspeitas.</CardDescription></div><div className="flex items-center gap-3"><span className="text-sm font-semibold">{draft.enabled ? "Ativado" : "Desativado"}</span><Switch checked={draft.enabled} disabled={disabled} onCheckedChange={(checked) => { if (checked && !readiness?.ready) setError("Corrija as permissões do bot antes de ativar."); else patch("enabled", checked); }} /></div></div></CardHeader>
      </Card>

      <Section icon={Ban} title="1. Proteção contra banimentos" description="Define quando uma sequência de bans aciona a proteção.">
        <NumberField label="Limite de banimentos" value={draft.banLimit} min={1} max={50} disabled={disabled} onChange={(value) => patch("banLimit", value)} />
        <NumberField label="Janela de tempo (segundos)" value={draft.timeWindow} min={10} max={3600} disabled={disabled} onChange={(value) => patch("timeWindow", value)} />
      </Section>

      <Section icon={UserMinus} title="2. Proteção contra expulsões" description="Conta kicks por executor dentro da mesma janela.">
        <NumberField label="Limite de expulsões" value={draft.kickLimit} min={1} max={50} disabled={disabled} onChange={(value) => patch("kickLimit", value)} />
        <InfoBox>{draft.kickLimit} kicks em {draft.timeWindow} segundos acionam a resposta configurada.</InfoBox>
      </Section>

      <Section icon={UserPlus} title="3. Whitelist" description="Executores confiáveis continuam gerando auditoria, mas não são punidos.">
        <div className="space-y-3 md:col-span-2"><label className="text-sm font-medium text-zinc-200">IDs de usuários confiáveis</label><div className="flex gap-2"><input className={inputClass} disabled={disabled} value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="ID do usuário" /><Button disabled={disabled} onClick={addUser}><UserPlus className="h-4 w-4" />Adicionar</Button></div><div className="flex flex-wrap gap-2">{draft.whitelistUsers.map((id) => <button key={id} disabled={disabled} onClick={() => patch("whitelistUsers", draft.whitelistUsers.filter((item) => item !== id))} className="rounded-full border border-purple-500/25 bg-purple-500/10 px-3 py-1 text-xs text-purple-100">{id} ×</button>)}</div></div>
        <SelectField label="Tratamento dos cargos confiáveis" value={draft.whitelistRoleMode} disabled={disabled} onChange={(value) => patch("whitelistRoleMode", value as AntiBanConfig["whitelistRoleMode"])} options={[{ value: "ignore", label: "Ignorar punição e registrar log" }, { value: "log_only", label: "Apenas registrar log" }]} />
        <RoleChecklist title="Cargos confiáveis" roles={roles} selected={draft.whitelistRoles} disabled={disabled} onToggle={(id) => toggleRole("whitelistRoles", id)} />
      </Section>

      <Section icon={ShieldCheck} title="4. Cargos protegidos" description="Restaura cargos importantes removidos indevidamente quando a recuperação estiver ativa.">
        <RoleChecklist title="Selecione Dono, Admin, Gerência ou Staff" roles={roles} selected={draft.protectedRoles} disabled={disabled} onToggle={(id) => toggleRole("protectedRoles", id)} />
      </Section>

      <Section icon={AlertTriangle} title="5. Ações automáticas" description="Resposta aplicada somente após validar whitelist, dono e hierarquia.">
        <SelectField label="Ação contra o executor" value={draft.actionOnTrigger} disabled={disabled} onChange={(value) => patch("actionOnTrigger", value as AntiBanConfig["actionOnTrigger"])} options={ACTION_OPTIONS} />
        <SelectField label="Recuperação automática" value={draft.autoRecovery} disabled={disabled} onChange={(value) => patch("autoRecovery", value as AntiBanConfig["autoRecovery"])} options={RECOVERY_OPTIONS} />
      </Section>

      <Section icon={Hash} title="6. Logs e auditoria" description="Todos os eventos são persistidos por bot e servidor.">
        <SelectField label="Canal de logs" value={draft.logChannelId ?? ""} disabled={disabled} onChange={(value) => patch("logChannelId", value || null)} options={[{ value: "", label: "Selecione um canal" }, ...channels.map((channel) => ({ value: channel.id, label: `#${channel.name}` }))]} />
        <InfoBox>{logs.length ? `${logs.length} evento(s) recente(s) carregado(s). Último: ${logs[0]?.actionType}.` : "Nenhum evento Anti Ban registrado ainda."}</InfoBox>
        {logs.length ? <div className="space-y-2 md:col-span-2">{logs.slice(0, 6).map((log) => <div key={log.id} className="grid gap-1 rounded-lg border border-zinc-900 bg-black/50 p-3 text-xs sm:grid-cols-[1fr_auto]"><div><p className="font-semibold text-zinc-200">{log.actionType} · executor {log.executorId ?? "não identificado"}</p><p className="text-zinc-500">{log.amount}/{log.limit} · {log.punishment}{log.errorMessage ? ` · ${log.errorMessage}` : ""}</p></div><span className={log.success ? "text-emerald-400" : "text-red-400"}>{new Date(log.createdAt).toLocaleString("pt-BR")}</span></div>)}</div> : null}
      </Section>

      <div className="flex flex-wrap gap-3"><Button disabled={disabled} onClick={() => void save()}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Salvar configuração</Button><Button variant="secondary" disabled={disabled || !draft.logChannelId} onClick={() => void test()}>{testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}Testar proteção</Button></div>
    </div>
  );
}

const ACTION_OPTIONS = [
  { value: "log_only", label: "Apenas registrar log" }, { value: "remove_admin_roles", label: "Remover cargos administrativos" },
  { value: "kick_executor", label: "Expulsar executor" }, { value: "ban_executor", label: "Banir executor" },
  { value: "remove_dangerous_permissions", label: "Remover permissões perigosas" }, { value: "block_future_actions", label: "Bloquear ações futuras" }
];
const RECOVERY_OPTIONS = [{ value: "alert_only", label: "Apenas alertar" }, { value: "unban", label: "Desbanir vítima automaticamente" }, { value: "restore_permissions", label: "Restaurar cargos/permissões quando possível" }];
const inputClass = "h-11 min-w-0 flex-1 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100 outline-none focus:border-purple-500/60";

function Section({ icon: Icon, title, description, children }: { icon: typeof ShieldCheck; title: string; description: string; children: React.ReactNode }) { return <Card><CardHeader><div className="flex gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-purple-500/25 bg-purple-500/10"><Icon className="h-5 w-5 text-purple-200" /></div><div><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></div></div></CardHeader><CardContent className="grid gap-4 md:grid-cols-2">{children}</CardContent></Card>; }
function ScopeCard({ icon: Icon, label, value }: { icon: typeof Bot; label: string; value: string }) { return <div className="rounded-xl border border-zinc-900 bg-black/60 p-4"><div className="flex items-center gap-3"><Icon className="h-5 w-5 text-purple-300" /><div><p className="text-xs text-zinc-500">{label}</p><p className="break-all text-sm font-semibold text-zinc-100">{value}</p></div></div></div>; }
function NumberField({ label, value, min, max, disabled, onChange }: { label: string; value: number; min: number; max: number; disabled: boolean; onChange: (value: number) => void }) { return <label className="grid gap-2 text-sm"><span className="flex items-center gap-2 font-medium text-zinc-200"><Clock3 className="h-4 w-4 text-zinc-500" />{label}</span><input className={inputClass} type="number" min={min} max={max} disabled={disabled} value={value} onChange={(event) => onChange(Math.max(min, Math.min(max, Number(event.target.value) || min)))} /></label>; }
function SelectField({ label, value, disabled, onChange, options }: { label: string; value: string; disabled: boolean; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) { return <label className="grid gap-2 text-sm"><span className="font-medium text-zinc-200">{label}</span><select className={inputClass} disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>; }
function RoleChecklist({ title, roles, selected, disabled, onToggle }: { title: string; roles: GuildRoleOption[]; selected: string[]; disabled: boolean; onToggle: (id: string) => void }) { return <div className="space-y-2 md:col-span-2"><p className="text-sm font-medium text-zinc-200">{title}</p><div className="grid max-h-56 gap-2 overflow-y-auto rounded-lg border border-zinc-900 bg-black/50 p-3 sm:grid-cols-2">{roles.map((role) => <label key={role.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-900 p-2 text-sm text-zinc-300"><input type="checkbox" disabled={disabled} checked={selected.includes(role.id)} onChange={() => onToggle(role.id)} />{role.name}{!role.assignable ? <span className="ml-auto text-[10px] text-amber-400">acima do bot</span> : null}</label>)}</div></div>; }
function InfoBox({ children }: { children: React.ReactNode }) { return <div className="flex items-center gap-2 rounded-lg border border-zinc-900 bg-zinc-950 p-3 text-sm text-zinc-400"><CheckCircle2 className="h-4 w-4 text-purple-300" />{children}</div>; }
function Message({ tone, children }: { tone: "success" | "error"; children: React.ReactNode }) { return <div className={`rounded-lg border px-4 py-3 text-sm ${tone === "success" ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-100" : "border-red-500/25 bg-red-500/10 text-red-100"}`}>{children}</div>; }
function readError(error: unknown, fallback: string) { const candidate = error as { response?: { data?: { message?: string } }; message?: string }; return candidate.response?.data?.message || candidate.message || fallback; }
