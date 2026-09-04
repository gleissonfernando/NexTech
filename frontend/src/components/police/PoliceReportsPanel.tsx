import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, Plus, Save, Send, ShieldCheck, Trash2, XCircle, ArrowDown, ArrowUp } from "lucide-react";
import {
  createPoliceReportsQuestion,
  ensurePoliceReportsForum,
  getGuildLiveOptions,
  getPoliceReportsDashboard,
  movePoliceReportsQuestion,
  publishPoliceReportsPanel,
  savePoliceReportsSettings,
  updatePoliceReportsQuestion,
  deletePoliceReportsQuestion
} from "../../lib/api";
import type {
  DashboardGuild,
  GuildCategoryOption,
  GuildChannelOption,
  GuildRoleOption,
  PoliceReportsDashboard,
  PoliceReportsQuestion,
  PoliceReportsQuestionType,
  PoliceReportsSettings
} from "../../types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Switch } from "../ui/switch";
import { FivemResourceMultiSelect, FivemResourceSelect } from "../fivem/FivemResourceSelect";

const QUESTION_TYPES: Array<{ id: PoliceReportsQuestionType; label: string }> = [
  { id: "TEXT", label: "Texto curto" },
  { id: "LONG_TEXT", label: "Texto longo" },
  { id: "NUMBER", label: "Número" },
  { id: "DATE", label: "Data (dd/mm/aaaa)" },
  { id: "TIME", label: "Horário (HH:MM)" },
  { id: "USER_SELECT", label: "Usuário" },
  { id: "ROLE_SELECT", label: "Cargo" },
  { id: "SELECT", label: "Seleção única" },
  { id: "MULTI_SELECT", label: "Seleção múltipla" },
  { id: "BOOLEAN", label: "Sim/Não" }
];

/** Tipos que usam a lista de opções — o campo só é habilitado para eles. */
const OPTION_BASED_TYPES: PoliceReportsQuestionType[] = ["SELECT", "MULTI_SELECT"];

const emptyQuestionDraft = (): Partial<PoliceReportsQuestion> => ({
  title: "Nova pergunta",
  description: "",
  enabled: true,
  options: [],
  required: true,
  type: "TEXT"
});

export function PoliceReportsPanel({ botId, canManage, guild }: { botId?: string | null; canManage: boolean; guild: DashboardGuild | null }) {
  const [dashboard, setDashboard] = useState<PoliceReportsDashboard | null>(null);
  const [channels, setChannels] = useState<GuildChannelOption[]>([]);
  const [categories, setCategories] = useState<GuildCategoryOption[]>([]);
  const [roles, setRoles] = useState<GuildRoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [questionDraft, setQuestionDraft] = useState<Partial<PoliceReportsQuestion>>(emptyQuestionDraft());
  const settingsRef = useRef<PoliceReportsSettings | null>(null);

  const load = useCallback(async () => {
    if (!botId || !guild) {
      setDashboard(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const [data, options] = await Promise.all([
        getPoliceReportsDashboard(guild.id, botId),
        getGuildLiveOptions(guild.id, botId)
      ]);
      setDashboard(data);
      settingsRef.current = data.settings;
      setChannels(options.channels ?? []);
      setCategories(options.categories ?? []);
      setRoles(options.roles ?? []);
      const firstQuestion = data.questions[0] ?? null;
      setSelectedQuestionId((current) => current && data.questions.some((question) => question.id === current) ? current : firstQuestion?.id ?? null);
    } catch (error) {
      setMessage(readMessage(error));
    } finally {
      setLoading(false);
    }
  }, [botId, guild]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedQuestion = useMemo(
    () => dashboard?.questions.find((question) => question.id === selectedQuestionId) ?? null,
    [dashboard?.questions, selectedQuestionId]
  );
  const disabled = !canManage || saving || publishing;
  const roleOptions = useMemo(() => roles.map((role) => ({ disabled: role.managed, id: role.id, name: role.name })), [roles]);
  const channelOptions = useMemo(() => channels.map((channel) => ({ id: channel.id, name: channel.name })), [channels]);

  useEffect(() => {
    setQuestionDraft(selectedQuestion ? {
      ...selectedQuestion,
      options: [...(selectedQuestion.options ?? [])]
    } : emptyQuestionDraft());
  }, [selectedQuestion]);

  if (!botId || !guild) return <Empty text="Selecione um bot e servidor para configurar os relatórios policiais." />;
  if (loading || !dashboard) return <Empty loading text="Carregando relatórios policiais..." />;
  const currentDashboard = dashboard;
  const currentBotId = botId;
  const currentGuildId = guild.id;

  async function saveSettings() {
    if (!settingsRef.current) return;
    setSaving(true);
    setMessage(null);
    try {
      const settings = await savePoliceReportsSettings(currentGuildId, currentBotId, settingsRef.current);
      settingsRef.current = settings;
      setDashboard((current) => current ? { ...current, settings } : current);
      setMessage("Configurações salvas.");
    } catch (error) {
      setMessage(readMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function ensureForum() {
    setSaving(true);
    setMessage(null);
    try {
      const result = await ensurePoliceReportsForum(currentGuildId, currentBotId);
      settingsRef.current = result.settings;
      setDashboard((current) => current ? { ...current, settings: result.settings } : current);
      setMessage(result.created ? "Fórum de relatórios criado no servidor." : "Fórum de relatórios já existente vinculado ao módulo.");
    } catch (error) {
      setMessage(readMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function publishPanel() {
    if (!settingsRef.current) return;
    setPublishing(true);
    setSaving(true);
    setMessage(null);
    try {
      const saved = await savePoliceReportsSettings(currentGuildId, currentBotId, settingsRef.current);
      settingsRef.current = saved;
      setDashboard((current) => current ? { ...current, settings: saved } : current);
      const result = await publishPoliceReportsPanel(currentGuildId, currentBotId);
      settingsRef.current = result.settings;
      setDashboard((current) => current ? { ...current, settings: result.settings } : current);
      setMessage("Painel publicado no bot.");
    } catch (error) {
      setMessage(readMessage(error));
    } finally {
      setPublishing(false);
      setSaving(false);
    }
  }

  async function saveQuestion() {
    if (!questionDraft) return;
    setSaving(true);
    setMessage(null);
    try {
      if (selectedQuestion) {
        const updated = await updatePoliceReportsQuestion(currentGuildId, currentBotId, selectedQuestion.id, questionPayload(questionDraft));
        setDashboard((current) => current ? { ...current, questions: current.questions.map((question) => question.id === updated.id ? updated : question) } : current);
        setMessage("Pergunta atualizada.");
      } else {
        const created = await createPoliceReportsQuestion(currentGuildId, currentBotId, questionPayload(questionDraft));
        setDashboard((current) => current ? { ...current, questions: [...current.questions, created] } : current);
        setSelectedQuestionId(created.id);
        setMessage("Pergunta criada.");
      }
    } catch (error) {
      setMessage(readMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function removeQuestion(questionId: string) {
    if (!confirm("Remover esta pergunta do módulo?")) return;
    setSaving(true);
    setMessage(null);
    try {
      await deletePoliceReportsQuestion(currentGuildId, currentBotId, questionId);
      setDashboard((current) => current ? { ...current, questions: current.questions.filter((question) => question.id !== questionId) } : current);
      setSelectedQuestionId((current) => current === questionId ? null : current);
      setMessage("Pergunta removida.");
    } catch (error) {
      setMessage(readMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function moveQuestion(questionId: string, direction: "up" | "down") {
    setSaving(true);
    setMessage(null);
    try {
      const questions = await movePoliceReportsQuestion(currentGuildId, currentBotId, questionId, direction);
      setDashboard((current) => current ? { ...current, questions } : current);
      setMessage("Ordem atualizada.");
    } catch (error) {
      setMessage(readMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function createQuestion() {
    setSaving(true);
    setMessage(null);
    try {
      const created = await createPoliceReportsQuestion(currentGuildId, currentBotId, emptyQuestionDraft());
      setDashboard((current) => current ? { ...current, questions: [...current.questions, created] } : current);
      setSelectedQuestionId(created.id);
      setMessage("Nova pergunta criada.");
    } catch (error) {
      setMessage(readMessage(error));
    } finally {
      setSaving(false);
    }
  }

  const ready = currentDashboard.validation.ready;

  function patchSettings(next: Partial<PoliceReportsSettings>) {
    const settings = { ...(settingsRef.current ?? currentDashboard.settings), ...next };
    settingsRef.current = settings;
    setDashboard((current) => current ? { ...current, settings } : current);
  }

  function patchQuestion(next: Partial<PoliceReportsQuestion>) {
    setQuestionDraft((current) => ({ ...current, ...next }));
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-blue-300" />Recrutamento Policial</CardTitle>
              <CardDescription>Configuração do módulo, publicação do painel, perguntas, responsáveis e histórico dos relatórios de recrutamento.</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={currentDashboard.settings.enabled ? "success" : "muted"}>{currentDashboard.settings.enabled ? "Liberado" : "Bloqueado"}</Badge>
              <Badge variant={ready ? "success" : "warning"}>{ready ? "Configurado" : "Configuração pendente"}</Badge>
              <Badge variant={ready ? "success" : "danger"}>{ready ? "Pronto" : "Incompleto"}</Badge>
              <Button disabled={disabled} onClick={() => void saveSettings()} size="sm" type="button">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Salvar
              </Button>
              {/* Habilita pela validação, não por `configured`: quem configura tudo
                  pela dashboard nunca rodou o comando que marcava essa flag. */}
              <Button disabled={disabled || !currentDashboard.settings.enabled || !ready} onClick={() => void publishPanel()} size="sm" title={ready ? "Publicar o painel no canal configurado" : "Complete a validação abaixo para publicar"} type="button" variant="outline">
                {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Publicar painel
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {message ? <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-white">{message}</div> : null}

      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label="Relatórios" value={currentDashboard.stats.reports} />
        <Metric label="Em andamento" value={currentDashboard.stats.inProgress} />
        <Metric label="Responsáveis" value={currentDashboard.stats.responsibles} />
        <Metric label="Mês atual" value={currentDashboard.stats.thisMonth} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuração geral</CardTitle>
          <CardDescription>Use os cargos configurados para autorizar criação, edição e gerenciamento.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2">
          <label className="grid gap-2 text-xs font-medium text-zinc-400">
            <span>Corporação</span>
            <input className="h-10 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus:border-emerald-500/60" disabled={!canManage} value={currentDashboard.settings.corporationName} onChange={(event) => patchSettings({ corporationName: event.target.value })} />
          </label>
          <label className="grid gap-2 text-xs font-medium text-zinc-400">
            <span>Canal do painel</span>
            <select className="h-10 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus:border-emerald-500/60 disabled:opacity-60" disabled={!canManage} value={currentDashboard.settings.panelChannelId ?? ""} onChange={(event) => patchSettings({ panelChannelId: event.target.value || null })}>
              <option value="">Selecione um canal</option>
              {channelOptions.map((option) => <option key={option.id} value={option.id}># {option.name}</option>)}
            </select>
          </label>
          <div className="grid gap-2">
            <FivemResourceSelect compact disabled={!canManage} label="Fórum de relatórios" options={channelOptions} prefix="#" value={currentDashboard.settings.reportsForumChannelId ?? null} onChange={(reportsForumChannelId) => patchSettings({ reportsForumChannelId })} />
            {currentDashboard.settings.reportsForumChannelId ? null : (
              <div className="flex flex-wrap items-center gap-2">
                <Button disabled={disabled} onClick={() => void ensureForum()} size="sm" type="button" variant="outline">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Criar fórum automaticamente
                </Button>
                <span className="text-xs text-zinc-500">O fórum é criado sozinho ao ativar o módulo; use este botão se o bot estava offline.</span>
              </div>
            )}
          </div>
          <FivemResourceSelect compact disabled={!canManage} label="Canal de logs" options={channelOptions} prefix="#" value={currentDashboard.settings.logChannelId ?? null} onChange={(logChannelId) => patchSettings({ logChannelId })} />
          <FivemResourceSelect compact disabled={!canManage} label="Categoria temporária" options={categories} value={currentDashboard.settings.temporaryCategoryId ?? null} onChange={(temporaryCategoryId) => patchSettings({ temporaryCategoryId })} />
          <label className="grid gap-2 text-xs font-medium text-zinc-400">
            <span>Tempo máximo da sessão (minutos)</span>
            <input className="h-10 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none focus:border-emerald-500/60" disabled={!canManage} min={1} type="number" value={currentDashboard.settings.sessionExpirationMinutes} onChange={(event) => patchSettings({ sessionExpirationMinutes: Math.max(1, Number(event.target.value || 0)) })} />
          </label>
          <div className="lg:col-span-2">
            <label className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-200">
              <span>Ativar módulo</span>
              <Switch checked={currentDashboard.settings.enabled} disabled={!canManage} onCheckedChange={(enabled) => patchSettings({ enabled })} />
            </label>
          </div>
          <FivemResourceMultiSelect compact disabled={!canManage} label="Cargos de recrutador" options={roleOptions} prefix="@" values={currentDashboard.settings.recruiterRoleIds} onChange={(recruiterRoleIds) => patchSettings({ recruiterRoleIds })} />
          <FivemResourceMultiSelect compact disabled={!canManage} label="Cargos que configuram" options={roleOptions} prefix="@" values={currentDashboard.settings.manageConfigurationRoleIds} onChange={(manageConfigurationRoleIds) => patchSettings({ manageConfigurationRoleIds })} />
          <FivemResourceMultiSelect compact disabled={!canManage} label="Cargos que gerenciam perguntas" options={roleOptions} prefix="@" values={currentDashboard.settings.manageQuestionsRoleIds} onChange={(manageQuestionsRoleIds) => patchSettings({ manageQuestionsRoleIds })} />
          <FivemResourceMultiSelect compact disabled={!canManage} label="Cargos que veem tudo" options={roleOptions} prefix="@" values={currentDashboard.settings.viewAllReportsRoleIds} onChange={(viewAllReportsRoleIds) => patchSettings({ viewAllReportsRoleIds })} />
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Perguntas</CardTitle>
                <CardDescription>Crie e ajuste o fluxo do relatório sem mexer no restante do módulo.</CardDescription>
              </div>
              <Button disabled={!canManage || saving} onClick={() => void createQuestion()} size="sm" type="button" variant="outline">
                <Plus className="h-4 w-4" />
                Nova pergunta
              </Button>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-2">
              {currentDashboard.questions.map((question) => (
                <button
                  className={`w-full rounded-lg border px-3 py-2 text-left transition ${question.id === selectedQuestionId ? "border-emerald-500/60 bg-emerald-500/10" : "border-zinc-800 bg-zinc-950/60 hover:border-zinc-700"}`}
                  key={question.id}
                  onClick={() => setSelectedQuestionId(question.id)}
                  type="button"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-white">{question.order + 1}. {question.title}</p>
                      <p className="truncate text-xs text-zinc-500">{questionTypeLabel(question.type)} {question.required ? "obrigatória" : "opcional"}</p>
                    </div>
                    <Badge variant={question.enabled ? "success" : "muted"}>{question.enabled ? "Ativa" : "Oculta"}</Badge>
                  </div>
                </button>
              ))}
              {!currentDashboard.questions.length ? <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-400">Nenhuma pergunta configurada.</div> : null}
            </div>
            <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
              <label className="grid gap-2 text-xs font-medium text-zinc-400">
                <span>Titulo</span>
                <input className="h-10 rounded-md border border-zinc-800 bg-black px-3 text-sm text-white outline-none focus:border-emerald-500/60" disabled={!canManage} value={questionDraft.title ?? ""} onChange={(event) => patchQuestion({ title: event.target.value })} />
              </label>
              <label className="grid gap-2 text-xs font-medium text-zinc-400">
                <span>Descrição</span>
                <textarea className="min-h-24 rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/60" disabled={!canManage} value={questionDraft.description ?? ""} onChange={(event) => patchQuestion({ description: event.target.value })} />
              </label>
              <label className="grid gap-2 text-xs font-medium text-zinc-400">
                <span>Tipo</span>
                <select className="h-10 rounded-md border border-zinc-800 bg-black px-3 text-sm text-white outline-none focus:border-emerald-500/60" disabled={!canManage} value={questionDraft.type ?? "TEXT"} onChange={(event) => patchQuestion({ type: event.target.value as PoliceReportsQuestionType })}>
                  {QUESTION_TYPES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </label>
              <label className="grid gap-2 text-xs font-medium text-zinc-400">
                <span>Opções</span>
                <textarea className="min-h-24 rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/60" disabled={!canManage || !OPTION_BASED_TYPES.includes((questionDraft.type ?? "TEXT") as PoliceReportsQuestionType)} placeholder="Uma opção por linha" value={(questionDraft.options ?? []).join("\n")} onChange={(event) => patchQuestion({ options: event.target.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean) })} />
              </label>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm text-zinc-300">
                  <Switch checked={questionDraft.required ?? true} disabled={!canManage} onCheckedChange={(required) => patchQuestion({ required })} />
                  Obrigatória
                </label>
                <label className="flex items-center gap-2 text-sm text-zinc-300">
                  <Switch checked={questionDraft.enabled ?? true} disabled={!canManage} onCheckedChange={(enabled) => patchQuestion({ enabled })} />
                  Ativa
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={!canManage || saving} onClick={() => void saveQuestion()} type="button">
                  <Save className="h-4 w-4" />
                  Salvar pergunta
                </Button>
                {selectedQuestion ? (
                  <>
                    <Button disabled={!canManage || saving || currentDashboard.questions.findIndex((question) => question.id === selectedQuestion.id) <= 0} onClick={() => void moveQuestion(selectedQuestion.id, "up")} type="button" variant="outline">
                      <ArrowUp className="h-4 w-4" />
                      Subir
                    </Button>
                    <Button disabled={!canManage || saving || currentDashboard.questions.findIndex((question) => question.id === selectedQuestion.id) >= currentDashboard.questions.length - 1} onClick={() => void moveQuestion(selectedQuestion.id, "down")} type="button" variant="outline">
                      <ArrowDown className="h-4 w-4" />
                      Descer
                    </Button>
                    <Button disabled={!canManage || saving} onClick={() => void removeQuestion(selectedQuestion.id)} type="button" variant="destructive">
                      <Trash2 className="h-4 w-4" />
                      Remover
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Validação</CardTitle>
              <CardDescription>Itens que precisam estar prontos antes da publicação.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {currentDashboard.validation.checks.map((check) => (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 px-3 py-2" key={check.id}>
                  <span className="text-sm text-zinc-200">{check.label}</span>
                  {check.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-rose-400" />}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Responsáveis</CardTitle>
              <CardDescription>Lista dos membros cadastrados como responsáveis no módulo.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {(currentDashboard.responsibles as Array<Record<string, any>>).slice(0, 8).map((item) => (
                <div className="rounded-lg border border-zinc-800 px-3 py-2" key={item.id ?? item.discordId ?? `${item.displayName}-${item.createdAt}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-white">{item.displayName ?? item.username ?? item.discordId ?? "Responsável"}</p>
                      <p className="truncate text-xs text-zinc-500">{item.roleName ?? item.policeId ?? item.discordId ?? "-"}</p>
                    </div>
                    <Badge variant={item.active === false ? "muted" : "success"}>{item.active === false ? "Inativo" : "Ativo"}</Badge>
                  </div>
                </div>
              ))}
              {!currentDashboard.responsibles.length ? <p className="py-6 text-center text-sm text-zinc-500">Nenhum responsável cadastrado.</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Histórico</CardTitle>
              <CardDescription>Últimos relatórios registrados no módulo.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {(currentDashboard.reports as Array<Record<string, any>>).slice(0, 8).map((report) => (
                <div className="rounded-lg border border-zinc-800 px-3 py-2" key={report.id ?? report.reportCode}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-white">{report.reportCode ?? "Relatório"}</p>
                      <p className="truncate text-xs text-zinc-500">{report.recruiterName ?? report.recruiterDiscordId ?? "-"} • {new Date(report.createdAt ?? Date.now()).toLocaleString("pt-BR")}</p>
                    </div>
                    <Badge variant={report.result === "APPROVED" ? "success" : report.result === "REJECTED" ? "danger" : "warning"}>{String(report.result ?? "PENDENTE")}</Badge>
                  </div>
                </div>
              ))}
              {!currentDashboard.reports.length ? <p className="py-6 text-center text-sm text-zinc-500">Nenhum relatório cadastrado.</p> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Logs</CardTitle>
              <CardDescription>Auditoria das alterações do módulo.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {(currentDashboard.logs as Array<Record<string, any>>).slice(0, 8).map((log) => (
                <div className="rounded-lg border border-zinc-800 px-3 py-2" key={log.id}>
                  <p className="text-sm text-white">{log.action}</p>
                  <p className="text-xs text-zinc-500">{log.actorId ?? "-"} • {new Date(log.createdAt).toLocaleString("pt-BR")}</p>
                </div>
              ))}
              {!currentDashboard.logs.length ? <p className="py-6 text-center text-sm text-zinc-500">Nenhum log ainda.</p> : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function questionPayload(question: Partial<PoliceReportsQuestion>) {
  return {
    description: question.description ?? "",
    enabled: question.enabled ?? true,
    options: question.options ?? [],
    required: question.required ?? true,
    title: question.title ?? "Nova pergunta",
    type: question.type ?? "TEXT"
  };
}

function questionTypeLabel(type: PoliceReportsQuestionType) {
  return QUESTION_TYPES.find((item) => item.id === type)?.label ?? type;
}

function Empty({ text, loading = false }: { loading?: boolean; text: string }) {
  return <Card><CardContent className="flex min-h-48 items-center justify-center gap-2 text-zinc-400">{loading ? <Loader2 className="h-5 w-5 animate-spin" /> : null}{text}</CardContent></Card>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <Card><CardContent className="p-4"><p className="text-xs text-zinc-500">{label}</p><p className="mt-1 text-xl font-bold text-white">{value}</p></CardContent></Card>;
}

function readMessage(error: unknown) {
  return (error as any)?.response?.data?.message ?? "Não foi possível concluir a operação.";
}
