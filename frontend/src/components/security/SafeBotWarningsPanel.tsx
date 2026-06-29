import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, Save, ShieldAlert, Trash2 } from "lucide-react";
import { getSafeBotWarnings, removeSafeBotWarning, resetSafeBotWarnings, saveSafeBotWarningNote, saveSafeBotWarningSettings } from "../../lib/api";
import { createDashboardSocket } from "../../lib/socket";
import type { GuildChannelOption, GuildRoleOption, SafeBotWarningAction, SafeBotWarningDashboard, SafeBotWarningLevel, SafeBotWarningSettings } from "../../types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";

const actions: Array<{ id: SafeBotWarningAction | ""; label: string }> = [
  { id: "", label: "No action (record only)" }, { id: "record_only", label: "Record only" },
  { id: "dm", label: "Send private message" }, { id: "channel_message", label: "Send channel message" },
  { id: "add_role", label: "Add warning role" }, { id: "remove_role", label: "Remove role" },
  { id: "timeout", label: "Temporary timeout" }, { id: "kick", label: "Kick" }, { id: "ban", label: "Ban" },
  { id: "notify_staff", label: "Notify staff" }, { id: "open_ticket", label: "Open automatic ticket" },
  { id: "block_channels", label: "Block channel access" }, { id: "custom", label: "Configured custom notice" }
];

export function SafeBotWarningsPanel({ botId, canManage, channels, guildId, roles }: {
  botId: string | null; canManage: boolean; channels: GuildChannelOption[]; guildId: string; roles: GuildRoleOption[];
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
    } catch (error) { setMessage(readError(error)); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, [botId, guildId]);
  useEffect(() => {
    if (!botId) return;
    const socket = createDashboardSocket();
    socket.on("safe-bot:warnings_updated", (payload: { botId?: string; guildId?: string }) => {
      if (payload.botId === botId && payload.guildId === guildId) void load();
    });
    return () => { socket.disconnect(); };
  }, [botId, guildId]);

  function update(patch: Partial<SafeBotWarningSettings>) { setSettings((current) => current ? { ...current, ...patch } : current); }
  function updateLevel(index: number, next: SafeBotWarningLevel) { if (settings) update({ levels: settings.levels.map((level, i) => i === index ? next : level) }); }
  function addLevel() { if (settings) update({ levels: [...settings.levels, newLevel(settings.levels.length + 1)] }); }
  function removeLevel(index: number) { if (settings) update({ levels: settings.levels.filter((_, i) => i !== index).map((level, i) => ({ ...level, number: i + 1 })) }); }
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
    setSaving(true); setMessage(null);
    try {
      const saved = await saveSafeBotWarningSettings(guildId, botId, settings);
      setSettings(saved); setMessage("Warning configuration saved.");
      await load();
    } catch (error) { setMessage(readError(error)); }
    finally { setSaving(false); }
  }

  if (loading) return <Card><CardContent className="flex min-h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></CardContent></Card>;
  if (!settings || !botId) return null;
  const disabled = !canManage || saving;

  return (
    <div className="space-y-5">
      {message ? <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-200">{message}</div> : null}
      <Card className="hover:translate-y-0">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div><CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5" />Warning Configuration</CardTitle><CardDescription>Actions only run when this system and an exact level are explicitly configured.</CardDescription></div>
            <div className="flex items-center gap-2"><Badge variant={settings.enabled ? "success" : "muted"}>{settings.enabled ? "Enabled" : "Disabled"}</Badge><Switch checked={settings.enabled} disabled={disabled} onCheckedChange={(enabled) => update({ enabled })} /></div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Select label="Default warning log channel" value={settings.defaultLogChannelId ?? ""} disabled={disabled} onChange={(value) => update({ defaultLogChannelId: value || null })} options={channels.map((channel) => ({ value: channel.id, label: `#${channel.name}` }))} />
            <Select label="After the last configured level" value={settings.overflowMode} disabled={disabled} onChange={(value) => {
              const overflowMode = value as SafeBotWarningSettings["overflowMode"];
              update({ overflowMode, finalLevel: overflowMode === "final_action" ? settings.finalLevel ?? newLevel(settings.levels.length + 1, "Final action") : settings.finalLevel });
            }} options={[{ value: "record_only", label: "Record only" }, { value: "repeat_last", label: "Repeat last action" }, { value: "block", label: "Block new warnings" }, { value: "final_action", label: "Use configured final action" }]} />
          </div>

          <RoleChecklist disabled={disabled} label="Roles authorized to issue warnings" roles={roles} selected={settings.authorizedRoleIds} onChange={(authorizedRoleIds) => update({ authorizedRoleIds })} />

          <div className="space-y-3">
            <div className="flex items-center justify-between"><div><p className="font-semibold text-white">Warning levels</p><p className="text-xs text-zinc-500">Create, edit, delete, and reorder as many levels as this server needs.</p></div><Button disabled={disabled || settings.levels.length >= 50} onClick={addLevel} variant="outline"><Plus className="h-4 w-4" />Add level</Button></div>
            {settings.levels.length ? settings.levels.map((level, index) => (
              <WarningLevelEditor key={level.id} level={level} disabled={disabled} channels={channels} roles={roles} onChange={(next) => updateLevel(index, next)} onDelete={() => removeLevel(index)} onMoveDown={() => moveLevel(index, 1)} onMoveUp={() => moveLevel(index, -1)} />
            )) : <div className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-sm text-zinc-500">No levels configured. Warnings cannot be issued.</div>}
          </div>

          {settings.overflowMode === "final_action" && settings.finalLevel ? (
            <div className="space-y-2"><p className="font-semibold text-white">Final configured action</p><WarningLevelEditor level={settings.finalLevel} disabled={disabled} channels={channels} roles={roles} onChange={(finalLevel) => update({ finalLevel })} /></div>
          ) : null}

          <Button disabled={disabled} onClick={() => void save()}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save warning system</Button>
        </CardContent>
      </Card>

      <section className="grid gap-5 xl:grid-cols-2">
        <Card className="hover:translate-y-0"><CardHeader><CardTitle>Most warned users</CardTitle></CardHeader><CardContent className="space-y-3">
          {dashboard?.users.length ? dashboard.users.map((user) => <div className="rounded-lg border border-zinc-900 bg-zinc-950/60 p-3" key={user.userId}>
            <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-white">{user.username ?? user.userId}</p><p className="text-xs text-zinc-500">{user.userId}</p></div><Badge variant={user.totalWarnings ? "warning" : "muted"}>{user.totalWarnings} warning(s)</Badge></div>
            <textarea className="mt-3 min-h-16 w-full rounded-md border border-zinc-800 bg-black p-2 text-xs text-zinc-200" defaultValue={user.internalNote} disabled={disabled} id={`note-${user.userId}`} placeholder="Internal staff note" />
            <div className="mt-2 flex gap-2"><Button size="sm" variant="outline" disabled={disabled} onClick={() => void saveNote(user.userId)}>Save note</Button><Button size="sm" variant="destructive" disabled={disabled || user.totalWarnings === 0} onClick={() => void resetUser(user.userId)}>Reset warnings</Button></div>
          </div>) : <p className="py-8 text-center text-sm text-zinc-500">No warned users.</p>}
        </CardContent></Card>
        <Card className="hover:translate-y-0"><CardHeader><CardTitle>Warning history</CardTitle></CardHeader><CardContent className="max-h-[620px] space-y-2 overflow-y-auto">
          {dashboard?.warnings.length ? dashboard.warnings.map((warning) => <div className="rounded-lg border border-zinc-900 bg-zinc-950/60 p-3" key={warning.id}>
            <div className="flex justify-between gap-3"><div><p className="text-sm font-semibold text-white">#{warning.warningNumber} • {warning.level?.name ?? "Unconfigured level"}</p><p className="text-xs text-zinc-500">{warning.username ?? warning.userId} • staff {warning.staffName ?? warning.staffId}</p></div><Badge variant={warning.status === "failed" ? "danger" : warning.status === "removed" ? "muted" : "success"}>{warning.status}</Badge></div>
            <p className="mt-2 text-sm text-zinc-300">{warning.reason}</p><p className="mt-1 text-xs text-zinc-500">Action: {warning.executedAction ?? warning.configuredAction ?? "record only"} • {new Date(warning.createdAt).toLocaleString()}</p>{warning.error ? <p className="mt-1 text-xs text-red-300">{warning.error}</p> : null}
            {warning.status !== "removed" ? <Button className="mt-2" size="sm" variant="outline" disabled={disabled} onClick={() => void removeWarning(warning.id)}><Trash2 className="h-3.5 w-3.5" />Remove</Button> : null}
          </div>) : <p className="py-8 text-center text-sm text-zinc-500">No warning history.</p>}
        </CardContent></Card>
      </section>
    </div>
  );

  async function removeWarning(id: string) { await removeSafeBotWarning(guildId, botId!, id); await load(); }
  async function resetUser(userId: string) { await resetSafeBotWarnings(guildId, botId!, userId); await load(); }
  async function saveNote(userId: string) { const node = document.getElementById(`note-${userId}`) as HTMLTextAreaElement | null; await saveSafeBotWarningNote(guildId, botId!, userId, node?.value ?? ""); setMessage("Internal note saved."); await load(); }
}

function WarningLevelEditor({ level, disabled, channels, roles, onChange, onDelete, onMoveDown, onMoveUp }: {
  level: SafeBotWarningLevel; disabled: boolean; channels: GuildChannelOption[]; roles: GuildRoleOption[]; onChange: (level: SafeBotWarningLevel) => void; onDelete?: () => void; onMoveDown?: () => void; onMoveUp?: () => void;
}) {
  const patch = (next: Partial<SafeBotWarningLevel>) => onChange({ ...level, ...next });
  const needsRole = level.action === "add_role" || level.action === "remove_role";
  const needsChannel = level.action === "channel_message" || level.action === "notify_staff" || level.action === "open_ticket" || level.action === "custom";
  return <div className="rounded-lg border border-zinc-800 bg-zinc-950/65 p-4 space-y-4">
    <div className="flex flex-wrap items-center gap-2"><input className="h-10 w-20 rounded-md border border-zinc-800 bg-black px-2" type="number" min={1} value={level.number} disabled={disabled} onChange={(event) => patch({ number: Number(event.target.value) })} /><input className="h-10 min-w-52 flex-1 rounded-md border border-zinc-800 bg-black px-3" value={level.name} disabled={disabled} onChange={(event) => patch({ name: event.target.value })} /><Switch checked={level.enabled} disabled={disabled} onCheckedChange={(enabled) => patch({ enabled })} />{onMoveUp ? <Button size="sm" variant="outline" disabled={disabled} onClick={onMoveUp}><ArrowUp className="h-4 w-4" /></Button> : null}{onMoveDown ? <Button size="sm" variant="outline" disabled={disabled} onClick={onMoveDown}><ArrowDown className="h-4 w-4" /></Button> : null}{onDelete ? <Button size="sm" variant="destructive" disabled={disabled} onClick={onDelete}><Trash2 className="h-4 w-4" /></Button> : null}</div>
    <div className="grid gap-3 md:grid-cols-2"><Text label="Description" value={level.description} disabled={disabled} onChange={(description) => patch({ description })} /><Text label="Default reason" value={level.defaultReason} disabled={disabled} onChange={(defaultReason) => patch({ defaultReason })} /><Select label="Configured action" value={level.action ?? ""} disabled={disabled} onChange={(value) => patch({ action: value ? value as SafeBotWarningAction : null })} options={actions.map((action) => ({ value: action.id, label: action.label }))} /><Select label="Log channel" value={level.logChannelId ?? ""} disabled={disabled} onChange={(value) => patch({ logChannelId: value || null })} options={channels.map((channel) => ({ value: channel.id, label: `#${channel.name}` }))} /></div>
    {level.action === "timeout" ? <Text label="Duration in seconds" type="number" value={String(level.durationSeconds ?? 300)} disabled={disabled} onChange={(value) => patch({ durationSeconds: Number(value) || null })} /> : null}
    {needsRole ? <Select label="Configured role" value={level.roleId ?? ""} disabled={disabled} onChange={(value) => patch({ roleId: value || null })} options={roles.map((role) => ({ value: role.id, label: `@${role.name}` }))} /> : null}
    {needsChannel ? <Select label={level.action === "open_ticket" ? "Ticket category or channel reference" : "Action channel"} value={level.channelId ?? ""} disabled={disabled} onChange={(value) => patch({ channelId: value || null })} options={channels.map((channel) => ({ value: channel.id, label: `#${channel.name}` }))} /> : null}
    {level.action === "block_channels" ? <RoleChecklist disabled={disabled} label="Channels to block" roles={channels} selected={level.targetChannelIds} onChange={(targetChannelIds) => patch({ targetChannelIds })} prefix="#" /> : null}
    <div className="grid gap-3 md:grid-cols-2"><Text area label="Message for the user" value={level.userMessage} disabled={disabled} onChange={(userMessage) => patch({ userMessage })} /><Text area label="Message for staff" value={level.staffMessage} disabled={disabled} onChange={(staffMessage) => patch({ staffMessage })} /></div>
    {level.action === "custom" ? <Text area label="Exact custom action notice" value={level.customAction} disabled={disabled} onChange={(customAction) => patch({ customAction })} /> : null}
  </div>;
}

function newLevel(number: number, name = `Warning ${number}`): SafeBotWarningLevel { return { id: crypto.randomUUID(), number, name, description: "", defaultReason: "", action: null, durationSeconds: null, roleId: null, channelId: null, targetChannelIds: [], logChannelId: null, userMessage: "", staffMessage: "", customAction: "", enabled: false }; }
function Select({ label, value, disabled, onChange, options }: { label: string; value: string; disabled: boolean; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) { return <label className="grid gap-2 text-sm"><span className="font-medium text-zinc-200">{label}</span><select className="h-11 rounded-lg border border-zinc-800 bg-zinc-950 px-3" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}><option value="">Not configured</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>; }
function Text({ label, value, disabled, onChange, area = false, type = "text" }: { label: string; value: string; disabled: boolean; onChange: (value: string) => void; area?: boolean; type?: string }) { return <label className="grid gap-2 text-sm"><span className="font-medium text-zinc-200">{label}</span>{area ? <textarea className="min-h-20 rounded-lg border border-zinc-800 bg-black p-3" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} /> : <input className="h-11 rounded-lg border border-zinc-800 bg-black px-3" type={type} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />}</label>; }
function RoleChecklist({ label, roles, selected, disabled, onChange, prefix = "@" }: { label: string; roles: Array<{ id: string; name: string }>; selected: string[]; disabled: boolean; onChange: (ids: string[]) => void; prefix?: string }) { const selectedSet = new Set(selected); return <div><p className="mb-2 text-sm font-medium text-zinc-200">{label}</p><div className="grid max-h-44 gap-2 overflow-y-auto rounded-lg border border-zinc-800 p-3 sm:grid-cols-2">{roles.map((role) => <label className="flex items-center gap-2 text-sm" key={role.id}><input type="checkbox" checked={selectedSet.has(role.id)} disabled={disabled} onChange={() => onChange(selectedSet.has(role.id) ? selected.filter((id) => id !== role.id) : [...selected, role.id])} />{prefix}{role.name}</label>)}</div></div>; }
function readError(error: unknown) { if (typeof error === "object" && error && "response" in error) { const message = (error as { response?: { data?: { message?: unknown } } }).response?.data?.message; if (typeof message === "string") return message; } return error instanceof Error ? error.message : "The warning system request failed."; }
