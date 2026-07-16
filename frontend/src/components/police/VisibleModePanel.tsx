import { useEffect, useMemo, useState } from "react";
import { Eye, Loader2, Search, Trash2, UserPlus } from "lucide-react";
import { addVisibleModeUser, clearVisibleModeUsers, getGuildMemberOptions, listVisibleModeUsers, removeVisibleModeUser } from "../../lib/api";
import { createDashboardSocket } from "../../lib/socket";
import type { DashboardGuild, GuildMemberOption, VisibleModeUser } from "../../types";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";

export function VisibleModePanel({ botId, canManage, guild }: { botId?: string | null; canManage: boolean; guild: DashboardGuild | null }) {
  const [users, setUsers] = useState<VisibleModeUser[]>([]);
  const [members, setMembers] = useState<GuildMemberOption[]>([]);
  const [query, setQuery] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const usersById = useMemo(() => new Set(users.map((user) => user.userId)), [users]);

  useEffect(() => {
    if (!botId || !guild) {
      setLoading(false);
      return;
    }

    let mounted = true;
    setLoading(true);
    listVisibleModeUsers(guild.id, botId)
      .then((rows) => mounted && setUsers(rows))
      .catch((error) => mounted && setMessage(readMessage(error)))
      .finally(() => mounted && setLoading(false));

    return () => {
      mounted = false;
    };
  }, [botId, guild?.id]);

  useEffect(() => {
    if (!botId || !guild) return;
    const timer = setTimeout(() => {
      void getGuildMemberOptions(guild.id, query, botId).then(setMembers).catch(() => setMembers([]));
    }, 250);

    return () => clearTimeout(timer);
  }, [botId, guild?.id, query]);

  useEffect(() => {
    if (!botId || !guild) return;
    const socket = createDashboardSocket();
    const refresh = () => void listVisibleModeUsers(guild.id, botId).then(setUsers).catch(() => undefined);

    socket.on("visible-mode:users_updated", refresh);

    return () => {
      socket.off("visible-mode:users_updated", refresh);
      socket.disconnect();
    };
  }, [botId, guild?.id]);

  if (!botId || !guild) return <Empty text="Selecione um bot e servidor para configurar o Modo Visível." />;
  if (loading) return <Empty loading text="Carregando Modo Visível..." />;

  async function addSelected() {
    if (!selectedUserId) return;
    setSaving(true);
    setMessage(null);
    try {
      const user = await addVisibleModeUser(guild!.id, botId!, selectedUserId);
      setUsers((current) => [user, ...current.filter((item) => item.userId !== user.userId)]);
      setSelectedUserId("");
      setMessage("Usuário adicionado ao Modo Visível.");
    } catch (error) {
      setMessage(readMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function removeUser(userId: string) {
    setSaving(true);
    setMessage(null);
    try {
      await removeVisibleModeUser(guild!.id, botId!, userId);
      setUsers((current) => current.filter((item) => item.userId !== userId));
      setMessage("Usuário removido do Modo Visível.");
    } catch (error) {
      setMessage(readMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function clearUsers() {
    if (!confirm("Limpar todos os usuários do Modo Visível?")) return;
    setSaving(true);
    setMessage(null);
    try {
      const result = await clearVisibleModeUsers(guild!.id, botId!);
      setUsers([]);
      setMessage(`${result.removed} usuário(s) removido(s).`);
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
          <CardTitle className="flex items-center gap-2"><Eye className="h-5 w-5 text-emerald-300" />Modo Visível</CardTitle>
          <CardDescription>Usuários cadastrados respondem com a própria mensagem em canais controlados pelo sistema; os demais continuam no modo oculto atual.</CardDescription>
        </CardHeader>
      </Card>

      {message ? <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-white">{message}</div> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Usuários cadastrados" value={users.length} />
        <Metric label="Última alteração" value={users[0] ? new Date(users[0].updatedAt).toLocaleString("pt-BR") : "-"} />
        <Metric label="Escopo" value="Servidor atual" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Adicionar usuário</CardTitle>
          <CardDescription>Pesquise um membro do servidor e adicione à lista do Modo Visível.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <label className="text-xs text-zinc-400">
            Pesquisar
            <div className="mt-1 flex h-10 items-center gap-2 border border-zinc-800 bg-black px-3 text-sm text-white">
              <Search className="h-4 w-4 text-zinc-500" />
              <input className="w-full bg-transparent outline-none" disabled={!canManage || saving} onChange={(event) => setQuery(event.target.value)} placeholder="Nome ou ID" value={query} />
            </div>
          </label>
          <label className="text-xs text-zinc-400">
            Usuário
            <select className="mt-1 h-10 w-full border border-zinc-800 bg-black px-3 text-sm text-white" disabled={!canManage || saving} onChange={(event) => setSelectedUserId(event.target.value)} value={selectedUserId}>
              <option value="">Selecione</option>
              {members.map((member) => <option disabled={usersById.has(member.id)} key={member.id} value={member.id}>{member.displayName || member.username} · {member.id}</option>)}
            </select>
          </label>
          <Button className="self-end" disabled={!canManage || saving || !selectedUserId} onClick={() => void addSelected()}><UserPlus className="h-4 w-4" />Adicionar</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Usuários cadastrados</CardTitle>
          <CardDescription>Lista sincronizada com banco, bot e painel em tempo real.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {users.map((user) => (
            <div className="flex flex-col gap-3 rounded-lg border border-zinc-800 p-3 sm:flex-row sm:items-center sm:justify-between" key={user.id}>
              <div>
                <p className="font-semibold text-white">&lt;@{user.userId}&gt;</p>
                <p className="mt-1 text-xs text-zinc-500">ID {user.userId} · Atualizado em {new Date(user.updatedAt).toLocaleString("pt-BR")}</p>
              </div>
              <Button disabled={!canManage || saving} onClick={() => void removeUser(user.userId)} size="sm" variant="destructive"><Trash2 className="h-4 w-4" />Remover</Button>
            </div>
          ))}
          {!users.length ? <p className="py-8 text-center text-zinc-500">Nenhum usuário cadastrado no Modo Visível.</p> : null}
          <Button disabled={!canManage || saving || !users.length} onClick={() => void clearUsers()} variant="outline"><Trash2 className="h-4 w-4" />Limpar lista</Button>
        </CardContent>
      </Card>
    </div>
  );
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
