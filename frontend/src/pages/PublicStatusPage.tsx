import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Loader2,
  RefreshCw,
  Server,
  ShieldAlert,
  type LucideIcon
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../components/ui/button";
import {
  fetchPublicStatus,
  type PublicHistoryState,
  type PublicServiceState,
  type PublicStatusCategory,
  type PublicStatusService,
  type PublicStatusSnapshot
} from "../lib/publicStatus";

export function PublicStatusPage() {
  const [snapshot, setSnapshot] = useState<PublicStatusSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh(signal?: AbortSignal) {
    setRefreshing(true);
    try {
      const data = await fetchPublicStatus(signal);
      setSnapshot(data);
      setError(null);
    } catch (refreshError) {
      if (!(refreshError instanceof DOMException && refreshError.name === "AbortError")) {
        setError("Não foi possível carregar o status agora.");
      }
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);

    const source = new EventSource("/api/public/status/events");
    source.addEventListener("status-update", (event) => {
      try {
        setSnapshot(JSON.parse((event as MessageEvent).data) as PublicStatusSnapshot);
        setError(null);
      } catch {
        setError("Recebemos uma atualização inválida do status.");
      }
    });
    source.onerror = () => {
      source.close();
    };

    const fallback = window.setInterval(() => {
      void refresh();
    }, 10_000);

    return () => {
      controller.abort();
      source.close();
      window.clearInterval(fallback);
    };
  }, []);

  const services = useMemo(() => snapshot?.categories.flatMap((category) => category.services) ?? [], [snapshot]);
  const operationalCount = services.filter((service) => service.currentStatus === "operational").length;
  const degradedCount = services.filter((service) => service.currentStatus !== "operational" && service.currentStatus !== "unknown").length;

  return (
    <main className="min-h-screen bg-[#060606] text-white">
      <div className="fixed inset-0 -z-10 bg-[#060606]" />
      <div className="fixed inset-0 -z-10 bg-[linear-gradient(rgba(255,213,0,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,213,0,0.035)_1px,transparent_1px)] bg-[size:44px_44px]" />

      <header className="border-b border-[#FFD500]/15 bg-black/65 px-4 py-4 backdrop-blur-xl sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <a className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-zinc-300 transition hover:text-[#FFEA70]" href="/">
            <ArrowLeft className="h-4 w-4" />
            Voltar para a NextTech
          </a>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button className="h-10" disabled={refreshing} onClick={() => void refresh()} variant="outline">
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Atualizar
            </Button>
          </div>
        </div>
      </header>

      <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-[#FFD500]/25 bg-[#FFD500]/10 px-4 py-2 text-sm font-semibold text-[#FFEA70]">
              <Activity className="h-4 w-4" />
              Status em tempo real
            </p>
            <h1 className="mt-6 text-4xl font-black leading-tight text-white sm:text-5xl">
              Status dos serviços NextTech
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-8 text-[#B3B3B3]">
              Dados públicos e tratados para acompanhar a disponibilidade da plataforma sem expor APIs, tokens, hosts internos ou detalhes privados da infraestrutura.
            </p>
          </div>

          <GlobalStatusCard snapshot={snapshot} degradedCount={degradedCount} operationalCount={operationalCount} />
        </div>

        {error ? (
          <div className="mt-8 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-100">
            {error}
          </div>
        ) : null}

        {!snapshot ? (
          <div className="mt-10 flex min-h-72 items-center justify-center rounded-lg border border-[#FFD500]/15 bg-[#101010]/85">
            <Loader2 className="h-6 w-6 animate-spin text-[#FFD500]" />
          </div>
        ) : (
          <>
            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <MetricCard icon={Server} label="Serviços monitorados" value={String(snapshot.servicesTotal)} />
              <MetricCard icon={CheckCircle2} label="Operacionais" value={String(operationalCount)} />
              <MetricCard icon={Clock3} label="Atualizado" value={formatTime(snapshot.generatedAt)} />
            </div>

            <div className="mt-10 space-y-8">
              {snapshot.categories.map((category) => (
                <ServiceCategoryView category={category} key={category.id} />
              ))}
            </div>

            <IncidentSection incidents={snapshot.incidents} />
          </>
        )}
      </section>
    </main>
  );
}

function GlobalStatusCard({
  degradedCount,
  operationalCount,
  snapshot
}: {
  degradedCount: number;
  operationalCount: number;
  snapshot: PublicStatusSnapshot | null;
}) {
  const meta = globalMeta(snapshot?.globalStatus ?? "degraded");

  return (
    <div className={`rounded-lg border ${meta.border} ${meta.bg} p-5 shadow-[0_24px_70px_rgba(0,0,0,0.35)]`}>
      <div className="flex items-start gap-3">
        <meta.icon className={`mt-0.5 h-5 w-5 ${meta.text}`} />
        <div>
          <p className={`text-sm font-black uppercase tracking-[.18em] ${meta.text}`}>Estado geral</p>
          <h2 className="mt-2 text-2xl font-black text-white">{snapshot?.globalMessage ?? "Carregando status"}</h2>
          <p className="mt-3 text-sm leading-6 text-zinc-300">
            {snapshot ? `${operationalCount} serviço(s) operacionais e ${degradedCount} com atenção.` : "Buscando dados seguros da plataforma."}
          </p>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#FFD500]/15 bg-[#101010]/90 p-5">
      <Icon className="h-5 w-5 text-[#FFD500]" />
      <p className="mt-4 text-2xl font-black text-white">{value}</p>
      <p className="mt-1 text-sm text-zinc-400">{label}</p>
    </div>
  );
}

function ServiceCategoryView({ category }: { category: PublicStatusCategory }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2 border-b border-[#FFD500]/15 pb-3">
        <Server className="h-4 w-4 text-[#FFD500]" />
        <h2 className="text-lg font-black text-white">{category.name}</h2>
      </div>
      <div className="overflow-hidden rounded-lg border border-[#FFD500]/15 bg-[#101010]/90">
        {category.services.map((service) => (
          <ServiceRow service={service} key={service.id} />
        ))}
      </div>
    </section>
  );
}

function ServiceRow({ service }: { service: PublicStatusService }) {
  const meta = serviceMeta(service.currentStatus);

  return (
    <div className="grid gap-4 border-b border-white/5 p-4 last:border-b-0 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] lg:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-black ${meta.badge}`}>
            <meta.icon className="h-3.5 w-3.5" />
            {meta.label}
          </span>
          <span className="rounded-full border border-zinc-700 px-2 py-1 text-[11px] font-semibold text-zinc-300">
            {service.critical ? "Crítico" : "Secundário"}
          </span>
        </div>
        <h3 className="mt-3 truncate text-base font-black text-white" title={service.name}>{service.name}</h3>
        {service.description ? <p className="mt-1 line-clamp-2 text-sm leading-6 text-zinc-400">{service.description}</p> : null}
      </div>

      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
          <span>{service.uptimePercentage.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}% uptime</span>
          <span>{service.responseTimeMs === null ? "Latência indisponível" : `${service.responseTimeMs} ms`}</span>
        </div>
        <div aria-label={`Histórico de ${service.name}`} className="grid grid-cols-[repeat(30,minmax(0,1fr))] gap-1 sm:grid-cols-[repeat(60,minmax(0,1fr))]">
          {service.history.map((item) => (
            <span
              className={`h-8 min-w-1 rounded-sm ${historyClass(item.status)}`}
              key={`${service.id}-${item.startedAt}`}
              title={`${formatDateTime(item.startedAt)} - ${historyLabel(item.status)}${item.averageResponseTimeMs === null ? "" : ` - ${item.averageResponseTimeMs} ms`}`}
            />
          ))}
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-zinc-500">
          <span>60 min</span>
          <span>agora</span>
        </div>
      </div>
    </div>
  );
}

function IncidentSection({ incidents }: { incidents: PublicStatusSnapshot["incidents"] }) {
  return (
    <section className="mt-10">
      <h2 className="flex items-center gap-2 text-lg font-black text-white">
        <ShieldAlert className="h-5 w-5 text-[#FFD500]" />
        Incidentes ativos
      </h2>
      <div className="mt-3 rounded-lg border border-[#FFD500]/15 bg-[#101010]/90 p-5">
        {incidents.length ? (
          <div className="space-y-3">
            {incidents.map((incident) => (
              <div className="rounded-lg border border-red-500/25 bg-red-500/10 p-4" key={incident.id}>
                <p className="font-bold text-red-100">{incident.title}</p>
                <p className="mt-1 text-sm text-red-200/80">Status: {incident.status} · Severidade: {incident.severity}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm font-medium text-zinc-300">Nenhum incidente público ativo no momento.</p>
        )}
      </div>
    </section>
  );
}

function globalMeta(status: PublicStatusSnapshot["globalStatus"]) {
  if (status === "major_outage") {
    return { bg: "bg-red-500/10", border: "border-red-500/35", icon: ShieldAlert, text: "text-red-300" };
  }
  if (status === "degraded") {
    return { bg: "bg-amber-500/10", border: "border-amber-500/35", icon: AlertTriangle, text: "text-amber-300" };
  }
  return { bg: "bg-emerald-500/10", border: "border-emerald-500/35", icon: CheckCircle2, text: "text-emerald-300" };
}

function serviceMeta(status: PublicServiceState) {
  if (status === "operational") {
    return { badge: "border-emerald-500/35 bg-emerald-500/10 text-emerald-300", icon: CheckCircle2, label: "Operacional" };
  }
  if (status === "degraded") {
    return { badge: "border-amber-500/35 bg-amber-500/10 text-amber-300", icon: AlertTriangle, label: "Degradado" };
  }
  if (status === "maintenance") {
    return { badge: "border-sky-500/35 bg-sky-500/10 text-sky-300", icon: Clock3, label: "Manutenção" };
  }
  if (status === "unknown") {
    return { badge: "border-zinc-600 bg-zinc-800/70 text-zinc-300", icon: Activity, label: "Sem dados" };
  }
  return { badge: "border-red-500/35 bg-red-500/10 text-red-300", icon: ShieldAlert, label: "Indisponível" };
}

function historyClass(status: PublicHistoryState) {
  if (status === "operational") return "bg-emerald-400";
  if (status === "degraded") return "bg-amber-400";
  if (status === "maintenance") return "bg-sky-400";
  if (status === "down") return "bg-red-500";
  return "bg-zinc-700";
}

function historyLabel(status: PublicHistoryState) {
  if (status === "operational") return "Operacional";
  if (status === "degraded") return "Degradado";
  if (status === "maintenance") return "Manutenção";
  if (status === "down") return "Indisponível";
  return "Sem dados";
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
