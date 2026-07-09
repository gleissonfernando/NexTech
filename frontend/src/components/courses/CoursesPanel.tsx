import { useEffect, useMemo, useState } from "react";
import { BookOpen, CheckCircle2, Loader2, Plus, Save, Trash2, Upload } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { FivemResourceMultiSelect, FivemResourceSelect } from "../fivem/FivemResourceSelect";
import {
  createCourseApi,
  createCourseExamQuestionApi,
  deleteCourseApi,
  deleteCourseExamQuestionApi,
  duplicateCourseExamQuestionApi,
  getCourseExamDashboard,
  getCoursesDashboard,
  getGuildLiveOptions,
  publishCoursePanel,
  saveCourseExamSettings,
  saveCourseSettings,
  updateCourseExamQuestionApi,
  updateCourseApi
} from "../../lib/api";
import type { Course, CourseExamDashboard, CourseExamQuestion, CoursesDashboard, GuildLiveOptions, SaveCourseExamQuestionPayload, SaveCoursePayload } from "../../types";

type CoursesPanelProps = {
  botId: string;
  canManage: boolean;
  guildId: string;
};

const emptyCourse: SaveCoursePayload = {
  active: true,
  allowGeneralInstructorRoles: true,
  bannerUrl: null,
  buttonLabels: {
    cancel: "Cancelar Curso",
    enter: "Entrar no Curso",
    leave: "Sair do Curso",
    start: "Iniciar Curso"
  },
  cancelledText: null,
  color: "#2563eb",
  description: null,
  emoji: "📚",
  footerImageUrl: null,
  imagePosition: "top",
  instructorRoleIds: [],
  instructorUserIds: [],
  name: "",
  code: null,
  publishChannelId: null,
  publishText: null,
  startedText: null,
  thumbnailUrl: null
};

const emptyQuestion: SaveCourseExamQuestionPayload = {
  active: true,
  alternatives: [
    { id: "A", text: "" },
    { id: "B", text: "" },
    { id: "C", text: "" },
    { id: "D", text: "" },
    { id: "E", text: "" }
  ],
  correctAlternativeId: "A",
  description: null,
  order: 0,
  placeholder: "Explique com suas palavras...",
  points: 1,
  prompt: "",
  type: "selection"
};

export function CoursesPanel({ botId, canManage, guildId }: CoursesPanelProps) {
  const [dashboard, setDashboard] = useState<CoursesDashboard | null>(null);
  const [liveOptions, setLiveOptions] = useState<GuildLiveOptions | null>(null);
  const [draft, setDraft] = useState<SaveCoursePayload>(emptyCourse);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [exam, setExam] = useState<CourseExamDashboard | null>(null);
  const [examDraft, setExamDraft] = useState<SaveCourseExamQuestionPayload>(emptyQuestion);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const selectedCourse = useMemo(() => dashboard?.courses.find((course) => course.id === selectedCourseId) ?? null, [dashboard, selectedCourseId]);
  const textChannels = liveOptions?.channels.filter((channel) => ["text", "announcement"].includes(channel.type)) ?? liveOptions?.channels ?? [];

  useEffect(() => {
    void load();
  }, [botId, guildId]);

  useEffect(() => {
    if (!selectedCourse) {
      setDraft(emptyCourse);
      setExam(null);
      return;
    }
    setDraft(toPayload(selectedCourse));
    void loadExam(selectedCourse.id);
  }, [selectedCourse]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      setDashboard(await getCoursesDashboard(botId, guildId));
      setLiveOptions(await getGuildLiveOptions(guildId, botId).catch(() => ({ channels: [], roles: [], voiceChannels: [] })));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar o Sistema de Cursos.");
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings(patch: Partial<CoursesDashboard["settings"]>) {
    if (!dashboard) return;
    setSaving(true);
    setError("");
    try {
      const settings = await saveCourseSettings(botId, guildId, patch);
      setDashboard({ ...dashboard, settings });
      setMessage("Configurações salvas.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar configurações.");
    } finally {
      setSaving(false);
    }
  }

  async function saveCourse() {
    if (!draft.name.trim()) {
      setError("Informe o nome do curso.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const course = selectedCourse
        ? await updateCourseApi(botId, guildId, selectedCourse.id, draft)
        : await createCourseApi(botId, guildId, draft);
      const courses = selectedCourse
        ? (dashboard?.courses ?? []).map((item) => item.id === course.id ? course : item)
        : [course, ...(dashboard?.courses ?? [])];
      if (dashboard) setDashboard({ ...dashboard, courses });
      setSelectedCourseId(course.id);
      setMessage("Curso salvo.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar o curso.");
    } finally {
      setSaving(false);
    }
  }

  async function removeCourse() {
    if (!selectedCourse || !dashboard) return;
    setSaving(true);
    try {
      await deleteCourseApi(botId, guildId, selectedCourse.id);
      setDashboard({ ...dashboard, courses: dashboard.courses.filter((course) => course.id !== selectedCourse.id) });
      setSelectedCourseId(null);
      setMessage("Curso excluído.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível excluir o curso.");
    } finally {
      setSaving(false);
    }
  }

  async function publishPanel() {
    if (!dashboard) return;
    if (!dashboard.settings.publishChannelId) {
      setError("Configure o canal de publicação antes de publicar o painel.");
      return;
    }
    setPublishing(true);
    setError("");
    try {
      const settings = await publishCoursePanel(botId, guildId);
      setDashboard({ ...dashboard, settings });
      setMessage("Painel de cursos enviado para publicação.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível publicar o painel de cursos.");
    } finally {
      setPublishing(false);
    }
  }

  async function loadExam(courseId: string) {
    setExam(null);
    try {
      setExam(await getCourseExamDashboard(botId, guildId, courseId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar o Sistema de Provas.");
    }
  }

  async function saveExamSettings(patch: Partial<CourseExamDashboard["settings"]>) {
    if (!selectedCourse || !exam) return;
    setSaving(true);
    try {
      const settings = await saveCourseExamSettings(botId, guildId, selectedCourse.id, patch);
      setExam({ ...exam, settings });
      setMessage("Configuração da prova salva.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar a prova.");
    } finally {
      setSaving(false);
    }
  }

  async function saveQuestion() {
    if (!selectedCourse || !exam || !examDraft.prompt.trim()) return;
    setSaving(true);
    try {
      const payload = normalizeQuestionDraft(examDraft, exam.questions.length);
      const question = editingQuestionId
        ? await updateCourseExamQuestionApi(botId, guildId, selectedCourse.id, editingQuestionId, payload)
        : await createCourseExamQuestionApi(botId, guildId, selectedCourse.id, payload);
      setExam({
        ...exam,
        questions: editingQuestionId
          ? exam.questions.map((item) => item.id === question.id ? question : item).sort((a, b) => a.order - b.order)
          : [...exam.questions, question].sort((a, b) => a.order - b.order)
      });
      setExamDraft(emptyQuestion);
      setEditingQuestionId(null);
      setMessage("Pergunta salva.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar a pergunta.");
    } finally {
      setSaving(false);
    }
  }

  async function removeQuestion(question: CourseExamQuestion) {
    if (!selectedCourse || !exam) return;
    setSaving(true);
    try {
      await deleteCourseExamQuestionApi(botId, guildId, selectedCourse.id, question.id);
      setExam({ ...exam, questions: exam.questions.filter((item) => item.id !== question.id) });
      setMessage("Pergunta excluída.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível excluir a pergunta.");
    } finally {
      setSaving(false);
    }
  }

  async function duplicateQuestion(question: CourseExamQuestion) {
    if (!selectedCourse || !exam) return;
    setSaving(true);
    try {
      const duplicated = await duplicateCourseExamQuestionApi(botId, guildId, selectedCourse.id, question.id);
      setExam({ ...exam, questions: [...exam.questions, duplicated].sort((a, b) => a.order - b.order) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível duplicar a pergunta.");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !dashboard) {
    return <Card><CardContent className="flex min-h-40 items-center justify-center gap-3 p-6 text-sm text-zinc-400"><Loader2 className="h-5 w-5 animate-spin" />Carregando cursos...</CardContent></Card>;
  }

  return (
    <div className="space-y-4">
      {message ? <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">{message}</div> : null}
      {error ? <div className="rounded-lg border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</div> : null}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2"><BookOpen className="h-5 w-5 text-blue-300" /> Sistema de Cursos</CardTitle>
          <Button disabled={!canManage || publishing || !dashboard.settings.publishChannelId} onClick={() => void publishPanel()} size="sm" type="button">
            {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Publicar painel
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <SelectField disabled={!canManage || saving} label="Canal de publicação" onChange={(publishChannelId) => void saveSettings({ publishChannelId })} options={textChannels} value={dashboard.settings.publishChannelId ?? ""} />
          <SelectField disabled={!canManage || saving} label="Canal de agendamentos" onChange={(scheduleChannelId) => void saveSettings({ scheduleChannelId })} options={textChannels} value={dashboard.settings.scheduleChannelId ?? ""} />
          <SelectField disabled={!canManage || saving} label="Canal de relatórios" onChange={(reportChannelId) => void saveSettings({ reportChannelId })} options={textChannels} value={dashboard.settings.reportChannelId ?? ""} />
          <SelectField disabled={!canManage || saving} label="Canal de logs" onChange={(logChannelId) => void saveSettings({ logChannelId })} options={textChannels} value={dashboard.settings.logChannelId ?? ""} />
          <MultiRoleField disabled={!canManage || saving} label="Cargos gestores" onChange={(managerRoleIds) => void saveSettings({ managerRoleIds })} options={liveOptions?.roles ?? []} value={dashboard.settings.managerRoleIds} />
          <MultiRoleField disabled={!canManage || saving} label="Cargo geral dos instrutores" onChange={(generalInstructorRoleIds) => void saveSettings({ generalInstructorRoleIds })} options={liveOptions?.roles ?? []} value={dashboard.settings.generalInstructorRoleIds} />
          <InputField disabled={!canManage || saving} label="Gestores por ID de usuário" onChange={(value) => void saveSettings({ managerUserIds: csv(value) })} value={dashboard.settings.managerUserIds.join(",")} />
          <InputField disabled={!canManage || saving} label="Banner global" onChange={(globalBannerUrl) => void saveSettings({ globalBannerUrl })} value={dashboard.settings.globalBannerUrl ?? ""} />
          <InputField disabled={!canManage || saving} label="Imagem de relatório" onChange={(reportImageUrl) => void saveSettings({ reportImageUrl })} value={dashboard.settings.reportImageUrl ?? ""} />
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Cursos</CardTitle>
            <Button disabled={!canManage} onClick={() => setSelectedCourseId(null)} size="sm" type="button"><Plus className="h-4 w-4" />Novo</Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {dashboard.courses.map((course) => (
              <button className={`w-full rounded-lg border p-3 text-left ${selectedCourseId === course.id ? "border-blue-400/50 bg-blue-500/10" : "border-zinc-800 bg-black/30"}`} key={course.id} onClick={() => setSelectedCourseId(course.id)} type="button">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-white">{course.emoji} {course.name}</span>
                  <Badge variant={course.active ? "success" : "muted"}>{course.active ? "Ativo" : "Inativo"}</Badge>
                </div>
                <p className="mt-1 truncate text-xs text-zinc-500">{course.instructorUserIds.length} usuários, {course.instructorRoleIds.length} cargos instrutores</p>
                {course.code ? <p className="mt-1 truncate text-xs text-zinc-600">Código: {course.code}</p> : null}
              </button>
            ))}
            {!dashboard.courses.length ? <p className="rounded-lg border border-dashed border-zinc-800 px-4 py-8 text-center text-sm text-zinc-500">Nenhum curso cadastrado.</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{selectedCourse ? "Editar curso" : "Cadastrar curso"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <InputField disabled={!canManage} label="Nome" onChange={(name) => setDraft({ ...draft, name })} value={draft.name} />
              <InputField disabled={!canManage} label="Código" onChange={(code) => setDraft({ ...draft, code })} value={draft.code ?? ""} />
              <InputField disabled={!canManage} label="Emoji" onChange={(emoji) => setDraft({ ...draft, emoji })} value={draft.emoji ?? ""} />
              <InputField disabled={!canManage} label="Cor do painel" onChange={(color) => setDraft({ ...draft, color })} value={draft.color ?? "#2563eb"} />
              <SelectValueField disabled={!canManage} label="Posição da imagem" onChange={(imagePosition) => setDraft({ ...draft, imagePosition: imagePosition as SaveCoursePayload["imagePosition"] })} options={[["top", "Topo"], ["bottom", "Baixo"], ["side", "Lateral"], ["footer", "Rodapé"]]} value={draft.imagePosition ?? "top"} />
              <InputField disabled={!canManage} label="Banner principal" onChange={(bannerUrl) => setDraft({ ...draft, bannerUrl })} value={draft.bannerUrl ?? ""} />
              <InputField disabled={!canManage} label="Thumbnail" onChange={(thumbnailUrl) => setDraft({ ...draft, thumbnailUrl })} value={draft.thumbnailUrl ?? ""} />
              <InputField disabled={!canManage} label="Imagem de rodapé" onChange={(footerImageUrl) => setDraft({ ...draft, footerImageUrl })} value={draft.footerImageUrl ?? ""} />
              <SelectField disabled={!canManage} label="Canal próprio do curso" onChange={(publishChannelId) => setDraft({ ...draft, publishChannelId })} options={textChannels} value={draft.publishChannelId ?? ""} />
              <InputField disabled={!canManage} label="Instrutores por ID de usuário" onChange={(value) => setDraft({ ...draft, instructorUserIds: csv(value) })} value={(draft.instructorUserIds ?? []).join(",")} />
              <MultiRoleField disabled={!canManage} label="Cargos instrutores" onChange={(instructorRoleIds) => setDraft({ ...draft, instructorRoleIds })} options={liveOptions?.roles ?? []} value={draft.instructorRoleIds ?? []} />
              <label className="flex items-center justify-between rounded-lg border border-zinc-800 bg-black/30 px-3 py-3 text-sm text-zinc-200">
                Curso ativo
                <input checked={draft.active ?? true} disabled={!canManage} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} type="checkbox" />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-zinc-800 bg-black/30 px-3 py-3 text-sm text-zinc-200">
                Usar cargo geral de instrutor
                <input checked={draft.allowGeneralInstructorRoles ?? true} disabled={!canManage} onChange={(event) => setDraft({ ...draft, allowGeneralInstructorRoles: event.target.checked })} type="checkbox" />
              </label>
            </div>
            <TextAreaField disabled={!canManage} label="Descrição" onChange={(description) => setDraft({ ...draft, description })} value={draft.description ?? ""} />
            <TextAreaField disabled={!canManage} label="Texto do painel de publicação" onChange={(publishText) => setDraft({ ...draft, publishText })} value={draft.publishText ?? ""} />
            <div className="flex flex-wrap gap-2">
              <Button disabled={!canManage || saving} onClick={() => void saveCourse()} type="button">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Salvar</Button>
              {selectedCourse ? <Button disabled={!canManage || saving} onClick={() => void removeCourse()} type="button" variant="destructive"><Trash2 className="h-4 w-4" />Excluir</Button> : null}
            </div>
          </CardContent>
        </Card>
      </div>

      {selectedCourse && exam ? (
        <Card>
          <CardHeader>
            <CardTitle>Sistema de Provas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 md:grid-cols-3">
              <label className="flex items-center justify-between rounded-lg border border-zinc-800 bg-black/30 px-3 py-3 text-sm text-zinc-200">
                Prova ativa
                <input checked={exam.settings.enabled} disabled={!canManage || saving} onChange={(event) => void saveExamSettings({ enabled: event.target.checked })} type="checkbox" />
              </label>
              <InputField disabled={!canManage || saving} label="Nota mínima" onChange={(value) => void saveExamSettings({ minScore: Number(value) || 0 })} value={String(exam.settings.minScore)} />
              <InputField disabled={!canManage || saving} label="Tempo máximo em minutos" onChange={(value) => void saveExamSettings({ maxTimeMinutes: value ? Number(value) : null })} value={exam.settings.maxTimeMinutes ? String(exam.settings.maxTimeMinutes) : ""} />
              <SelectField disabled={!canManage || saving} label="Canal de correção" onChange={(correctionChannelId) => void saveExamSettings({ correctionChannelId })} options={textChannels} value={exam.settings.correctionChannelId ?? ""} />
              <SelectField disabled={!canManage || saving} label="Canal de logs da prova" onChange={(logChannelId) => void saveExamSettings({ logChannelId })} options={textChannels} value={exam.settings.logChannelId ?? ""} />
              <label className="flex items-center justify-between rounded-lg border border-zinc-800 bg-black/30 px-3 py-3 text-sm text-zinc-200">
                Apagar respostas escritas
                <input checked={exam.settings.deleteWrittenAnswers} disabled={!canManage || saving} onChange={(event) => void saveExamSettings({ deleteWrittenAnswers: event.target.checked })} type="checkbox" />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-zinc-800 bg-black/30 px-3 py-3 text-sm text-zinc-200">
                Permitir revisar pergunta atual
                <input checked={exam.settings.allowCurrentQuestionReview} disabled={!canManage || saving} onChange={(event) => void saveExamSettings({ allowCurrentQuestionReview: event.target.checked })} type="checkbox" />
              </label>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <TextAreaField disabled={!canManage || saving} label="Mensagem inicial" onChange={(initialMessage) => void saveExamSettings({ initialMessage })} value={exam.settings.initialMessage} />
              <TextAreaField disabled={!canManage || saving} label="Mensagem final" onChange={(finalMessage) => void saveExamSettings({ finalMessage })} value={exam.settings.finalMessage} />
              <TextAreaField disabled={!canManage || saving} label="Mensagem de aprovação" onChange={(approvalMessage) => void saveExamSettings({ approvalMessage })} value={exam.settings.approvalMessage} />
              <TextAreaField disabled={!canManage || saving} label="Mensagem de reprovação" onChange={(rejectionMessage) => void saveExamSettings({ rejectionMessage })} value={exam.settings.rejectionMessage} />
            </div>

            <div className="rounded-lg border border-zinc-800 bg-black/30 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-white">{editingQuestionId ? "Editar pergunta" : "+ Criar Pergunta"}</p>
                {editingQuestionId ? <Button onClick={() => { setEditingQuestionId(null); setExamDraft(emptyQuestion); }} size="sm" type="button" variant="outline">Cancelar edição</Button> : null}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <SelectValueField disabled={!canManage || saving} label="Tipo da pergunta" onChange={(type) => setExamDraft({ ...examDraft, type: type as "selection" | "written" })} options={[["selection", "Seleção"], ["written", "Escrita"]]} value={examDraft.type} />
                <InputField disabled={!canManage || saving} label="Nota da questão" onChange={(value) => setExamDraft({ ...examDraft, points: Number(value) || 0 })} value={String(examDraft.points ?? 1)} />
              </div>
              <div className="mt-3 space-y-3">
                <TextAreaField disabled={!canManage || saving} label="Pergunta" onChange={(prompt) => setExamDraft({ ...examDraft, prompt })} value={examDraft.prompt} />
                <TextAreaField disabled={!canManage || saving} label={examDraft.type === "written" ? "Texto de apoio" : "Descrição"} onChange={(description) => setExamDraft({ ...examDraft, description })} value={examDraft.description ?? ""} />
                {examDraft.type === "selection" ? (
                  <div className="grid gap-3 md:grid-cols-2">
                    {(examDraft.alternatives ?? []).slice(0, 5).map((alternative, index) => (
                      <InputField
                        disabled={!canManage || saving}
                        key={alternative.id ?? index}
                        label={`Alternativa ${["A", "B", "C", "D", "E"][index]}`}
                        onChange={(text) => setExamDraft({ ...examDraft, alternatives: (examDraft.alternatives ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, id: ["A", "B", "C", "D", "E"][index] as "A" | "B" | "C" | "D" | "E", text } : item) })}
                        value={alternative.text}
                      />
                    ))}
                    <SelectValueField disabled={!canManage || saving} label="Resposta correta" onChange={(correctAlternativeId) => setExamDraft({ ...examDraft, correctAlternativeId: correctAlternativeId as "A" | "B" | "C" | "D" | "E" })} options={[["A", "Alternativa A"], ["B", "Alternativa B"], ["C", "Alternativa C"], ["D", "Alternativa D"], ["E", "Alternativa E"]]} value={examDraft.correctAlternativeId ?? "A"} />
                  </div>
                ) : (
                  <InputField disabled={!canManage || saving} label="Placeholder da resposta" onChange={(placeholder) => setExamDraft({ ...examDraft, placeholder })} value={examDraft.placeholder ?? ""} />
                )}
                <Button disabled={!canManage || saving || !examDraft.prompt.trim()} onClick={() => void saveQuestion()} type="button"><Save className="h-4 w-4" />Salvar pergunta</Button>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              {exam.questions.map((question, index) => (
                <div className="rounded-lg border border-zinc-800 bg-black/30 p-3 text-sm text-zinc-300" key={question.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-white">{index + 1}. {question.prompt}</p>
                    <Badge variant={question.active ? "success" : "muted"}>{question.type === "selection" ? "Seleção" : "Escrita"}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">Nota: {question.points} • Status: {question.active ? "ativa" : "inativa"}</p>
                  {question.type === "selection" ? <p className="mt-2 text-xs text-zinc-400">{question.alternatives.map((item) => `${item.id}) ${item.text}`).join(" | ")}</p> : <p className="mt-2 text-xs text-zinc-400">{question.placeholder}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button disabled={!canManage || saving} onClick={() => { setEditingQuestionId(question.id); setExamDraft(toQuestionPayload(question)); }} size="sm" type="button" variant="outline">Editar</Button>
                    <Button disabled={!canManage || saving} onClick={() => void duplicateQuestion(question)} size="sm" type="button" variant="outline">Duplicar</Button>
                    <Button disabled={!canManage || saving} onClick={() => void removeQuestion(question)} size="sm" type="button" variant="destructive">Excluir</Button>
                  </div>
                </div>
              ))}
              {!exam.questions.length ? <p className="rounded-lg border border-dashed border-zinc-800 p-5 text-sm text-zinc-500">Nenhuma pergunta cadastrada para este curso.</p> : null}
            </div>

            <div className="rounded-lg border border-zinc-800 bg-black/30 p-4">
              <p className="font-semibold text-white">Resultados recentes</p>
              <div className="mt-3 grid gap-2">
                {exam.attempts.slice(0, 8).map((attempt) => (
                  <div className="rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-300" key={attempt.id}>
                    <span>Aluno: {attempt.studentId}</span> • <span>Status: {attempt.status}</span> • <span>Nota: {attempt.score}/{attempt.maxScore} ({attempt.percent}%)</span>
                  </div>
                ))}
                {!exam.attempts.length ? <p className="text-sm text-zinc-500">Nenhuma prova realizada ainda.</p> : null}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-300" /> Monitoramento</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <Metric label="Publicações" value={dashboard.publications.length} />
          <Metric label="Solicitações de horário" value={dashboard.scheduleRequests.length} />
          <Metric label="Relatórios" value={dashboard.reports.length} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Logs recentes</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {dashboard.logs.map((log) => (
            <div className="rounded-lg border border-zinc-800 bg-black/30 px-3 py-2 text-sm text-zinc-300" key={log.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-white">{log.action}</span>
                <span className="text-xs text-zinc-500">{new Date(log.createdAt).toLocaleString("pt-BR")}</span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">Usuário: {log.actorId ?? "-"} • Curso: {log.courseId ?? "-"} • Publicação: {log.publicationId ?? "-"}</p>
            </div>
          ))}
          {!dashboard.logs.length ? <p className="text-sm text-zinc-500">Nenhuma log registrada ainda.</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

function toPayload(course: Course): SaveCoursePayload {
  return {
    active: course.active,
    allowGeneralInstructorRoles: course.allowGeneralInstructorRoles,
    bannerUrl: course.bannerUrl,
    buttonLabels: course.buttonLabels,
    cancelledText: course.cancelledText,
    color: course.color,
    description: course.description,
    emoji: course.emoji,
    footerImageUrl: course.footerImageUrl,
    imagePosition: course.imagePosition,
    instructorRoleIds: course.instructorRoleIds,
    instructorUserIds: course.instructorUserIds,
    name: course.name,
    code: course.code,
    publishChannelId: course.publishChannelId,
    publishText: course.publishText,
    startedText: course.startedText,
    thumbnailUrl: course.thumbnailUrl
  };
}

function toQuestionPayload(question: CourseExamQuestion): SaveCourseExamQuestionPayload {
  return {
    active: question.active,
    alternatives: question.alternatives.length ? question.alternatives : emptyQuestion.alternatives,
    correctAlternativeId: question.correctAlternativeId,
    description: question.description,
    order: question.order,
    placeholder: question.placeholder,
    points: question.points,
    prompt: question.prompt,
    type: question.type
  };
}

function normalizeQuestionDraft(question: SaveCourseExamQuestionPayload, fallbackOrder: number): SaveCourseExamQuestionPayload {
  const alternatives = (question.alternatives ?? [])
    .slice(0, 5)
    .map((item, index) => ({ id: ["A", "B", "C", "D", "E"][index] as "A" | "B" | "C" | "D" | "E", text: item.text.trim() }))
    .filter((item) => item.text);
  return {
    ...question,
    alternatives: question.type === "selection" ? alternatives : [],
    correctAlternativeId: question.type === "selection" ? question.correctAlternativeId ?? "A" : null,
    order: question.order ?? fallbackOrder,
    points: Number(question.points) || 0
  };
}

function csv(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function InputField({ disabled, label, onChange, value }: { disabled?: boolean; label: string; onChange: (value: string) => void; value: string }) {
  return <label className="grid gap-2 text-sm"><span className="font-semibold text-zinc-300">{label}</span><input className="h-10 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value} /></label>;
}

function TextAreaField({ disabled, label, onChange, value }: { disabled?: boolean; label: string; onChange: (value: string) => void; value: string }) {
  return <label className="grid gap-2 text-sm"><span className="font-semibold text-zinc-300">{label}</span><textarea className="min-h-24 rounded-lg border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-100" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value} /></label>;
}

function SelectField({ disabled, label, onChange, options, value }: { disabled?: boolean; label: string; onChange: (value: string | null) => void; options: Array<{ id: string; name: string }>; value: string }) {
  return <FivemResourceSelect disabled={Boolean(disabled)} label={label} onChange={onChange} options={options.map((option) => ({ id: option.id, name: option.name }))} placeholder="Não configurado" prefix="#" value={value || null} />;
}

function SelectValueField({ disabled, label, onChange, options, value }: { disabled?: boolean; label: string; onChange: (value: string) => void; options: Array<[string, string]>; value: string }) {
  return <label className="grid gap-2 text-sm"><span className="font-semibold text-zinc-300">{label}</span><select className="h-10 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value}>{options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>;
}

function MultiRoleField({ disabled, label, onChange, options, value }: { disabled?: boolean; label: string; onChange: (value: string[]) => void; options: Array<{ id: string; name: string }>; value: string[] }) {
  return <div className="md:col-span-2"><FivemResourceMultiSelect disabled={Boolean(disabled)} label={label} onChange={onChange} options={options.map((option) => ({ id: option.id, name: option.name }))} prefix="@" values={value} /></div>;
}

function Metric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg border border-zinc-800 bg-black/30 p-4"><p className="text-xs font-semibold uppercase text-zinc-500">{label}</p><p className="mt-2 text-2xl font-semibold text-white">{value}</p></div>;
}
