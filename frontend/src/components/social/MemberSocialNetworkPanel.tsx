import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  Globe2,
  Link2,
  Loader2,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  Trash2,
  Unplug,
  Users
} from "lucide-react";
import {
  createSocialMember,
  deleteSocialMember,
  getGuildLiveOptions,
  getMemberSocialNetwork,
  publishSocialPanel,
  removeSocialPanel,
  saveSocialPanel,
  testSocialPanel,
  updateSocialMember
} from "../../lib/api";
import type {
  DashboardGuild,
  GuildLiveOptions,
  SocialLinks,
  SocialMember,
  SocialMemberPayload,
  SocialPanel,
  SocialPlatform
} from "../../types";
import { Avatar } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Field, ModalShell } from "./AddTwitchChannelModal";

type MemberSocialNetworkPanelProps = {
  botId?: string | null;
  canManage: boolean;
  guild: DashboardGuild | null;
};

type MemberFormState = {
  avatar: string;
  discordId: string;
  links: SocialLinks;
  name: string;
  role: string;
};

const DEFAULT_EMBED_COLOR = "#00D4FF";
const emptyLinks: SocialLinks = {
  facebook: "",
  instagram: "",
  kick: "",
  tiktok: "",
  twitch: "",
  twitter: "",
  website: "",
  youtube: ""
};

const socialFields: Array<{
  id: SocialPlatform;
  label: string;
  placeholder: string;
}> = [
  {
    id: "twitter",
    label: "X (Twitter)",
    placeholder: "https://x.com/corteizgg"
  },
  {
    id: "instagram",
    label: "Instagram",
    placeholder: "https://instagram.com/corteiz.gg"
  },
  {
    id: "twitch",
    label: "Twitch",
    placeholder: "https://twitch.tv/corteiz"
  },
  {
    id: "youtube",
    label: "YouTube",
    placeholder: "https://youtube.com/@corteiz"
  },
  {
    id: "tiktok",
    label: "TikTok",
    placeholder: "https://tiktok.com/@corteiz"
  },
  {
    id: "kick",
    label: "Kick",
    placeholder: "https://kick.com/corteiz"
  },
  {
    id: "facebook",
    label: "Facebook",
    placeholder: "https://facebook.com/corteiz"
  },
  {
    id: "website",
    label: "Site Pessoal",
    placeholder: "https://corteiz.gg"
  }
];

export function MemberSocialNetworkPanel({ botId, canManage, guild }: MemberSocialNetworkPanelProps) {
  const [members, setMembers] = useState<SocialMember[]>([]);
  const [panel, setPanel] = useState<SocialPanel | null>(null);
  const [options, setOptions] = useState<GuildLiveOptions>({ channels: [], roles: [] });
  const [channelId, setChannelId] = useState("");
  const [embedColor, setEmbedColor] = useState(DEFAULT_EMBED_COLOR);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<SocialMember | null>(null);

  const totalLinks = useMemo(
    () => members.reduce((total, member) => total + activeLinks(member).length, 0),
    [members]
  );

  useEffect(() => {
    setMembers([]);
    setPanel(null);
    setChannelId("");
    setEmbedColor(DEFAULT_EMBED_COLOR);
    setStatus(null);
    setError(null);
  }, [botId, guild?.id]);

  useEffect(() => {
    if (!canManage || !guild) {
      setOptions({ channels: [], roles: [] });
      return;
    }

    let cancelled = false;

    getGuildLiveOptions(guild.id, botId)
      .then((nextOptions) => {
        if (!cancelled) {
          setOptions(nextOptions);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOptions({ channels: [], roles: [] });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [botId, canManage, guild?.id]);

  useEffect(() => {
    if (!canManage || !guild) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    getMemberSocialNetwork(guild.id, botId)
      .then((network) => {
        if (cancelled) {
          return;
        }

        setMembers(network.members);
        setPanel(network.panel);
        setChannelId(network.panel?.channelId ?? "");
        setEmbedColor(network.panel?.embedColor ?? DEFAULT_EMBED_COLOR);
      })
      .catch((requestError) => {
        if (!cancelled) {
          setError(readErrorMessage(requestError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [botId, canManage, guild?.id]);

  useEffect(() => {
    if (channelId || panel?.channelId || !options.channels.length) {
      return;
    }

    setChannelId(options.channels[0]?.id ?? "");
  }, [channelId, options.channels, panel?.channelId]);

  async function handleCreate(payload: SocialMemberPayload) {
    if (!guild) {
      return;
    }

    setSaving(true);
    setError(null);
    setStatus(null);

    try {
      const member = await createSocialMember(guild.id, payload, botId);
      setMembers((current) => [member, ...current]);
      setAddOpen(false);
      await refreshPublishedPanel(panel);
      setStatus("Membro adicionado na Network.");
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdate(payload: SocialMemberPayload) {
    if (!guild || !editing) {
      return;
    }

    setSaving(true);
    setError(null);
    setStatus(null);

    try {
      const member = await updateSocialMember(guild.id, editing.id, payload, botId);
      setMembers((current) => current.map((item) => (item.id === member.id ? member : item)));
      setEditing(null);
      await refreshPublishedPanel(panel);
      setStatus("Membro atualizado e painel sincronizado.");
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(member: SocialMember) {
    if (!guild || !window.confirm(`Excluir ${member.name} da Network?`)) {
      return;
    }

    setSaving(true);
    setError(null);
    setStatus(null);

    try {
      await deleteSocialMember(guild.id, member.id, botId);
      setMembers((current) => current.filter((item) => item.id !== member.id));
      await refreshPublishedPanel(panel);
      setStatus("Membro removido da Network.");
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setSaving(false);
    }
  }

  async function handleSavePanel() {
    if (!guild || !channelId) {
      setError("Selecione o canal da Network.");
      return;
    }

    setPublishing(true);
    setError(null);
    setStatus(null);

    try {
      const nextPanel = await saveSocialPanel(guild.id, {
        channelId,
        embedColor
      }, botId);
      setPanel(nextPanel);
      setStatus("Canal da Network salvo.");
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setPublishing(false);
    }
  }

  async function handlePublishPanel() {
    if (!guild || !channelId) {
      setError("Selecione o canal da Network.");
      return;
    }

    setPublishing(true);
    setError(null);
    setStatus(null);

    try {
      const network = await publishSocialPanel(guild.id, {
        channelId,
        embedColor
      }, botId);
      setMembers(network.members);
      setPanel(network.panel);
      setStatus(panel?.published ? "Painel Network atualizado no Discord." : "Painel Network publicado no Discord.");
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setPublishing(false);
    }
  }

  async function handleTestPanel() {
    if (!guild || !channelId) {
      setError("Selecione o canal da Network.");
      return;
    }

    setTesting(true);
    setError(null);
    setStatus(null);

    try {
      await testSocialPanel(guild.id, {
        channelId,
        embedColor
      }, botId);
      setStatus("Painel Network enviado para teste no Discord.");
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setTesting(false);
    }
  }

  async function handleRemovePanel() {
    if (!guild) {
      return;
    }

    setRemoving(true);
    setError(null);
    setStatus(null);

    try {
      const nextPanel = await removeSocialPanel(guild.id, botId);
      setPanel(nextPanel);
      setStatus("Pedido de remoção do painel enviado ao bot.");
    } catch (requestError) {
      setError(readErrorMessage(requestError));
    } finally {
      setRemoving(false);
    }
  }

  async function refreshPublishedPanel(currentPanel: SocialPanel | null) {
    if (!guild || !currentPanel?.published || !currentPanel.channelId) {
      return;
    }

    const network = await publishSocialPanel(guild.id, {
      channelId: currentPanel.channelId,
      embedColor: currentPanel.embedColor
    }, botId).catch(() => null);

    if (network) {
      setMembers(network.members);
      setPanel(network.panel);
    }
  }

  if (!canManage) {
    return (
      <Card>
        <CardContent className="p-5 text-sm leading-6 text-zinc-500">
          Sua conta tem visualização básica. A Rede Social dos Membros fica disponível apenas para administradores ou equipe autorizada.
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-cyan-400/30 bg-cyan-400/10 text-cyan-100">
            <Globe2 className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h3 className="text-xl font-semibold text-white">Rede Social dos Membros</h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-500">
              Cadastre membros, organize links e publique uma embed unica no canal da comunidade.
            </p>
          </div>
        </div>

        <div className="grid gap-2 text-sm text-zinc-500 sm:grid-cols-2">
          <StatPill icon={Users} label="Membros" value={members.length.toLocaleString("pt-BR")} />
          <StatPill icon={Link2} label="Links" value={totalLinks.toLocaleString("pt-BR")} />
        </div>
      </div>

      {loading ? <NetworkSkeleton /> : null}
      {status ? <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">{status}</div> : null}
      {error ? <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm text-white">{error}</div> : null}

      <Card>
        <CardHeader className="border-b border-zinc-900">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-cyan-300" />
                Painel no Discord
              </CardTitle>
              <CardDescription>
                Selecione o canal, publique e o bot passara a editar a mesma mensagem automaticamente.
              </CardDescription>
            </div>
            <Badge variant={panel?.published ? "success" : "muted"}>
              {panel?.published ? "Publicado" : "Não publicado"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_180px]">
            <Field label="Canal">
              {options.channels.length ? (
                <select className="social-input h-12" onChange={(event) => setChannelId(event.target.value)} value={channelId}>
                  <option value="">Selecione o canal</option>
                  {options.channels.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      #{channel.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="social-input h-12"
                  inputMode="numeric"
                  onChange={(event) => setChannelId(event.target.value.replace(/\D/g, ""))}
                  placeholder="ID do canal Discord"
                  value={channelId}
                />
              )}
            </Field>

            <Field label="Cor da embed">
              <div className="flex h-12 items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-3">
                <input
                  className="h-8 w-10 rounded border border-zinc-700 bg-transparent p-1"
                  onChange={(event) => setEmbedColor(event.target.value)}
                  type="color"
                  value={embedColor}
                />
                <span className="font-mono text-xs text-zinc-500">{embedColor}</span>
              </div>
            </Field>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-zinc-900 pt-4">
            <Button disabled={publishing || !channelId} onClick={handleSavePanel} type="button" variant="outline">
              {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Settings2 className="h-4 w-4" />}
              Salvar Canal
            </Button>
            <Button disabled={testing || !channelId} onClick={handleTestPanel} type="button" variant="outline">
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Testar Painel
            </Button>
            <Button disabled={publishing || !channelId} onClick={handlePublishPanel} type="button">
              {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : panel?.published ? <RefreshCw className="h-4 w-4" /> : <Send className="h-4 w-4" />}
              {panel?.published ? "Atualizar Painel" : "Publicar Painel"}
            </Button>
            <Button disabled={removing || !panel?.messageId} onClick={handleRemovePanel} type="button" variant="destructive">
              {removing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}
              Remover Painel
            </Button>
          </div>

          {panel?.messageId ? (
            <p className="truncate rounded-lg border border-zinc-900 bg-black/35 px-3 py-2 font-mono text-xs text-zinc-500">
              Mensagem Discord: {panel.messageId}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-zinc-900">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Lista de Membros</CardTitle>
              <CardDescription>Avatar, nome e redes cadastradas para aparecerem na embed.</CardDescription>
            </div>
            <Button disabled={saving} onClick={() => setAddOpen(true)} type="button">
              <Plus className="h-4 w-4" />
              Adicionar Membro
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          {members.length ? (
            <div className="space-y-3">
              {members.map((member) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  onDelete={() => void handleDelete(member)}
                  onEdit={() => {
                    setError(null);
                    setEditing(member);
                  }}
                  saving={saving}
                />
              ))}
            </div>
          ) : (
            <div className="flex min-h-44 flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950/60 p-6 text-center">
              <Globe2 className="mb-3 h-8 w-8 text-zinc-500" />
              <p className="text-sm font-medium text-zinc-300">Nenhum membro cadastrado</p>
              <p className="mt-1 text-sm text-zinc-500">Adicione o primeiro membro para montar a Network.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <MemberFormModal
        error={error}
        member={null}
        onClose={() => setAddOpen(false)}
        onSubmit={handleCreate}
        open={addOpen}
        saving={saving}
      />
      <MemberFormModal
        error={error}
        member={editing}
        onClose={() => setEditing(null)}
        onSubmit={handleUpdate}
        open={Boolean(editing)}
        saving={saving}
      />
    </section>
  );
}

function MemberRow({
  member,
  onDelete,
  onEdit,
  saving
}: {
  member: SocialMember;
  onDelete: () => void;
  onEdit: () => void;
  saving: boolean;
}) {
  const links = activeLinks(member);

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-zinc-900 bg-zinc-950/70 p-4 transition duration-300 hover:border-zinc-700 hover:bg-zinc-900/70 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 items-center gap-4">
        <Avatar className="h-14 w-14 rounded-lg border border-zinc-800" fallback={member.name} src={member.avatar} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-base font-semibold text-white">{member.name}</p>
            {member.role ? <Badge variant="muted">{member.role}</Badge> : null}
          </div>
          <p className="mt-1 truncate text-xs text-zinc-500">
            {member.discordId ? `Discord ID: ${member.discordId}` : "Discord ID opcional"}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {links.length ? (
              links.map((link) => (
                <a
                  className="rounded-full border border-zinc-800 bg-black px-3 py-1 text-xs font-medium text-zinc-300 transition hover:border-cyan-400/50 hover:text-white"
                  href={link.url}
                  key={link.id}
                  rel="noreferrer"
                  target="_blank"
                >
                  {link.label}
                </a>
              ))
            ) : (
              <span className="rounded-full border border-zinc-800 bg-black px-3 py-1 text-xs text-zinc-500">Sem redes</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 gap-2">
        <Button disabled={saving} onClick={onEdit} size="sm" type="button" variant="outline">
          <Pencil className="h-4 w-4" />
          Editar
        </Button>
        <Button disabled={saving} onClick={onDelete} size="sm" type="button" variant="destructive">
          <Trash2 className="h-4 w-4" />
          Excluir
        </Button>
      </div>
    </div>
  );
}

function MemberFormModal({
  error,
  member,
  onClose,
  onSubmit,
  open,
  saving
}: {
  error: string | null;
  member: SocialMember | null;
  onClose: () => void;
  onSubmit: (payload: SocialMemberPayload) => void;
  open: boolean;
  saving: boolean;
}) {
  const [form, setForm] = useState<MemberFormState>(() => formFromMember(member));

  useEffect(() => {
    if (open) {
      setForm(formFromMember(member));
    }
  }, [member, open]);

  const canSave = Boolean(form.name.trim()) && !saving;

  if (!open) {
    return null;
  }

  return (
    <ModalShell onClose={onClose} title={member ? "Editar Membro" : "Adicionar Membro"}>
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault();

          if (!canSave) {
            return;
          }

          onSubmit({
            avatar: form.avatar || null,
            discordId: form.discordId || null,
            links: form.links,
            name: form.name,
            role: form.role || null
          });
        }}
      >
        <div className="grid gap-4 md:grid-cols-[96px_minmax(0,1fr)]">
          <div className="flex flex-col items-center gap-2 rounded-lg border border-zinc-900 bg-zinc-950/60 p-3">
            <Avatar className="h-16 w-16 rounded-lg border border-zinc-800" fallback={form.name || "M"} src={form.avatar || null} />
            <span className="text-center text-xs text-zinc-500">Avatar</span>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nome do membro">
              <input
                className="social-input"
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Corteiz"
                required
                value={form.name}
              />
            </Field>
            <Field label="Discord ID (opcional)">
              <input
                className="social-input"
                inputMode="numeric"
                onChange={(event) => setForm((current) => ({ ...current, discordId: event.target.value.replace(/\D/g, "") }))}
                placeholder="123456789012345678"
                value={form.discordId}
              />
            </Field>
            <Field label="Cargo (opcional)">
              <input
                className="social-input"
                onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))}
                placeholder="Staff, Streamer, Membro"
                value={form.role}
              />
            </Field>
            <Field label="Avatar URL">
              <input
                className="social-input"
                onChange={(event) => setForm((current) => ({ ...current, avatar: event.target.value }))}
                placeholder="https://cdn.discordapp.com/..."
                type="url"
                value={form.avatar}
              />
            </Field>
          </div>
        </div>

        <div>
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
            <Link2 className="h-4 w-4 text-cyan-300" />
            Adicionar Redes
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {socialFields.map((field) => (
              <Field key={field.id} label={field.label}>
                <input
                  className="social-input"
                  onChange={(event) => updateLink(setForm, field.id, event.target.value)}
                  placeholder={field.placeholder}
                  type="url"
                  value={form.links[field.id]}
                />
              </Field>
            ))}
          </div>
        </div>

        {error ? <p className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm text-white">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <Button onClick={onClose} type="button" variant="outline">Cancelar</Button>
          <Button disabled={!canSave} type="submit">
            {saving ? "Salvando..." : member ? "Salvar membro" : "Adicionar membro"}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

function StatPill({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-900 bg-zinc-950/75 px-4 py-2">
      <Icon className="h-4 w-4 text-zinc-400" />
      <span>{label}: <span className="font-semibold text-white">{value}</span></span>
    </div>
  );
}

function NetworkSkeleton() {
  return (
    <div className="space-y-3 rounded-lg border border-zinc-900 bg-zinc-950/75 p-5">
      {[0, 1, 2].map((item) => (
        <div className="flex animate-pulse items-center gap-4" key={item}>
          <div className="h-14 w-14 rounded-lg bg-zinc-800" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-40 rounded bg-zinc-800" />
            <div className="h-3 w-full max-w-xl rounded bg-zinc-900" />
          </div>
        </div>
      ))}
    </div>
  );
}

function formFromMember(member: SocialMember | null): MemberFormState {
  return {
    avatar: member?.avatar ?? "",
    discordId: member?.discordId ?? "",
    links: {
      ...emptyLinks,
      ...(member?.links ?? {})
    },
    name: member?.name ?? "",
    role: member?.role ?? ""
  };
}

function updateLink(setForm: Dispatch<SetStateAction<MemberFormState>>, platform: SocialPlatform, value: string) {
  setForm((current) => ({
    ...current,
    links: {
      ...current.links,
      [platform]: value
    }
  }));
}

function activeLinks(member: SocialMember) {
  return socialFields
    .map((field) => ({
      id: field.id,
      label: field.label,
      url: member.links[field.id]?.trim() ?? ""
    }))
    .filter((link) => Boolean(link.url));
}

function readErrorMessage(error: unknown) {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message ?? "Não foi possível concluir a ação.";
  }

  return "Não foi possível concluir a ação.";
}
