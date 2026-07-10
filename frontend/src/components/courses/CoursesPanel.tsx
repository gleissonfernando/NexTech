import { useEffect, useMemo, useState } from "react";
import { BookOpen, FileQuestion, Image, ListChecks, Loader2, Save, ShieldCheck, SlidersHorizontal, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { FivemResourceMultiSelect, FivemResourceSelect } from "../fivem/FivemResourceSelect";
import {
  createCourseApi,
  createCourseExamQuestionApi,
  deleteCourseApi,
  deleteCourseExamQuestionApi,
  getCourseExamDashboard,
  getCoursesDashboard,
  getGuildLiveOptions,
  saveCourseExamSettings,
  saveCourseSettings,
  updateCourseApi,
  updateCourseExamQuestionApi
} from "../../lib/api";
import type { Course, CourseExamDashboard, CourseExamQuestion, CoursesDashboard, GuildLiveOptions, SaveCourseExamQuestionPayload, SaveCoursePayload } from "../../types";

type CoursesPanelProps = {
  botId: string;
  canManage: boolean;
  guildId: string;
};

type TabId = "images" | "channels" | "courses" | "proofs" | "admins" | "logs";
type CourseChannelDraft = Pick<
  CoursesDashboard["settings"],
  "adminLogChannelId" | "defaultExpirationHours" | "evaluationChannelId" | "evaluatorMentionRoleId" | "proofLogChannelId" | "publishChannelId" | "resultChannelId" | "resultMentionRoleId" | "scheduleLogChannelId" | "tempProofCategoryId"
>;
type ExamLinkDraft = Pick<CourseExamDashboard["settings"], "externalLinkDescription" | "externalLinkEmoji" | "externalLinkEnabled" | "externalLinkText" | "externalLinkUrl">;

const tabs: Array<{ id: TabId; icon: typeof Image; label: string }> = [
  { id: "images", icon: Image, label: "Banners e Imagens" },
  { id: "channels", icon: SlidersHorizontal, label: "Configuração de Canais" },
  { id: "courses", icon: BookOpen, label: "Cursos Cadastrados" },
  { id: "proofs", icon: FileQuestion, label: "Configuração de Provas" },
  { id: "admins", icon: ShieldCheck, label: "Administradores" },
  { id: "logs", icon: ListChecks, label: "Logs do Sistema" }
];

const imageTypes = [
  ["main_banner", "Banner principal do curso"],
  ["proof_banner", "Banner do painel de prova"],
  ["logs_banner", "Banner dos logs"],
  ["approved_result", "Resultado aprovado"],
  ["rejected_result", "Resultado reprovado"],
  ["module", "Imagem geral do módulo"]
] as const;

const permissionKeys = [
  "configure_channels",
  "create_course",
  "edit_course",
  "delete_course",
  "configure_proof",
  "publish_course",
  "start_course",
  "cancel_course",
  "start_proof",
  "evaluate_proof",
  "approve_proof",
  "reject_proof",
  "view_logs"
];

const emptyCourse: SaveCoursePayload = {
  active: true,
  allowGeneralInstructorRoles: true,
  bannerUrl: null,
  proofBannerUrl: null,
  buttonLabels: { cancel: "Cancelar Curso", enter: "Entrar no Curso", leave: "Sair do Curso", start: "Iniciar Curso" },
  cancelledText: null,
  color: "#2563eb",
  code: null,
  defaultSchedule: null,
  description: null,
  emoji: "📚",
  footerImageUrl: null,
  imagePosition: "top",
  instructorRoleIds: [],
  instructorUserIds: [],
  location: null,
  maxStudents: 30,
  name: "",
  proofInstructionText: "Leia cada pergunta com atenção. A pergunta final será avaliada manualmente.",
  publishChannelId: null,
  publishText: null,
  startedText: null,
  thumbnailUrl: null
};

const emptyQuestion: SaveCourseExamQuestionPayload = {
  active: true,
  alternatives: [
    { id: "A", text: "", score: 0, isCorrect: false, order: 0 },
    { id: "B", text: "", score: 0, isCorrect: false, order: 1 },
    { id: "C", text: "", score: 10, isCorrect: true, order: 2 },
    { id: "D", text: "", score: 0, isCorrect: false, order: 3 }
  ],
  correctAlternativeId: "C",
  description: null,
  order: 0,
  questionNumber: 1,
  placeholder: "Escreva sua resposta final...",
  points: 10,
  prompt: "",
  type: "selection"
};

export function CoursesPanel({ botId, canManage, guildId }: CoursesPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>("images");
  const [dashboard, setDashboard] = useState<CoursesDashboard | null>(null);
  const [liveOptions, setLiveOptions] = useState<GuildLiveOptions | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [courseDraft, setCourseDraft] = useState<SaveCoursePayload>(emptyCourse);
  const [exam, setExam] = useState<CourseExamDashboard | null>(null);
  const [questionDraft, setQuestionDraft] = useState<SaveCourseExamQuestionPayload>(emptyQuestion);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [channelDraft, setChannelDraft] = useState<CourseChannelDraft | null>(null);
  const [examLinkDraft, setExamLinkDraft] = useState<ExamLinkDraft | null>(null);
  const [imageDraft, setImageDraft] = useState({ name: "", type: "main_banner", url: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const selectedCourse = useMemo(() => dashboard?.courses.find((course) => course.id === selectedCourseId) ?? null, [dashboard, selectedCourseId]);
  const channelSettingsChanged = useMemo(() => Boolean(dashboard && channelDraft && JSON.stringify(channelDraft) !== JSON.stringify(toChannelDraft(dashboard.settings))), [channelDraft, dashboard]);
  const textChannels = liveOptions?.channels.filter((channel) => ["text", "announcement"].includes(channel.type)) ?? [];
  const categories = liveOptions?.categories ?? [];
  const roles = liveOptions?.roles ?? [];

  useEffect(() => {
    void load();
  }, [botId, guildId]);

  useEffect(() => {
    setChannelDraft(dashboard ? toChannelDraft(dashboard.settings) : null);
  }, [dashboard?.settings]);

  useEffect(() => {
    if (!selectedCourse) {
      setCourseDraft(emptyCourse);
      setExam(null);
      setExamLinkDraft(null);
      return;
    }
    setCourseDraft(toCoursePayload(selectedCourse));
    void loadExam(selectedCourse.id);
  }, [selectedCourse]);

  useEffect(() => {
    setExamLinkDraft(exam ? toExamLinkDraft(exam.settings) : null);
  }, [exam?.settings]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [data, options] = await Promise.all([
        getCoursesDashboard(botId, guildId),
        getGuildLiveOptions(guildId, botId).catch(() => ({ channels: [], roles: [], voiceChannels: [] }))
      ]);
      setDashboard(data);
      setLiveOptions(options);
      setSelectedCourseId(data.courses[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar o Sistema de Curso.");
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
      setError(err instanceof Error ? err.message : "Não foi possível salvar as configurações.");
    } finally {
      setSaving(false);
    }
  }

  async function saveChannelSettings() {
    if (!channelDraft) return;
    await saveSettings(channelDraft);
  }

  function updateChannelDraft(patch: Partial<CourseChannelDraft>) {
    setChannelDraft((current) => current ? { ...current, ...patch } : current);
  }

  async function saveCourse() {
    if (!dashboard || !courseDraft.name?.trim()) {
      setError("Informe o nome do curso.");
      return;
    }
    setSaving(true);
    try {
      const saved = selectedCourse
        ? await updateCourseApi(botId, guildId, selectedCourse.id, courseDraft)
        : await createCourseApi(botId, guildId, courseDraft);
      setDashboard({
        ...dashboard,
        courses: selectedCourse ? dashboard.courses.map((course) => course.id === saved.id ? saved : course) : [saved, ...dashboard.courses]
      });
      setSelectedCourseId(saved.id);
      setMessage("Curso cadastrado com sucesso.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar o curso.");
    } finally {
      setSaving(false);
    }
  }

  async function removeCourse() {
    if (!dashboard || !selectedCourse) return;
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

  async function loadExam(courseId: string) {
    setExam(null);
    try {
      const data = await getCourseExamDashboard(botId, guildId, courseId);
      setExam(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar a prova.");
    }
  }

  async function saveQuestion() {
    if (!selectedCourse || !exam || !questionDraft.prompt?.trim()) return;
    const payload = normalizeQuestion(questionDraft);
    setSaving(true);
    try {
      const saved = editingQuestionId
        ? await updateCourseExamQuestionApi(botId, guildId, selectedCourse.id, editingQuestionId, payload)
        : await createCourseExamQuestionApi(botId, guildId, selectedCourse.id, payload);
      setExam({
        ...exam,
        questions: editingQuestionId
          ? exam.questions.map((question) => question.id === saved.id ? saved : question).sort(sortQuestion)
          : [...exam.questions, saved].sort(sortQuestion)
      });
      setEditingQuestionId(null);
      setQuestionDraft(emptyQuestion);
      setMessage("Pergunta salva.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar a pergunta.");
    } finally {
      setSaving(false);
    }
  }

  async function saveExamLinkSettings() {
    if (!selectedCourse || !exam || !examLinkDraft) return;
    if (examLinkDraft.externalLinkEnabled && examLinkDraft.externalLinkUrl && !examLinkDraft.externalLinkUrl.startsWith("https://")) {
      setError("O link externo precisa começar com https://.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const settings = await saveCourseExamSettings(botId, guildId, selectedCourse.id, examLinkDraft);
      setExam({ ...exam, settings });
      setMessage("Link externo da prova salvo.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar o link externo.");
    } finally {
      setSaving(false);
    }
  }

  async function saveImage() {
    if (!dashboard || !imageDraft.name.trim() || !imageDraft.url.trim()) {
      setError("Informe nome e URL da imagem.");
      return;
    }
    const image = {
      id: crypto.randomUUID(),
      botId,
      guildId,
      name: imageDraft.name.trim(),
      type: imageDraft.type as CoursesDashboard["settings"]["images"][number]["type"],
      url: imageDraft.url.trim(),
      createdAt: new Date().toISOString(),
      createdBy: null,
      active: true,
      default: false
    };
    await saveSettings({ images: [image, ...(dashboard.settings.images ?? [])] });
    setImageDraft({ name: "", type: "main_banner", url: "" });
  }

  if (loading || !dashboard) {
    return <Card><CardContent className="flex min-h-40 items-center justify-center gap-3 p-6 text-sm text-zinc-400"><Loader2 className="h-5 w-5 animate-spin" />Carregando Sistema de Curso...</CardContent></Card>;
  }

  return (
    <div className="space-y-4">
      {message ? <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">{message}</div> : null}
      {error ? <div className="rounded-lg border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-100">{error}</div> : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><BookOpen className="h-5 w-5 text-sky-300" />Sistema de Curso</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <Button key={tab.id} onClick={() => setActiveTab(tab.id)} type="button" variant={activeTab === tab.id ? "default" : "outline"}>
                <Icon className="h-4 w-4" />{tab.label}
              </Button>
            );
          })}
        </CardContent>
      </Card>

      {activeTab === "images" ? (
        <Card>
          <CardHeader><CardTitle>Banners e Imagens</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <InputField disabled={!canManage || saving} label="Nome da imagem" onChange={(name) => setImageDraft({ ...imageDraft, name })} value={imageDraft.name} />
              <SelectValueField disabled={!canManage || saving} label="Tipo" onChange={(type) => setImageDraft({ ...imageDraft, type })} options={imageTypes.map(([id, label]) => [id, label])} value={imageDraft.type} />
              <InputField disabled={!canManage || saving} label="URL final da imagem" onChange={(url) => setImageDraft({ ...imageDraft, url })} value={imageDraft.url} />
            </div>
            <Button disabled={!canManage || saving} onClick={() => void saveImage()} type="button"><Save className="h-4 w-4" />Salvar imagem</Button>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {(dashboard.settings.images ?? []).map((image) => (
                <div className="rounded-lg border border-zinc-800 bg-black/30 p-3" key={image.id}>
                  <img alt={image.name} className="h-28 w-full rounded-md object-cover" src={image.url} />
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-white">{image.name}</p>
                      <p className="text-xs text-zinc-500">{imageTypes.find(([id]) => id === image.type)?.[1] ?? image.type}</p>
                    </div>
                    <Badge variant={image.active ? "success" : "muted"}>{image.active ? "Ativa" : "Inativa"}</Badge>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Button disabled={!canManage || saving} onClick={() => void saveSettings({ images: dashboard.settings.images.map((item) => item.id === image.id ? { ...item, default: !item.default } : item) })} size="sm" type="button" variant="outline">{image.default ? "Padrão" : "Definir padrão"}</Button>
                    <Button disabled={!canManage || saving} onClick={() => void saveSettings({ images: dashboard.settings.images.filter((item) => item.id !== image.id) })} size="sm" type="button" variant="destructive"><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "channels" ? (
        <Card>
          <CardHeader><CardTitle>Configuração de Canais</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <SelectField disabled={!canManage || saving} label="Canal global de publicação" onChange={(publishChannelId) => updateChannelDraft({ publishChannelId })} options={textChannels} value={channelDraft?.publishChannelId ?? ""} />
              <SelectField disabled={!canManage || saving} label="Logs de agendamento" onChange={(scheduleLogChannelId) => updateChannelDraft({ scheduleLogChannelId })} options={textChannels} value={channelDraft?.scheduleLogChannelId ?? ""} />
              <SelectField disabled={!canManage || saving} label="Logs de provas" onChange={(proofLogChannelId) => updateChannelDraft({ proofLogChannelId })} options={textChannels} value={channelDraft?.proofLogChannelId ?? ""} />
              <SelectField disabled={!canManage || saving} label="Resultados aprovado/reprovado" onChange={(resultChannelId) => updateChannelDraft({ resultChannelId })} options={textChannels} value={channelDraft?.resultChannelId ?? ""} />
              <SelectField disabled={!canManage || saving} label="Avaliação das provas" onChange={(evaluationChannelId) => updateChannelDraft({ evaluationChannelId })} options={textChannels} value={channelDraft?.evaluationChannelId ?? ""} />
              <SelectField disabled={!canManage || saving} label="Categoria de canais temporários" onChange={(tempProofCategoryId) => updateChannelDraft({ tempProofCategoryId })} options={categories} value={channelDraft?.tempProofCategoryId ?? ""} />
              <NumberInputField disabled={!canManage || saving} label="Expiração dos canais temporários (horas)" max={720} min={1} onChange={(defaultExpirationHours) => updateChannelDraft({ defaultExpirationHours })} value={channelDraft?.defaultExpirationHours ?? 24} />
              <SelectField disabled={!canManage || saving} label="Logs administrativos" onChange={(adminLogChannelId) => updateChannelDraft({ adminLogChannelId })} options={textChannels} value={channelDraft?.adminLogChannelId ?? ""} />
              <RoleSelect disabled={!canManage || saving} label="Cargo para mencionar avaliadores" onChange={(evaluatorMentionRoleId) => updateChannelDraft({ evaluatorMentionRoleId })} options={roles} value={channelDraft?.evaluatorMentionRoleId ?? ""} />
              <RoleSelect disabled={!canManage || saving} label="Cargo para mencionar resultados" onChange={(resultMentionRoleId) => updateChannelDraft({ resultMentionRoleId })} options={roles} value={channelDraft?.resultMentionRoleId ?? ""} />
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-zinc-900 pt-4">
              <Button disabled={!canManage || saving || !channelDraft || !channelSettingsChanged} onClick={() => void saveChannelSettings()} type="button">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Salvar canais
              </Button>
              <Button disabled={!channelSettingsChanged || saving || !dashboard} onClick={() => setChannelDraft(toChannelDraft(dashboard.settings))} type="button" variant="ghost">Descartar alterações</Button>
              {channelSettingsChanged ? <span className="text-xs text-amber-300">Alterações pendentes.</span> : <span className="text-xs text-zinc-500">Nenhuma alteração pendente.</span>}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "courses" ? (
        <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
          <Card>
            <CardHeader><CardTitle>Cursos Cadastrados</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Button disabled={!canManage} onClick={() => { setSelectedCourseId(null); setCourseDraft(emptyCourse); }} type="button">Novo curso</Button>
              {dashboard.courses.map((course) => (
                <button className={`w-full rounded-lg border p-3 text-left ${selectedCourseId === course.id ? "border-sky-400/50 bg-sky-500/10" : "border-zinc-800 bg-black/30"}`} key={course.id} onClick={() => setSelectedCourseId(course.id)} type="button">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-white">{course.name}</span>
                    <Badge variant={course.active ? "success" : "muted"}>{course.active ? "Ativo" : "Inativo"}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">Código: {course.code || "-"} • Vagas: {course.maxStudents ?? 30}</p>
                  <p className="mt-1 text-xs text-zinc-500">Instrutores: {course.instructorUserIds.length} usuários, {course.instructorRoleIds.length} cargos</p>
                </button>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{selectedCourse ? "Editar curso" : "Criar curso"}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <InputField disabled={!canManage} label="Nome do curso" onChange={(name) => setCourseDraft({ ...courseDraft, name })} value={courseDraft.name ?? ""} />
                <InputField disabled={!canManage} label="Código/número" onChange={(code) => setCourseDraft({ ...courseDraft, code })} value={courseDraft.code ?? ""} />
                <InputField disabled={!canManage} label="Local" onChange={(location) => setCourseDraft({ ...courseDraft, location })} value={courseDraft.location ?? ""} />
                <InputField disabled={!canManage} label="Horário padrão" onChange={(defaultSchedule) => setCourseDraft({ ...courseDraft, defaultSchedule })} value={courseDraft.defaultSchedule ?? ""} />
                <InputField disabled={!canManage} label="Limite de alunos" onChange={(value) => setCourseDraft({ ...courseDraft, maxStudents: Number(value) || 1 })} value={String(courseDraft.maxStudents ?? 30)} />
                <InputField disabled={!canManage} label="Banner do curso" onChange={(bannerUrl) => setCourseDraft({ ...courseDraft, bannerUrl })} value={courseDraft.bannerUrl ?? ""} />
                <InputField disabled={!canManage} label="Banner da prova" onChange={(proofBannerUrl) => setCourseDraft({ ...courseDraft, proofBannerUrl })} value={courseDraft.proofBannerUrl ?? ""} />
                <InputField disabled={!canManage} label="Instrutores por ID de usuário" onChange={(value) => setCourseDraft({ ...courseDraft, instructorUserIds: csv(value) })} value={(courseDraft.instructorUserIds ?? []).join(",")} />
                <MultiRoleField disabled={!canManage} label="Cargos de instrutor" onChange={(instructorRoleIds) => setCourseDraft({ ...courseDraft, instructorRoleIds })} options={roles} value={courseDraft.instructorRoleIds ?? []} />
              </div>
              <TextAreaField disabled={!canManage} label="Descrição" onChange={(description) => setCourseDraft({ ...courseDraft, description })} value={courseDraft.description ?? ""} />
              <TextAreaField disabled={!canManage} label="Texto do painel de publicação" onChange={(publishText) => setCourseDraft({ ...courseDraft, publishText })} value={courseDraft.publishText ?? ""} />
              <TextAreaField disabled={!canManage} label="Texto de instrução da prova" onChange={(proofInstructionText) => setCourseDraft({ ...courseDraft, proofInstructionText })} value={courseDraft.proofInstructionText ?? ""} />
              <div className="flex flex-wrap gap-2">
                <Button disabled={!canManage || saving} onClick={() => void saveCourse()} type="button"><Save className="h-4 w-4" />Salvar</Button>
                {selectedCourse ? <Button disabled={!canManage || saving} onClick={() => void removeCourse()} type="button" variant="destructive"><Trash2 className="h-4 w-4" />Excluir</Button> : null}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {activeTab === "proofs" ? (
        <Card>
          <CardHeader><CardTitle>Configuração de Provas</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <SelectValueField disabled={!canManage || saving} label="Curso" onChange={(courseId) => setSelectedCourseId(courseId)} options={dashboard.courses.map((course) => [course.id, course.name])} value={selectedCourseId ?? ""} />
            {selectedCourse && exam ? (
              <>
                <div className="grid gap-3 md:grid-cols-4">
                  <DecimalInputField disabled={!canManage || saving} label="Nota mínima" onCommit={(minScore) => void saveCourseExamSettings(botId, guildId, selectedCourse.id, { minScore }).then((settings) => setExam({ ...exam, settings }))} value={exam.settings.minScore} />
                  <DecimalInputField disabled={!canManage || saving} label="Nota máxima manual" onCommit={(manualQuestionMaxScore) => void saveCourseExamSettings(botId, guildId, selectedCourse.id, { manualQuestionMaxScore }).then((settings) => setExam({ ...exam, settings }))} value={exam.settings.manualQuestionMaxScore ?? 10} />
                  <ToggleField disabled={!canManage || saving} label="Aprovação sempre manual" onChange={(manualApproval) => void saveCourseExamSettings(botId, guildId, selectedCourse.id, { manualApproval }).then((settings) => setExam({ ...exam, settings }))} value={exam.settings.manualApproval ?? true} />
                  <ToggleField disabled={!canManage || saving} label="Prova ativa" onChange={(enabled) => void saveCourseExamSettings(botId, guildId, selectedCourse.id, { enabled }).then((settings) => setExam({ ...exam, settings }))} value={exam.settings.enabled} />
                  <SelectField disabled={!canManage || saving} label="Categoria dos canais da prova" onChange={(temporaryCategoryId) => void saveCourseExamSettings(botId, guildId, selectedCourse.id, { temporaryCategoryId }).then((settings) => setExam({ ...exam, settings }))} options={categories} value={exam.settings.temporaryCategoryId ?? ""} />
                  <SelectField disabled={!canManage || saving} label="Canal de correção manual" onChange={(correctionChannelId) => void saveCourseExamSettings(botId, guildId, selectedCourse.id, { correctionChannelId }).then((settings) => setExam({ ...exam, settings }))} options={textChannels} value={exam.settings.correctionChannelId ?? ""} />
                  <SelectField disabled={!canManage || saving} label="Canal de resultado da prova" onChange={(resultChannelId) => void saveCourseExamSettings(botId, guildId, selectedCourse.id, { resultChannelId }).then((settings) => setExam({ ...exam, settings }))} options={textChannels} value={exam.settings.resultChannelId ?? ""} />
                  <SelectField disabled={!canManage || saving} label="Canal de logs da prova" onChange={(logChannelId) => void saveCourseExamSettings(botId, guildId, selectedCourse.id, { logChannelId }).then((settings) => setExam({ ...exam, settings }))} options={textChannels} value={exam.settings.logChannelId ?? ""} />
                </div>
                {examLinkDraft ? (
                  <div className="rounded-lg border border-zinc-800 bg-black/30 p-4">
                    <p className="mb-3 font-semibold text-white">Botão de link externo</p>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                      <ToggleField disabled={!canManage || saving} label="Ativar link" onChange={(externalLinkEnabled) => setExamLinkDraft({ ...examLinkDraft, externalLinkEnabled })} value={examLinkDraft.externalLinkEnabled} />
                      <InputField disabled={!canManage || saving} label="Texto do botão" onChange={(externalLinkText) => setExamLinkDraft({ ...examLinkDraft, externalLinkText })} value={examLinkDraft.externalLinkText ?? ""} />
                      <InputField disabled={!canManage || saving} label="URL https://" onChange={(externalLinkUrl) => setExamLinkDraft({ ...examLinkDraft, externalLinkUrl })} value={examLinkDraft.externalLinkUrl ?? ""} />
                      <InputField disabled={!canManage || saving} label="Emoji opcional" onChange={(externalLinkEmoji) => setExamLinkDraft({ ...examLinkDraft, externalLinkEmoji })} value={examLinkDraft.externalLinkEmoji ?? ""} />
                      <InputField disabled={!canManage || saving} label="Descrição" onChange={(externalLinkDescription) => setExamLinkDraft({ ...examLinkDraft, externalLinkDescription })} value={examLinkDraft.externalLinkDescription ?? ""} />
                    </div>
                    <Button className="mt-3" disabled={!canManage || saving} onClick={() => void saveExamLinkSettings()} type="button">
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Salvar link
                    </Button>
                  </div>
                ) : null}
                <ProofCompleteness questions={exam.questions} />
                <div className="rounded-lg border border-zinc-800 bg-black/30 p-4">
                  <p className="mb-3 font-semibold text-white">{editingQuestionId ? "Editar pergunta" : "Criar pergunta"}</p>
                  <div className="grid gap-3 md:grid-cols-3">
                    <InputField disabled={!canManage || saving} label="Número da pergunta" onChange={(value) => setQuestionDraft({ ...questionDraft, questionNumber: Number(value) || 1, order: Math.max(0, (Number(value) || 1) - 1) })} value={String(questionDraft.questionNumber ?? 1)} />
                    <SelectValueField disabled={!canManage || saving} label="Tipo" onChange={(type) => setQuestionDraft({ ...questionDraft, type: type as "selection" | "written" })} options={[["selection", "Objetiva"], ["written", "Discursiva"]]} value={questionDraft.type} />
                    <DecimalInputField disabled={!canManage || saving} label="Nota máxima" onCommit={(points) => setQuestionDraft({ ...questionDraft, points })} value={questionDraft.points ?? 10} />
                  </div>
                  <div className="mt-3 space-y-3">
                    <TextAreaField disabled={!canManage || saving} label="Pergunta" onChange={(prompt) => setQuestionDraft({ ...questionDraft, prompt })} value={questionDraft.prompt} />
                    <TextAreaField disabled={!canManage || saving} label="Descrição opcional" onChange={(description) => setQuestionDraft({ ...questionDraft, description })} value={questionDraft.description ?? ""} />
                    {questionDraft.type === "selection" ? (
                      <div className="grid gap-3 md:grid-cols-2">
                        {(questionDraft.alternatives ?? []).map((option, index) => (
                          <div className="rounded-lg border border-zinc-800 p-3" key={option.id ?? index}>
                            <InputField disabled={!canManage || saving} label={`Resposta ${index + 1}`} onChange={(text) => setQuestionDraft({ ...questionDraft, alternatives: updateOption(questionDraft.alternatives, index, { text }) })} value={option.text} />
                            <DecimalInputField disabled={!canManage || saving} label="Pontuação" onCommit={(score) => setQuestionDraft({ ...questionDraft, alternatives: updateOption(questionDraft.alternatives, index, { score }) })} value={option.score ?? 0} />
                            <ToggleField disabled={!canManage || saving} label="Correta" onChange={(checked) => setQuestionDraft({ ...questionDraft, correctAlternativeId: checked ? option.id : questionDraft.correctAlternativeId, alternatives: (questionDraft.alternatives ?? []).map((item, itemIndex) => ({ ...item, isCorrect: itemIndex === index ? checked : false })) })} value={Boolean(option.isCorrect)} />
                          </div>
                        ))}
                      </div>
                    ) : <InputField disabled={!canManage || saving} label="Placeholder do modal" onChange={(placeholder) => setQuestionDraft({ ...questionDraft, placeholder })} value={questionDraft.placeholder ?? ""} />}
                    <Button disabled={!canManage || saving || !questionDraft.prompt?.trim()} onClick={() => void saveQuestion()} type="button"><Save className="h-4 w-4" />Salvar pergunta</Button>
                  </div>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  {exam.questions.sort(sortQuestion).map((question) => (
                    <QuestionCard key={question.id} question={question} onDelete={() => void deleteCourseExamQuestionApi(botId, guildId, selectedCourse.id, question.id).then(() => setExam({ ...exam, questions: exam.questions.filter((item) => item.id !== question.id) }))} onEdit={() => { setEditingQuestionId(question.id); setQuestionDraft(toQuestionPayload(question)); }} />
                  ))}
                </div>
              </>
            ) : <p className="text-sm text-zinc-500">Selecione um curso para configurar a prova.</p>}
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "admins" ? (
        <Card>
          <CardHeader><CardTitle>Administradores</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <MultiRoleField disabled={!canManage || saving} label="Cargos administradores" onChange={(adminRoleIds) => void saveSettings({ adminRoleIds })} options={roles} value={dashboard.settings.adminRoleIds} />
              <InputField disabled={!canManage || saving} label="Usuários administradores" onChange={(value) => void saveSettings({ adminUserIds: csv(value) })} value={dashboard.settings.adminUserIds.join(",")} />
              <MultiRoleField disabled={!canManage || saving} label="Cargos instrutores globais" onChange={(globalInstructorRoleIds) => void saveSettings({ globalInstructorRoleIds, generalInstructorRoleIds: globalInstructorRoleIds })} options={roles} value={dashboard.settings.globalInstructorRoleIds ?? []} />
              <InputField disabled={!canManage || saving} label="Usuários instrutores globais" onChange={(value) => void saveSettings({ globalInstructorUserIds: csv(value) })} value={(dashboard.settings.globalInstructorUserIds ?? []).join(",")} />
              <MultiRoleField disabled={!canManage || saving} label="Cargos avaliadores de prova" onChange={(evaluatorRoleIds) => void saveSettings({ evaluatorRoleIds })} options={roles} value={dashboard.settings.evaluatorRoleIds ?? []} />
              <InputField disabled={!canManage || saving} label="Usuários avaliadores de prova" onChange={(value) => void saveSettings({ evaluatorUserIds: csv(value) })} value={(dashboard.settings.evaluatorUserIds ?? []).join(",")} />
              <MultiRoleField disabled={!canManage || saving} label="Cargos que podem usar /curso config" onChange={(configRoleIds) => void saveSettings({ configRoleIds })} options={roles} value={dashboard.settings.configRoleIds ?? []} />
              <InputField disabled={!canManage || saving} label="Usuários que podem usar /curso config" onChange={(value) => void saveSettings({ configUserIds: csv(value) })} value={(dashboard.settings.configUserIds ?? []).join(",")} />
            </div>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {permissionKeys.map((key) => {
                const rule = dashboard.settings.permissionMatrix?.[key] ?? { roleIds: [], userIds: [] };
                return <InputField key={key} disabled={!canManage || saving} label={`${key} - usuários`} onChange={(value) => void saveSettings({ permissionMatrix: { ...(dashboard.settings.permissionMatrix ?? {}), [key]: { ...rule, userIds: csv(value) } } })} value={rule.userIds.join(",")} />;
              })}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "logs" ? (
        <Card>
          <CardHeader><CardTitle>Logs do Sistema</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {dashboard.logs.map((log) => (
              <div className="rounded-lg border border-zinc-800 bg-black/30 px-3 py-2 text-sm text-zinc-300" key={log.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-white">{log.type ?? log.action}</span>
                  <span className="text-xs text-zinc-500">{new Date(log.createdAt).toLocaleString("pt-BR")}</span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">Autor: {log.authorId ?? log.actorId ?? "-"} • Alvo: {log.targetId ?? "-"} • Curso: {log.courseId ?? "-"} • Status: {log.status ?? "-"}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function ProofCompleteness({ questions }: { questions: CourseExamQuestion[] }) {
  const objective = questions.filter((question) => question.type === "selection");
  const written = questions.filter((question) => question.type === "written");
  const complete = questions.length > 0
    && questions.every((question) => question.prompt.trim() && question.points > 0)
    && objective.every((question) => question.alternatives.length >= 2 && question.alternatives.some((option) => option.isCorrect || option.id === question.correctAlternativeId));
  return <div className="rounded-lg border border-zinc-800 bg-black/30 p-3 text-sm text-zinc-300">Status da prova: <Badge variant={complete ? "success" : "warning"}>{complete ? "Completa" : "Incompleta"}</Badge> • Perguntas: {questions.length} • Objetivas: {objective.length} • Discursivas: {written.length}</div>;
}

function QuestionCard({ onDelete, onEdit, question }: { onDelete: () => void; onEdit: () => void; question: CourseExamQuestion }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-black/30 p-3 text-sm text-zinc-300">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-white">Pergunta {question.questionNumber ?? question.order + 1}: {question.prompt}</p>
        <Badge variant={question.type === "written" ? "warning" : "success"}>{question.type === "written" ? "Discursiva" : "Radio/Seleção"}</Badge>
      </div>
      <p className="mt-1 text-xs text-zinc-500">Nota máxima: {question.points}</p>
      {question.type === "selection" ? <p className="mt-2 text-xs text-zinc-400">{question.alternatives.map((option) => `${option.id}) ${option.text} - ${option.score ?? 0} pontos${option.isCorrect ? " - correta" : ""}`).join(" | ")}</p> : null}
      <div className="mt-3 flex gap-2">
        <Button onClick={onEdit} size="sm" type="button" variant="outline">Editar</Button>
        <Button onClick={onDelete} size="sm" type="button" variant="destructive">Excluir</Button>
      </div>
    </div>
  );
}

function toCoursePayload(course: Course): SaveCoursePayload {
  return {
    ...course,
    proofBannerUrl: course.proofBannerUrl ?? null,
    proofInstructionText: course.proofInstructionText ?? null,
    maxStudents: course.maxStudents ?? 30,
    location: course.location ?? null,
    defaultSchedule: course.defaultSchedule ?? null
  };
}

function toQuestionPayload(question: CourseExamQuestion): SaveCourseExamQuestionPayload {
  return { ...question, questionNumber: question.questionNumber ?? question.order + 1 };
}

function toExamLinkDraft(settings: CourseExamDashboard["settings"]): ExamLinkDraft {
  return {
    externalLinkDescription: settings.externalLinkDescription ?? null,
    externalLinkEmoji: settings.externalLinkEmoji ?? null,
    externalLinkEnabled: settings.externalLinkEnabled ?? false,
    externalLinkText: settings.externalLinkText ?? "Acessar material da prova",
    externalLinkUrl: settings.externalLinkUrl ?? null
  };
}

function normalizeQuestion(question: SaveCourseExamQuestionPayload) {
  const questionNumber = Math.max(1, Math.min(100, Number(question.questionNumber ?? 1)));
  return {
    ...question,
    questionNumber,
    order: questionNumber - 1,
    type: question.type,
    alternatives: question.type === "written" ? [] : (question.alternatives ?? []).filter((option) => option.text?.trim()).map((option, index) => ({ ...option, id: option.id || String.fromCharCode(65 + index), order: index, value: option.value || option.id || String.fromCharCode(65 + index), score: parseDecimalNumber(option.score, 0) })),
    correctAlternativeId: question.type === "written" ? null : question.correctAlternativeId ?? (question.alternatives ?? []).find((option) => option.isCorrect)?.id ?? null
  } satisfies SaveCourseExamQuestionPayload;
}

function updateOption(options: SaveCourseExamQuestionPayload["alternatives"], index: number, patch: Record<string, unknown>) {
  return (options ?? []).map((option, itemIndex) => itemIndex === index ? { ...option, ...patch } : option);
}

function sortQuestion(a: CourseExamQuestion, b: CourseExamQuestion) {
  return (a.questionNumber ?? a.order + 1) - (b.questionNumber ?? b.order + 1);
}

function csv(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function toChannelDraft(settings: CoursesDashboard["settings"]): CourseChannelDraft {
  return {
    adminLogChannelId: settings.adminLogChannelId ?? null,
    defaultExpirationHours: settings.defaultExpirationHours ?? 24,
    evaluationChannelId: settings.evaluationChannelId ?? null,
    evaluatorMentionRoleId: settings.evaluatorMentionRoleId ?? null,
    proofLogChannelId: settings.proofLogChannelId ?? null,
    publishChannelId: settings.publishChannelId ?? null,
    resultChannelId: settings.resultChannelId ?? null,
    resultMentionRoleId: settings.resultMentionRoleId ?? null,
    scheduleLogChannelId: settings.scheduleLogChannelId ?? null,
    tempProofCategoryId: settings.tempProofCategoryId ?? null
  };
}

function InputField({ disabled, label, onChange, value }: { disabled?: boolean; label: string; onChange: (value: string) => void; value: string }) {
  return <label className="grid gap-2 text-sm"><span className="font-semibold text-zinc-300">{label}</span><input className="h-10 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value} /></label>;
}

function NumberInputField({ disabled, label, max, min, onChange, value }: { disabled?: boolean; label: string; max: number; min: number; onChange: (value: number) => void; value: number }) {
  return (
    <label className="grid gap-2 text-sm">
      <span className="font-semibold text-zinc-300">{label}</span>
      <input
        className="h-10 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100"
        disabled={disabled}
        max={max}
        min={min}
        onChange={(event) => {
          const next = event.currentTarget.valueAsNumber;
          if (Number.isFinite(next)) onChange(Math.max(min, Math.min(max, Math.trunc(next))));
        }}
        step={1}
        type="number"
        value={value}
      />
    </label>
  );
}

function DecimalInputField({ disabled, label, onCommit, value }: { disabled?: boolean; label: string; onCommit: (value: number) => void; value: number }) {
  const [draft, setDraft] = useState(formatDecimalInput(value));

  useEffect(() => {
    setDraft(formatDecimalInput(value));
  }, [value]);

  function commit() {
    const parsed = parseDecimalNumber(draft, value);
    onCommit(parsed);
    setDraft(formatDecimalInput(parsed));
  }

  return (
    <label className="grid gap-2 text-sm">
      <span className="font-semibold text-zinc-300">{label}</span>
      <input
        className="h-10 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100"
        disabled={disabled}
        inputMode="decimal"
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        value={draft}
      />
    </label>
  );
}

function TextAreaField({ disabled, label, onChange, value }: { disabled?: boolean; label: string; onChange: (value: string) => void; value: string }) {
  return <label className="grid gap-2 text-sm"><span className="font-semibold text-zinc-300">{label}</span><textarea className="min-h-24 rounded-lg border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-100" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value} /></label>;
}

function ToggleField({ disabled, label, onChange, value }: { disabled?: boolean; label: string; onChange: (value: boolean) => void; value: boolean }) {
  return <label className="flex h-10 items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-200"><span>{label}</span><input checked={value} disabled={disabled} onChange={(event) => onChange(event.target.checked)} type="checkbox" /></label>;
}

function SelectField({ disabled, label, onChange, options, value }: { disabled?: boolean; label: string; onChange: (value: string | null) => void; options: Array<{ id: string; name: string }>; value: string }) {
  return <FivemResourceSelect disabled={Boolean(disabled)} label={label} onChange={onChange} options={options.map((option) => ({ id: option.id, name: option.name }))} placeholder="Não configurado" prefix="#" value={value || null} />;
}

function RoleSelect({ disabled, label, onChange, options, value }: { disabled?: boolean; label: string; onChange: (value: string | null) => void; options: Array<{ id: string; name: string }>; value: string }) {
  return <FivemResourceSelect disabled={Boolean(disabled)} label={label} onChange={onChange} options={options.map((option) => ({ id: option.id, name: option.name }))} placeholder="Não configurado" prefix="@" value={value || null} />;
}

function SelectValueField({ disabled, label, onChange, options, value }: { disabled?: boolean; label: string; onChange: (value: string) => void; options: Array<[string, string]>; value: string }) {
  return <label className="grid gap-2 text-sm"><span className="font-semibold text-zinc-300">{label}</span><select className="h-10 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100" disabled={disabled} onChange={(event) => onChange(event.target.value)} value={value}>{options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>;
}

function MultiRoleField({ disabled, label, onChange, options, value }: { disabled?: boolean; label: string; onChange: (value: string[]) => void; options: Array<{ id: string; name: string }>; value: string[] }) {
  return <div><FivemResourceMultiSelect disabled={Boolean(disabled)} label={label} onChange={onChange} options={options.map((option) => ({ id: option.id, name: option.name }))} prefix="@" values={value} /></div>;
}

function parseDecimalNumber(value: unknown, fallback: number) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!normalized) return fallback;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatDecimalInput(value: number) {
  return String(value).replace(".", ",");
}
