import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, FileQuestion, Image, ListChecks, Loader2, PlusCircle, Save, Search, ShieldCheck, SlidersHorizontal, Trash2 } from "lucide-react";
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

const COURSE_EMOJI = "<:trofeu:1525682256654504087>";

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
  emoji: COURSE_EMOJI,
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
  correctAlternativeIds: ["C"],
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
  const [proofSearch, setProofSearch] = useState("");
  const [editingProofId, setEditingProofId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [examLoading, setExamLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const examLoadSeqRef = useRef(0);
  const lastChannelSettingsRef = useRef<CourseChannelDraft | null>(null);

  const selectedCourse = useMemo(() => dashboard?.courses.find((course) => course.id === selectedCourseId) ?? null, [dashboard, selectedCourseId]);
  const proofCourses = useMemo(() => {
    const query = normalizeSearch(proofSearch);
    const courses = dashboard?.courses ?? [];
    if (!query) return courses;
    return courses.filter((course) => normalizeSearch(`${course.name} ${course.code ?? ""} ${course.description ?? ""}`).includes(query));
  }, [dashboard?.courses, proofSearch]);
  const channelSettingsChanged = useMemo(() => Boolean(dashboard && channelDraft && JSON.stringify(channelDraft) !== JSON.stringify(toChannelDraft(dashboard.settings))), [channelDraft, dashboard]);
  const textChannels = liveOptions?.channels.filter((channel) => ["text", "announcement"].includes(channel.type)) ?? [];
  const categories = liveOptions?.categories ?? [];
  const roles = liveOptions?.roles ?? [];

  function showSuccess(value: string) {
    setError("");
    setMessage(value);
  }

  function showError(value: string) {
    setMessage("");
    setError(value);
  }

  useEffect(() => {
    void load();
  }, [botId, guildId]);

  useEffect(() => {
    if (activeTab === "proofs") return;
    const timer = window.setInterval(() => {
      void getCoursesDashboard(botId, guildId).then((data) => setDashboard(data)).catch(() => null);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [activeTab, botId, guildId]);

  useEffect(() => {
    const next = dashboard ? toChannelDraft(dashboard.settings) : null;
    setChannelDraft((current) => {
      const previous = lastChannelSettingsRef.current;
      const hasLocalChanges = Boolean(current && previous && JSON.stringify(current) !== JSON.stringify(previous));
      lastChannelSettingsRef.current = next;
      return hasLocalChanges ? current : next;
    });
  }, [dashboard?.settings]);

  useEffect(() => {
    if (!selectedCourse) {
      examLoadSeqRef.current += 1;
      setCourseDraft(emptyCourse);
      setExam(null);
      setExamLoading(false);
      setExamLinkDraft(null);
      setEditingQuestionId(null);
      setQuestionDraft(emptyQuestion);
      return;
    }
    setCourseDraft(toCoursePayload(selectedCourse));
    setEditingQuestionId(null);
    setQuestionDraft(emptyQuestion);
    if (activeTab === "proofs") void loadExam(selectedCourse.id);
  }, [activeTab, botId, guildId, selectedCourse?.id]);

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
      showError(err instanceof Error ? err.message : "Não foi possível carregar o Sistema de Curso.");
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
      setDashboard((current) => current ? { ...current, settings } : current);
      showSuccess("Configurações salvas.");
      return settings;
    } catch (err) {
      showError(err instanceof Error ? err.message : "Não foi possível salvar as configurações.");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function saveChannelSettings() {
    if (!dashboard || !channelDraft) return;
    const patch = changedChannelSettings(channelDraft, dashboard.settings);
    if (!Object.keys(patch).length) return;
    const settings = await saveSettings(patch);
    if (settings) {
      const nextDraft = toChannelDraft(settings);
      lastChannelSettingsRef.current = nextDraft;
      setChannelDraft(nextDraft);
    }
  }

  function updateChannelDraft(patch: Partial<CourseChannelDraft>) {
    setChannelDraft((current) => current ? { ...current, ...patch } : current);
  }

  async function saveCourse() {
    if (!dashboard || !courseDraft.name?.trim()) {
      showError("Informe o nome do curso.");
      return;
    }
    setSaving(true);
    try {
      const wasEditing = Boolean(selectedCourse);
      const saved = selectedCourse
        ? await updateCourseApi(botId, guildId, selectedCourse.id, courseDraft)
        : await createCourseApi(botId, guildId, courseDraft);
      setDashboard((current) => current ? {
        ...current,
        courses: wasEditing ? current.courses.map((course) => course.id === saved.id ? saved : course) : [saved, ...current.courses]
      } : current);
      setSelectedCourseId(saved.id);
      showSuccess("Curso cadastrado com sucesso.");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Não foi possível salvar o curso.");
    } finally {
      setSaving(false);
    }
  }

  async function setCourseActive(active: boolean) {
    if (!selectedCourse) return;
    const courseId = selectedCourse.id;
    setSaving(true);
    setError("");
    try {
      const saved = await updateCourseApi(botId, guildId, courseId, { active });
      setDashboard((current) => current ? {
        ...current,
        courses: current.courses.map((course) => course.id === saved.id ? saved : course)
      } : current);
      setCourseDraft((current) => ({ ...current, active: saved.active }));
      showSuccess(active ? "Curso ativado." : "Curso desativado.");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Não foi possível alterar o status do curso.");
    } finally {
      setSaving(false);
    }
  }

  async function removeCourse() {
    if (!dashboard || !selectedCourse) return;
    setSaving(true);
    try {
      const courseId = selectedCourse.id;
      await deleteCourseApi(botId, guildId, courseId);
      setDashboard((current) => current ? { ...current, courses: current.courses.filter((course) => course.id !== courseId) } : current);
      setSelectedCourseId(null);
      showSuccess("Curso excluído.");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Não foi possível excluir o curso.");
    } finally {
      setSaving(false);
    }
  }

  async function loadExam(courseId: string) {
    const requestId = ++examLoadSeqRef.current;
    setExam(null);
    setExamLoading(true);
    setError("");
    try {
      const data = await getCourseExamDashboard(botId, guildId, courseId);
      if (requestId !== examLoadSeqRef.current) return;
      if (data.settings.courseId !== courseId) {
        throw new Error("A prova carregada não pertence ao curso selecionado.");
      }
      setExam(data);
    } catch (err) {
      if (requestId !== examLoadSeqRef.current) return;
      showError(err instanceof Error ? err.message : "Não foi possível carregar a prova.");
    } finally {
      if (requestId === examLoadSeqRef.current) setExamLoading(false);
    }
  }

  async function saveQuestion() {
    if (!selectedCourse || !exam || exam.settings.courseId !== selectedCourse.id || !questionDraft.prompt?.trim()) return;
    const courseId = selectedCourse.id;
    const payload = normalizeQuestion(questionDraft);
    const validationError = validateQuestionPayload(payload);
    if (validationError) {
      showError(validationError);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const saved = editingQuestionId
        ? await updateCourseExamQuestionApi(botId, guildId, courseId, editingQuestionId, payload)
        : await createCourseExamQuestionApi(botId, guildId, courseId, payload);
      setExam((current) => current && current.settings.courseId === courseId ? {
        ...current,
        questions: editingQuestionId
          ? current.questions.map((question) => question.id === saved.id ? saved : question).sort(sortQuestion)
          : [...current.questions, saved].sort(sortQuestion)
      } : current);
      setEditingQuestionId(null);
      setQuestionDraft(emptyQuestion);
      showSuccess("Pergunta salva.");
    } catch (err) {
      showError(readApiError(err, "Não foi possível salvar a pergunta."));
    } finally {
      setSaving(false);
    }
  }

  async function saveExamLinkSettings() {
    if (!selectedCourse || !exam || exam.settings.courseId !== selectedCourse.id || !examLinkDraft) return;
    const courseId = selectedCourse.id;
    if (examLinkDraft.externalLinkEnabled && examLinkDraft.externalLinkUrl && !examLinkDraft.externalLinkUrl.startsWith("https://")) {
      showError("O link externo precisa começar com https://.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const settings = await saveCourseExamSettings(botId, guildId, courseId, examLinkDraft);
      setExam((current) => current && current.settings.courseId === courseId ? { ...current, settings } : current);
      showSuccess("Link externo da prova salvo.");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Não foi possível salvar o link externo.");
    } finally {
      setSaving(false);
    }
  }

  async function saveSelectedExamSettings(patch: Partial<CourseExamDashboard["settings"]>) {
    if (!selectedCourse || !exam || exam.settings.courseId !== selectedCourse.id) return;
    const courseId = selectedCourse.id;
    setSaving(true);
    setError("");
    try {
      const settings = await saveCourseExamSettings(botId, guildId, courseId, patch);
      setExam((current) => current && current.settings.courseId === courseId ? { ...current, settings } : current);
      showSuccess("Configurações da prova salvas.");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Não foi possível salvar as configurações da prova.");
    } finally {
      setSaving(false);
    }
  }

  function openNewProofRegistration() {
    setEditingProofId(null);
    setSelectedCourseId(null);
    setCourseDraft({
      ...emptyCourse,
      buttonLabels: {
        cancel: "Cancelar Curso",
        enter: "Entrar no Curso",
        leave: "Sair do Curso",
        start: "Realizar Prova"
      },
      color: "#FFD500"
    });
    setActiveTab("courses");
    showSuccess("Cadastre o curso/prova. Depois de salvar, ele aparece em Configuração de Provas para configurar perguntas e gabarito.");
  }

  function openProofEditor(courseId: string) {
    setSelectedCourseId(courseId);
    setEditingProofId(courseId);
    setEditingQuestionId(null);
    setQuestionDraft(emptyQuestion);
    if (courseId === selectedCourseId) void loadExam(courseId);
  }

  function changeLinkedProofCourse(courseId: string) {
    if (courseId === selectedCourseId) return;
    if (editingQuestionId || questionDraft.prompt?.trim()) {
      const discard = window.confirm("Existem alterações no formulário de pergunta. Deseja trocar o curso vinculado mesmo assim?");
      if (!discard) return;
    }
    setSelectedCourseId(courseId);
    setEditingProofId(courseId);
    setEditingQuestionId(null);
    setQuestionDraft(emptyQuestion);
    showSuccess("Curso vinculado selecionado. Configure a prova deste curso.");
  }

  function closeProofEditor() {
    if (editingQuestionId || questionDraft.prompt?.trim()) {
      const discard = window.confirm("Existem alterações no formulário de pergunta. Deseja sair mesmo assim?");
      if (!discard) return;
    }
    setEditingProofId(null);
    setEditingQuestionId(null);
    setQuestionDraft(emptyQuestion);
  }

  function finishProofEditing() {
    setEditingProofId(null);
    setEditingQuestionId(null);
    setQuestionDraft(emptyQuestion);
    showSuccess(selectedCourse ? `Prova de ${selectedCourse.name} salva com sucesso.` : "Prova salva com sucesso.");
  }

  async function setSelectedCourseProofMode(enabled: boolean) {
    if (!selectedCourse || !exam || exam.settings.courseId !== selectedCourse.id) return;
    const courseId = selectedCourse.id;
    setSaving(true);
    setError("");
    try {
      const settings = await saveCourseExamSettings(botId, guildId, courseId, { enabled });
      setExam((current) => current && current.settings.courseId === courseId ? { ...current, settings } : current);
      showSuccess(enabled
        ? `Modo de perguntas ativado para ${selectedCourse.name}.`
        : `Modo de perguntas desativado para ${selectedCourse.name}.`);
    } catch (err) {
      showError(err instanceof Error ? err.message : "Não foi possível alterar o modo de perguntas deste curso.");
    } finally {
      setSaving(false);
    }
  }

  async function saveImage() {
    if (!dashboard || !imageDraft.name.trim() || !imageDraft.url.trim()) {
      showError("Informe nome e URL da imagem.");
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
                <ToggleField disabled={!canManage || saving} label="Curso ativo" onChange={(active) => setCourseDraft({ ...courseDraft, active })} value={courseDraft.active ?? true} />
              </div>
              <TextAreaField disabled={!canManage} label="Descrição" onChange={(description) => setCourseDraft({ ...courseDraft, description })} value={courseDraft.description ?? ""} />
              <TextAreaField disabled={!canManage} label="Texto do painel de publicação" onChange={(publishText) => setCourseDraft({ ...courseDraft, publishText })} value={courseDraft.publishText ?? ""} />
              <TextAreaField disabled={!canManage} label="Texto de instrução da prova" onChange={(proofInstructionText) => setCourseDraft({ ...courseDraft, proofInstructionText })} value={courseDraft.proofInstructionText ?? ""} />
              <div className="flex flex-wrap gap-2">
                <Button disabled={!canManage || saving} onClick={() => void saveCourse()} type="button"><Save className="h-4 w-4" />Salvar</Button>
                {selectedCourse ? <Button disabled={!canManage || saving} onClick={() => void setCourseActive(!(courseDraft.active ?? true))} type="button" variant="outline">{courseDraft.active ?? true ? "Desativar curso" : "Ativar curso"}</Button> : null}
                {selectedCourse ? <Button disabled={!canManage || saving} onClick={() => void removeCourse()} type="button" variant="destructive"><Trash2 className="h-4 w-4" />Excluir</Button> : null}
              </div>
            </CardContent>
          </Card>
          <Card className="xl:col-span-2">
            <CardHeader><CardTitle>Alunos e andamento das provas</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {(dashboard.enrollments ?? []).filter((item) => !selectedCourseId || item.courseId === selectedCourseId).map((item) => (
                <div className="grid gap-2 rounded-lg border border-zinc-800 bg-black/30 p-3 text-sm md:grid-cols-[minmax(0,1fr)_180px_130px_180px]" key={item.id}>
                  <div><p className="font-semibold text-white">{item.studentName}</p><p className="text-xs text-zinc-500">{item.studentId}</p></div>
                  <div><p className="text-xs text-zinc-500">Status</p><p>{courseExamStatusLabel(item.examStatus)}</p></div>
                  <div><p className="text-xs text-zinc-500">Tentativas</p><p>{item.attemptNumber}</p></div>
                  <div><p className="text-xs text-zinc-500">Canal / horários</p><p>{item.examChannelId || "-"}</p><p className="text-xs text-zinc-500">Início: {item.examStartedAt ? new Date(item.examStartedAt).toLocaleString("pt-BR") : "-"}</p><p className="text-xs text-zinc-500">Conclusão: {item.completedAt ? new Date(item.completedAt).toLocaleString("pt-BR") : "-"}</p></div>
                </div>
              ))}
              {!(dashboard.enrollments ?? []).some((item) => !selectedCourseId || item.courseId === selectedCourseId) ? <p className="text-sm text-zinc-500">Nenhum aluno inscrito neste curso.</p> : null}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {activeTab === "proofs" && !editingProofId ? (
        <Card>
          <CardHeader><CardTitle>Sistema de Provas</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <label className="relative block w-full lg:max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <input
                  className="h-10 w-full rounded-lg border border-zinc-800 bg-black pl-9 pr-3 text-sm text-zinc-100"
                  onChange={(event) => setProofSearch(event.target.value)}
                  placeholder="Pesquisar prova..."
                  value={proofSearch}
                />
              </label>
              <Button disabled={!canManage || saving} onClick={openNewProofRegistration} type="button">
                <PlusCircle className="h-4 w-4" />
                Criar nova prova
              </Button>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {proofCourses.map((course) => (
                <ProofRegistryItem
                  course={course}
                  isSelected={selectedCourseId === course.id}
                  key={course.id}
                  onEdit={() => openProofEditor(course.id)}
                  onSelect={() => openProofEditor(course.id)}
                  selectedExam={selectedCourseId === course.id ? exam : null}
                />
              ))}
            </div>
            {!proofCourses.length ? (
              <div className="rounded-lg border border-zinc-800 bg-black/30 p-5 text-sm text-zinc-400">
                <p className="font-semibold text-white">Nenhuma prova foi cadastrada.</p>
                <p className="mt-1">Crie uma prova e vincule-a a um curso para começar.</p>
                <Button className="mt-4" disabled={!canManage || saving} onClick={openNewProofRegistration} type="button">
                  <PlusCircle className="h-4 w-4" />
                  Criar nova prova
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "proofs" && editingProofId ? (
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle>{selectedCourse ? `Editar prova: ${selectedCourse.name}` : "Editar prova"}</CardTitle>
                <p className="mt-1 text-sm text-zinc-500">Sistema de Provas &gt; {selectedCourse?.name ?? "Prova selecionada"}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={saving} onClick={finishProofEditing} type="button"><Save className="h-4 w-4" />Salvar prova</Button>
                <Button disabled={saving} onClick={closeProofEditor} type="button" variant="outline">Voltar</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {selectedCourse && exam && exam.settings.courseId === selectedCourse.id ? (
              <>
                <div className="rounded-lg border border-[#FFD500]/25 bg-[#FFD500]/10 p-4">
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-end">
                    <div>
                      <p className="font-semibold text-white">Curso vinculado à prova</p>
                      <p className="mt-1 text-sm text-zinc-400">Selecione qual curso usa esta prova. O sistema vai carregar somente as perguntas e configurações do curso escolhido.</p>
                    </div>
                    <SelectValueField disabled={!canManage || saving} label="Curso que usa esta prova" onChange={changeLinkedProofCourse} options={dashboard.courses.map((course) => [course.id, course.name])} value={selectedCourse.id} />
                  </div>
                </div>
                <CourseProofModeCard
                  course={selectedCourse}
                  disabled={!canManage || saving}
                  enabled={exam.settings.enabled}
                  onToggle={(enabled) => void setSelectedCourseProofMode(enabled)}
                  questions={exam.questions}
                  saving={saving}
                />
                <div className="grid gap-3 md:grid-cols-4">
                  <DecimalInputField disabled={!canManage || saving} label="Nota mínima" onCommit={(minScore) => void saveSelectedExamSettings({ minScore })} value={exam.settings.minScore} />
                  <DecimalInputField disabled={!canManage || saving} label="Nota máxima manual" onCommit={(manualQuestionMaxScore) => void saveSelectedExamSettings({ manualQuestionMaxScore })} value={exam.settings.manualQuestionMaxScore ?? 10} />
                  <ToggleField disabled={!canManage || saving} label="Aprovação sempre manual" onChange={(manualApproval) => void saveSelectedExamSettings({ manualApproval })} value={exam.settings.manualApproval ?? true} />
                  <ToggleField disabled={!canManage || saving} label="Modo deste curso ativo" onChange={(enabled) => void setSelectedCourseProofMode(enabled)} value={exam.settings.enabled} />
                  <SelectField disabled={!canManage || saving} label="Categoria dos canais da prova" onChange={(temporaryCategoryId) => void saveSelectedExamSettings({ temporaryCategoryId })} options={categories} value={exam.settings.temporaryCategoryId ?? ""} />
                  <SelectField disabled={!canManage || saving} label="Canal de correção manual" onChange={(correctionChannelId) => void saveSelectedExamSettings({ correctionChannelId })} options={textChannels} value={exam.settings.correctionChannelId ?? ""} />
                  <SelectField disabled={!canManage || saving} label="Canal de resultado da prova" onChange={(resultChannelId) => void saveSelectedExamSettings({ resultChannelId })} options={textChannels} value={exam.settings.resultChannelId ?? ""} />
                  <SelectField disabled={!canManage || saving} label="Canal de logs da prova" onChange={(logChannelId) => void saveSelectedExamSettings({ logChannelId })} options={textChannels} value={exam.settings.logChannelId ?? ""} />
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
                  <p className="mb-3 font-semibold text-white">{editingQuestionId ? "Editar pergunta" : "Adicionar pergunta"}</p>
                  <div className="grid gap-3 md:grid-cols-3">
                    <InputField disabled={!canManage || saving} label="Número da pergunta" onChange={(value) => setQuestionDraft({ ...questionDraft, questionNumber: Number(value) || 1, order: Math.max(0, (Number(value) || 1) - 1) })} value={String(questionDraft.questionNumber ?? 1)} />
                    <SelectValueField disabled={!canManage || saving} label="Tipo" onChange={(type) => setQuestionDraft({ ...questionDraft, type: type as "selection" | "multiple" | "written" })} options={[["selection", "Objetiva"], ["multiple", "Múltipla escolha"], ["written", "Discursiva"]]} value={questionDraft.type} />
                    <DecimalInputField disabled={!canManage || saving} label="Nota máxima" onCommit={(points) => setQuestionDraft({ ...questionDraft, points })} value={questionDraft.points ?? 10} />
                  </div>
                  <div className="mt-3 space-y-3">
                    <TextAreaField disabled={!canManage || saving} label="Pergunta" onChange={(prompt) => setQuestionDraft({ ...questionDraft, prompt })} value={questionDraft.prompt} />
                    <TextAreaField disabled={!canManage || saving} label="Descrição opcional" onChange={(description) => setQuestionDraft({ ...questionDraft, description })} value={questionDraft.description ?? ""} />
                    {questionDraft.type !== "written" ? (
                      <div className="grid gap-3 md:grid-cols-2">
                        {(questionDraft.alternatives ?? []).map((option, index) => (
                          <div className="rounded-lg border border-zinc-800 p-3" key={option.id ?? index}>
                            <InputField disabled={!canManage || saving} label={`Resposta ${index + 1}`} onChange={(text) => setQuestionDraft({ ...questionDraft, alternatives: updateOption(questionDraft.alternatives, index, { text }) })} value={option.text} />
                            <DecimalInputField disabled={!canManage || saving} label="Pontuação" onCommit={(score) => setQuestionDraft({ ...questionDraft, alternatives: updateOption(questionDraft.alternatives, index, { score }) })} value={option.score ?? 0} />
                            <ToggleField disabled={!canManage || saving} label="Correta" onChange={(checked) => setQuestionDraft(toggleCorrectAlternative(questionDraft, option.id, index, checked))} value={Boolean(option.isCorrect)} />
                          </div>
                        ))}
                      </div>
                    ) : <InputField disabled={!canManage || saving} label="Placeholder do modal" onChange={(placeholder) => setQuestionDraft({ ...questionDraft, placeholder })} value={questionDraft.placeholder ?? ""} />}
                    <Button disabled={!canManage || saving || !questionDraft.prompt?.trim()} onClick={() => void saveQuestion()} type="button"><PlusCircle className="h-4 w-4" />Salvar pergunta</Button>
                  </div>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  {[...exam.questions].sort(sortQuestion).map((question) => (
                    <QuestionCard key={question.id} question={question} onDelete={() => void deleteCourseExamQuestionApi(botId, guildId, selectedCourse.id, question.id).then(() => setExam((current) => current && current.settings.courseId === selectedCourse.id ? { ...current, questions: current.questions.filter((item) => item.id !== question.id) } : current))} onEdit={() => { setEditingQuestionId(question.id); setQuestionDraft(toQuestionPayload(question)); }} />
                  ))}
                </div>
              </>
            ) : selectedCourse && examLoading ? (
              <div className="flex min-h-24 items-center gap-3 rounded-lg border border-zinc-800 bg-black/30 p-4 text-sm text-zinc-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando prova de {selectedCourse.name}...
              </div>
            ) : <p className="text-sm text-zinc-500">Selecione uma prova para editar.</p>}
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

function CourseProofModeCard({ course, disabled, enabled, onToggle, questions, saving }: {
  course: Course;
  disabled?: boolean;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  questions: CourseExamQuestion[];
  saving?: boolean;
}) {
  const stats = getProofStats(questions);
  const statusLabel = enabled ? "Ativo" : "Desativado";
  return (
    <div className={`rounded-lg border p-4 ${enabled ? "border-yellow-400/40 bg-yellow-400/10" : "border-zinc-800 bg-black/30"}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-white">Modo de perguntas do curso</p>
            <Badge variant={enabled ? "warning" : "muted"}>{statusLabel}</Badge>
            <Badge variant={course.active ? "success" : "muted"}>{course.active ? "Curso ativo" : "Curso desativado"}</Badge>
          </div>
          <p className="mt-1 text-sm text-zinc-400">
            Curso selecionado: <span className="font-semibold text-yellow-200">{course.name}</span>. Ao iniciar uma prova deste curso, o bot usa somente as perguntas configuradas aqui.
          </p>
          <p className="mt-2 text-xs text-zinc-500">
            Perguntas ativas: {stats.active} de {stats.total} • Objetivas: {stats.objective} • Discursivas: {stats.written}
          </p>
        </div>
        <Button disabled={disabled} onClick={() => onToggle(!enabled)} type="button" variant={enabled ? "outline" : "default"}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileQuestion className="h-4 w-4" />}
          {enabled ? "Desativar modo" : "Ativar modo deste curso"}
        </Button>
      </div>
      {!stats.complete ? (
        <p className="mt-3 rounded-md border border-yellow-400/25 bg-black/30 px-3 py-2 text-xs text-yellow-100">
          Para ativar, mantenha pelo menos uma pergunta ativa, com enunciado, pontuação e gabarito quando for objetiva.
        </p>
      ) : null}
    </div>
  );
}

function ProofRegistryItem({ course, isSelected, onEdit, onSelect, selectedExam }: {
  course: Course;
  isSelected: boolean;
  onEdit: () => void;
  onSelect: () => void;
  selectedExam: CourseExamDashboard | null;
}) {
  const selectedStats = selectedExam ? getProofStats(selectedExam.questions) : null;
  return (
    <div className={`rounded-lg border p-4 transition ${isSelected ? "border-[#FFD500]/55 bg-[#FFD500]/10 shadow-[0_0_24px_rgba(255,213,0,0.12)]" : "border-zinc-800 bg-black/30 hover:border-[#FFD500]/35 hover:bg-[#FFD500]/5"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">{course.name}</p>
          <p className="mt-1 truncate text-xs text-zinc-500">{course.code || "sem identificador"}</p>
        </div>
        <Badge variant={course.active ? "success" : "muted"}>{course.active ? "Curso ativo" : "Curso off"}</Badge>
      </div>
      <p className="mt-3 line-clamp-2 min-h-10 text-xs text-zinc-500">{course.description || "Sem descrição cadastrada."}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {isSelected && selectedExam ? <Badge variant={selectedExam.settings.enabled ? "warning" : "muted"}>{selectedExam.settings.enabled ? "Prova ativa" : "Prova inativa"}</Badge> : <Badge variant="muted">Selecionar</Badge>}
        {selectedStats ? <Badge variant={selectedStats.complete ? "success" : "warning"}>{selectedStats.active}/{selectedStats.total} perguntas</Badge> : <Badge variant="muted">Perguntas ao editar</Badge>}
        {selectedStats ? <Badge variant="default">Nota max: {formatScoreValue(selectedStats.maxScore)}</Badge> : null}
      </div>
      <p className="mt-3 text-xs text-zinc-500">Curso vinculado: <span className="text-zinc-300">{course.name}</span></p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={onEdit} size="sm" type="button"><FileQuestion className="h-4 w-4" />Editar prova</Button>
        <Button onClick={onSelect} size="sm" type="button" variant="outline">Vincular cursos</Button>
      </div>
    </div>
  );
}

function ProofCompleteness({ questions }: { questions: CourseExamQuestion[] }) {
  const stats = getProofStats(questions);
  return <div className="rounded-lg border border-zinc-800 bg-black/30 p-3 text-sm text-zinc-300">Status da prova: <Badge variant={stats.complete ? "success" : "warning"}>{stats.complete ? "Completa" : "Incompleta"}</Badge> • Perguntas ativas: {stats.active} • Total: {stats.total} • Objetivas: {stats.objective} • Discursivas: {stats.written}</div>;
}

function getProofStats(questions: CourseExamQuestion[]) {
  const activeQuestions = questions.filter((question) => question.active !== false);
  const objective = activeQuestions.filter((question) => question.type === "selection" || question.type === "multiple");
  const written = activeQuestions.filter((question) => question.type === "written");
  const complete = activeQuestions.length > 0
    && activeQuestions.every((question) => question.prompt.trim() && question.points > 0)
    && objective.every((question) => question.alternatives.length >= 2 && hasCorrectAlternative(question));
  return {
    active: activeQuestions.length,
    complete,
    maxScore: activeQuestions.reduce((total, question) => total + (Number(question.points) || 0), 0),
    objective: objective.length,
    total: questions.length,
    written: written.length
  };
}

function QuestionCard({ onDelete, onEdit, question }: { onDelete: () => void; onEdit: () => void; question: CourseExamQuestion }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-black/30 p-3 text-sm text-zinc-300">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-white">Pergunta {question.questionNumber ?? question.order + 1}: {question.prompt}</p>
        <Badge variant={question.type === "written" ? "warning" : "success"}>{question.type === "written" ? "Discursiva" : question.type === "multiple" ? "Múltipla escolha" : "Objetiva"}</Badge>
      </div>
      <p className="mt-1 text-xs text-zinc-500">Nota máxima: {question.points}</p>
      {question.type !== "written" ? <p className="mt-2 text-xs text-zinc-400">{question.alternatives.map((option) => `${option.id}) ${option.text} - ${option.score ?? 0} pontos${isCorrectAlternative(question, option.id) ? " - correta" : ""}`).join(" | ")}</p> : null}
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
  const alternatives = question.type === "written" ? [] : (question.alternatives ?? []).filter((option) => option.text?.trim()).map((option, index) => ({ ...option, id: option.id || String.fromCharCode(65 + index), order: index, value: option.value || option.id || String.fromCharCode(65 + index), score: parseDecimalNumber(option.score, 0) }));
  const correctAlternativeIds = question.type === "multiple"
    ? alternatives.filter((option) => option.isCorrect || question.correctAlternativeIds?.includes(option.id)).map((option) => option.id)
    : [];
  return {
    ...question,
    questionNumber,
    order: questionNumber - 1,
    type: question.type,
    alternatives,
    correctAlternativeId: question.type === "written" ? null : question.type === "multiple" ? null : question.correctAlternativeId ?? alternatives.find((option) => option.isCorrect)?.id ?? null,
    correctAlternativeIds
  } satisfies SaveCourseExamQuestionPayload;
}

function validateQuestionPayload(question: SaveCourseExamQuestionPayload) {
  if (!question.prompt?.trim()) return "Informe o texto da pergunta.";
  if (question.prompt.trim().length > 1200) return "A pergunta pode ter no máximo 1200 caracteres.";
  if ((question.description ?? "").length > 1200) return "A descrição pode ter no máximo 1200 caracteres.";
  if (question.type !== "written") {
    const alternatives = question.alternatives ?? [];
    if (alternatives.length > 10) return "A pergunta pode ter no máximo 10 alternativas.";
    const longAlternative = alternatives.find((option) => option.text.length > 500);
    if (longAlternative) return `A alternativa ${longAlternative.id ?? ""} pode ter no máximo 500 caracteres.`.trim();
  }
  return "";
}

function readApiError(error: unknown, fallback: string) {
  const response = (error as { response?: { data?: unknown; status?: number } } | null)?.response;
  const data = response?.data;
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const direct = record.message ?? record.error;
    if (typeof direct === "string" && direct.trim()) return direct;
    const issues = record.issues ?? record.errors;
    if (Array.isArray(issues) && issues.length) {
      const first = issues[0] as Record<string, unknown>;
      if (typeof first.message === "string") return first.message;
    }
  }
  if (response?.status === 400) return `${fallback} Verifique os campos da pergunta.`;
  return error instanceof Error ? error.message : fallback;
}

function toggleCorrectAlternative(question: SaveCourseExamQuestionPayload, optionId: string, index: number, checked: boolean) {
  if (question.type === "multiple") {
    const current = new Set(question.correctAlternativeIds ?? []);
    if (checked) current.add(optionId);
    else current.delete(optionId);
    return {
      ...question,
      alternatives: (question.alternatives ?? []).map((item, itemIndex) => ({ ...item, isCorrect: itemIndex === index ? checked : Boolean(item.isCorrect) })),
      correctAlternativeId: null,
      correctAlternativeIds: [...current]
    };
  }
  return {
    ...question,
    correctAlternativeId: checked ? optionId : question.correctAlternativeId,
    correctAlternativeIds: [],
    alternatives: (question.alternatives ?? []).map((item, itemIndex) => ({ ...item, isCorrect: itemIndex === index ? checked : false }))
  };
}

function hasCorrectAlternative(question: CourseExamQuestion) {
  return question.alternatives.some((option) => isCorrectAlternative(question, option.id));
}

function isCorrectAlternative(question: CourseExamQuestion, optionId: string) {
  return question.correctAlternativeIds?.includes(optionId) || question.correctAlternativeId === optionId || question.alternatives.find((option) => option.id === optionId)?.isCorrect === true;
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

function courseExamStatusLabel(status: CoursesDashboard["enrollments"][number]["examStatus"]) {
  const labels: Record<typeof status, string> = {
    NOT_AVAILABLE: "Inscrito",
    AVAILABLE: "Prova disponível",
    STARTING: "Criando canal",
    IN_PROGRESS: "Realizando prova",
    COMPLETED: "Prova concluída",
    APPROVED: "Aprovado",
    FAILED: "Reprovado",
    CANCELED: "Cancelado",
    EXPIRED: "Canal expirado"
  };
  return labels[status];
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

function changedChannelSettings(draft: CourseChannelDraft, settings: CoursesDashboard["settings"]) {
  const current = toChannelDraft(settings);
  const patch: Partial<CourseChannelDraft> = {};
  (Object.keys(draft) as Array<keyof CourseChannelDraft>).forEach((key) => {
    if (draft[key] !== current[key]) patch[key] = draft[key] as never;
  });
  return patch;
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

function formatScoreValue(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(".", ",");
}

function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}
