import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Loader2, MessageCircle, Plus, RefreshCw, Search, Trash2, UserMinus } from "lucide-react";
import { addVisibleMessageUser, clearVisibleMessageUsers, getGuildMemberOptions, getVisibleMessageDashboard, removeVisibleMessageUser } from "../../lib/api";
import { createDashboardSocket } from "../../lib/socket";
import type { DashboardGuild, GuildMemberOption, VisibleMessageDashboard } from "../../types";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";

export function VisibleMessagePanel({ botId, canManage, guild }: { botId?: string | null; canManage: boolean; guild: DashboardGuild | null }) {
  const [data, setData] = useState<VisibleMessageDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<GuildMemberOption[]>([]);
  const [memberLoading, setMemberLoading] = useState(false);

  useEffect(() => {
    if (!botId || !guild) {
      setLoading(false);
      return;
    }

    let mounted = true;
    setLoading(true);
    getVisibleMessageDashboard(guild.id, botId)
      .then((dashboard) => mounted && setData(dashboard))
      .catch((error) => mounted && setMessage(readMessage(error)))
      .finally(() => mounted && setLoading(false));

    return () => {
      mounted = false;
    };
  }, [botId, guild?.id]);

  useEffect(() => {
    if (!botId || !guild) return;
    const socket = createDashboardSocket();
    const refresh = () => {
      void getVisibleMessageDashboard(guild.id, botId).then(setData).catch(() => undefined);
    };

    socket.on("visible-message:users_updated", refresh);

    return () => {
      socket.off("visible-message:users_updated", refresh);
      socket.disconnect();
    };
  }, [botId, guild?.id]);

  const filteredUsers = useMemo(() => {
    const search = query.trim().toLowerCase();
    const users = data?.users ?? [];
    if (!search) return users;
    return users.filter((user) => `${user.username ?? ""} ${user.userId}`.toLowerCase().includes(search));
  }, [data?.users, query]);

  if (!botId || !guild) return <Empty text="Selecione um bot e servidor para configurar Mensagem Visível." />;
  if (loading || !data) return <Empty loading text="Carregando Mensagem Visível..." />;

  async function refresh() {
    setMessage(null);
    const dashboard = await getVisibleMessageDashboard(guild!.id, botId!);
    setData(dashboard);
  }

  async function searchMembers() {
    setMemberLoading(true);
    setMessage(null);
    try {
      setMembers(await getGuildMemberOptions(guild!.id, query, botId));
    } catch (error) {
      setMessage(readMessage(error));
    } finally {
      setMemberLoading(false);
    }
  }

  async function addMember(member: GuildMemberOption) {
    setSaving(true);
    setMessage(null);
    try {
      const user = await addVisibleMessageUser(guild!.id, botId!, {
        avatarUrl: member.avatarUrl,
        userId: member.id,
        username: member.displayName || member.globalName || member.username
      });
      setData((current) => current ? { users: [user, ...current.users.filter((item) => item.userId !== user.userId)] } : current);
      setMessage("Usuário cadastrado para Mensagem Visível.");
    } catch (error) {
      setMessage(readMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function remove(userId: string) {
    setSaving(true);
    setMessage(null);
    try {
      await removeVisibleMessageUser(guild!.id, botId!, userId);
      setData((current) => current ? { users: current.users.filter((item) => item.userId !== userId) } : current);
      setMessage("Usuário removido.");
    } catch (error) {
      setMessage(readMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function clearAll() {
    if (!confirm("Remover todos os usuários da Mensagem Visível?")) return;
    setSaving(true);
    setMessage(null);
    try {
      await clearVisibleMessageUsers(guild!.id, botId!);
      setData({ users: [] });
      setMessage("Lista limpa.");
    } catch (error) {
      setMessage(readMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><MessageCircle className="h-5 w-5 text-emerald-300" />Mensagem Visível</CardTitle>
          <CardDescription>Usuários cadastrados terão mensagens normais reenviadas com nome e avatar próprios via webhook.</CardDescription>
        </CardHeader>
      </Card>

      {message ? <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-white">{message}</div> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Usuários ativos" value={data.users.length} />
        <Metric label="Resultado para cadastrados" value="Usuário" />
        <Metric label="Demais usuários" value="Equipe" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Adicionar usuário</CardTitle>
          <CardDescription>Pesquise por nome ou ID do Discord e cadastre quem poderá enviar mensagem visível.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className="h-10 flex-1 rounded-md border border-zinc-800 bg-[#09090b] px-3 text-sm text-zinc-100 outline-none focus:border-[#FFD500]/60"
              disabled={!canManage || saving}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void searchMembers(); }}
              placeholder="Nome ou ID do usuário"
              value={query}
            />
            <Button disabled={!canManage || memberLoading} onClick={() => void searchMembers()} variant="outline">
              {memberLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Buscar
            </Button>
          </div>
          <div className="grid gap-2 lg:grid-cols-2">
            {members.map((member) => (
              <MemberRow
                actionLabel="Cadastrar"
                disabled={!canManage || saving || data.users.some((user) => user.userId === member.id)}
                icon={<Plus className="h-4 w-4" />}
                key={member.id}
                member={member}
                onAction={() => void addMember(member)}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Usuários cadastrados</CardTitle>
            <CardDescription>Alterações são aplicadas no bot assim que salvar.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button disabled={saving} onClick={() => void refresh()} variant="outline"><RefreshCw className="h-4 w-4" />Atualizar</Button>
            <Button disabled={!canManage || saving || !data.users.length} onClick={() => void clearAll()} variant="destructive"><Trash2 className="h-4 w-4" />Limpar Todos</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {filteredUsers.map((user) => (
            <div className="flex flex-col gap-3 rounded-lg border border-zinc-800 p-3 sm:flex-row sm:items-center sm:justify-between" key={user.userId}>
              <div className="flex min-w-0 items-center gap-3">
                <AvatarImage alt={user.username || user.userId} src={user.avatarUrl} />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-white">{user.username || user.userId}</p>
                  <p className="text-xs text-zinc-500">{user.userId}</p>
                </div>
              </div>
              <Button disabled={!canManage || saving} onClick={() => void remove(user.userId)} size="sm" variant="destructive">
                <UserMinus className="h-4 w-4" />
                Remover
              </Button>
            </div>
          ))}
          {!filteredUsers.length ? <p className="py-8 text-center text-zinc-500">Nenhum usuário cadastrado.</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function MemberRow({ actionLabel, disabled, icon, member, onAction }: { actionLabel: string; disabled: boolean; icon: ReactNode; member: GuildMemberOption; onAction: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 p-3">
      <div className="flex min-w-0 items-center gap-3">
        <AvatarImage alt={member.displayName} src={member.avatarUrl} />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{member.displayName}</p>
          <p className="truncate text-xs text-zinc-500">{member.tag} · {member.id}</p>
        </div>
      </div>
      <Button disabled={disabled} onClick={onAction} size="sm">{icon}{actionLabel}</Button>
    </div>
  );
}

function AvatarImage({ alt, src }: { alt: string; src: string | null }) {
  return src
    ? <img alt={alt} className="h-10 w-10 rounded-full border border-zinc-800 object-cover" src={src} />
    : <div className="flex h-10 w-10 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-xs text-zinc-500">{alt.slice(0, 2).toUpperCase()}</div>;
}

function Empty({ text, loading = false }: { text: string; loading?: boolean }) {
  return <Card><CardContent className="flex min-h-48 items-center justify-center gap-2 text-zinc-400">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : null}{text}</CardContent></Card>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <Card><CardContent className="p-4"><p className="text-xs text-zinc-500">{label}</p><p className="mt-1 text-xl font-bold text-white">{value}</p></CardContent></Card>;
}

function readMessage(error: unknown) {
  return (error as any)?.response?.data?.message ?? "Não foi possível concluir a operação.";
}
