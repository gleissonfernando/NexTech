import { useEffect, useMemo, useState } from "react";
import { BookOpen, CheckCircle2, Loader2, Plus, Save, Trash2, Upload } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { FivemResourceMultiSelect, FivemResourceSelect } from "../fivem/FivemResourceSelect";
import {
  createCourseApi,
  deleteCourseApi,
  getCoursesDashboard,
  getGuildLiveOptions,
  publishCoursePanel,
  saveCourseSettings,
  updateCourseApi
} from "../../lib/api";
import type { Course, CoursesDashboard, GuildLiveOptions, SaveCoursePayload } from "../../types";

type CoursesPanelProps = {
  botId: string;
  canManage: boolean;
  guildId: string;
};

const emptyCourse: SaveCoursePayload = {
  active: true,
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
  publishText: null,
  startedText: null,
  thumbnailUrl: null
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
  const selectedCourse = useMemo(() => dashboard?.courses.find((course) => course.id === selectedCourseId) ?? null, [dashboard, selectedCourseId]);
  const textChannels = liveOptions?.channels.filter((channel) => ["text", "announcement"].includes(channel.type)) ?? liveOptions?.channels ?? [];

  useEffect(() => {
    void load();
  }, [botId, guildId]);

  useEffect(() => {
    if (!selectedCourse) {
      setDraft(emptyCourse);
      return;
    }
    setDraft(toPayload(selectedCourse));
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
              <InputField disabled={!canManage} label="Emoji" onChange={(emoji) => setDraft({ ...draft, emoji })} value={draft.emoji ?? ""} />
              <InputField disabled={!canManage} label="Cor do painel" onChange={(color) => setDraft({ ...draft, color })} value={draft.color ?? "#2563eb"} />
              <SelectValueField disabled={!canManage} label="Posição da imagem" onChange={(imagePosition) => setDraft({ ...draft, imagePosition: imagePosition as SaveCoursePayload["imagePosition"] })} options={[["top", "Topo"], ["bottom", "Baixo"], ["side", "Lateral"], ["footer", "Rodapé"]]} value={draft.imagePosition ?? "top"} />
              <InputField disabled={!canManage} label="Banner principal" onChange={(bannerUrl) => setDraft({ ...draft, bannerUrl })} value={draft.bannerUrl ?? ""} />
              <InputField disabled={!canManage} label="Thumbnail" onChange={(thumbnailUrl) => setDraft({ ...draft, thumbnailUrl })} value={draft.thumbnailUrl ?? ""} />
              <InputField disabled={!canManage} label="Imagem de rodapé" onChange={(footerImageUrl) => setDraft({ ...draft, footerImageUrl })} value={draft.footerImageUrl ?? ""} />
              <InputField disabled={!canManage} label="Instrutores por ID de usuário" onChange={(value) => setDraft({ ...draft, instructorUserIds: csv(value) })} value={(draft.instructorUserIds ?? []).join(",")} />
              <MultiRoleField disabled={!canManage} label="Cargos instrutores" onChange={(instructorRoleIds) => setDraft({ ...draft, instructorRoleIds })} options={liveOptions?.roles ?? []} value={draft.instructorRoleIds ?? []} />
              <label className="flex items-center justify-between rounded-lg border border-zinc-800 bg-black/30 px-3 py-3 text-sm text-zinc-200">
                Curso ativo
                <input checked={draft.active ?? true} disabled={!canManage} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} type="checkbox" />
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

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-300" /> Monitoramento</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <Metric label="Publicações" value={dashboard.publications.length} />
          <Metric label="Solicitações de horário" value={dashboard.scheduleRequests.length} />
          <Metric label="Relatórios" value={dashboard.reports.length} />
        </CardContent>
      </Card>
    </div>
  );
}

function toPayload(course: Course): SaveCoursePayload {
  return {
    active: course.active,
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
    publishText: course.publishText,
    startedText: course.startedText,
    thumbnailUrl: course.thumbnailUrl
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
