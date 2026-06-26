import { useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  ExternalLink,
  FileJson,
  Loader2,
  Maximize2,
  Moon,
  RefreshCw,
  Trophy,
  Users,
  Bug,
  CheckCircle2,
  Volume2,
  VolumeX,
  XCircle
} from "lucide-react";
import { motion } from "framer-motion";
import { createDashboardSocket } from "../lib/socket";
import { getRouletteDiagnostics, getRouletteGiveaway, setRouletteDebug, spinRoulette, testRouletteIntegration } from "../lib/api";
import type { Giveaway, GiveawayDiagnostics, GiveawayParticipant, GiveawayWinner } from "../types";
import { Button } from "../components/ui/button";

type GiveawayRoulettePageProps = {
  token: string;
};

type AudioSettings = {
  enabled: boolean;
  volume: number;
};

type SpinSnapshot = {
  criterion: string;
  participants: Array<{
    displayName: string;
    platform: "twitch" | "kick";
    tickets: number;
    username: string;
  }>;
  winner: GiveawayWinner;
  wonAt: string;
};

const SPIN_DURATION_MS = 5600;
const rouletteColors = ["#8b5cf6", "#14b8a6", "#f97316", "#06b6d4", "#ef4444", "#84cc16", "#eab308", "#ec4899"];

export function GiveawayRoulettePage({ token }: GiveawayRoulettePageProps) {
  const [giveaway, setGiveaway] = useState<Giveaway | null>(null);
  const [loading, setLoading] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [lastWinner, setLastWinner] = useState<GiveawayWinner | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [audio, setAudio] = useState<AudioSettings>(() => readAudioSettings());
  const [theme, setTheme] = useState<"dark" | "light">(() => readTheme());
  const [history, setHistory] = useState<SpinSnapshot[]>(() => readHistory(token));
  const [showConfetti, setShowConfetti] = useState(false);
  const [diagnostics, setDiagnostics] = useState<GiveawayDiagnostics | null>(null);
  const [testingIntegration, setTestingIntegration] = useState(false);
  const [testReport, setTestReport] = useState<string[]>([]);
  const audioRef = useRef<RouletteAudio | null>(null);

  const overlay = isOverlayMode();
  const participants = giveaway?.participants ?? [];
  const status = statusMeta(giveaway?.status ?? "waiting");
  const participantCount = participants.length;
  const ticketCount = participants.reduce((total, participant) => total + Math.max(1, participant.tickets ?? 1), 0);
  const canSpin = Boolean(giveaway && giveaway.status === "running" && participantCount > 0 && giveaway.winners.length < giveaway.winnerCount);
  const segmentColors = useMemo(() => participants.map((_, index) => rouletteColors[index % rouletteColors.length] ?? "#8b5cf6"), [participants]);
  const platformStats = useMemo(() => ({
    kick: participants.filter((participant) => participant.platform === "kick").length,
    twitch: participants.filter((participant) => participant.platform === "twitch").length
  }), [participants]);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const next = await getRouletteGiveaway(token);
        const nextDiagnostics = await getRouletteDiagnostics(token).catch(() => null);
        if (!mounted) return;
        setGiveaway(next);
        if (nextDiagnostics) setDiagnostics(nextDiagnostics);
        setLastWinner(next.winners.at(-1) ?? null);
      } catch (error) {
        if (mounted) setMessage(readRequestMessage(error) ?? "Roleta não encontrada.");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void load();
    const interval = window.setInterval(load, 10_000);
    const socket = createDashboardSocket();
    socket.on("giveaway:updated", (updated: Giveaway) => {
      if (updated.rouletteToken === token) {
        setGiveaway(updated);
        setLastWinner(updated.winners.at(-1) ?? null);
      }
    });
    socket.on("giveaway:diagnostics", (event: { diagnostics: GiveawayDiagnostics; token: string }) => {
      if (event.token === token) {
        setDiagnostics(event.diagnostics);
      }
    });

    return () => {
      mounted = false;
      window.clearInterval(interval);
      socket.disconnect();
    };
  }, [token]);

  useEffect(() => {
    window.localStorage.setItem("roulette.audio", JSON.stringify(audio));
    audioRef.current?.setVolume(audio.enabled ? audio.volume : 0);
  }, [audio]);

  useEffect(() => {
    window.localStorage.setItem("roulette.theme", theme);
  }, [theme]);

  async function handleSpin() {
    if (!canSpin || spinning || !giveaway) {
      return;
    }

    setSpinning(true);
    setMessage(null);
    setShowConfetti(false);

    try {
      if (audio.enabled) {
        audioRef.current ??= new RouletteAudio();
        await audioRef.current.start(audio.volume, SPIN_DURATION_MS);
      }

      const result = await spinRoulette(token);
      const winnerIndex = Math.max(0, result.giveaway.participants.findIndex((participant) => participant.id === result.winner.participantId));
      const segmentAngle = 360 / Math.max(1, result.giveaway.participants.length);
      const targetRotation = rotation + 2160 + (360 - (winnerIndex * segmentAngle + segmentAngle / 2));

      setRotation(targetRotation);
      window.setTimeout(() => {
        setGiveaway(result.giveaway);
        setLastWinner(result.winner);
        setSpinning(false);
        setShowConfetti(true);
        audioRef.current?.victory(audio.volume);
        addHistory(result.giveaway, result.winner);
      }, SPIN_DURATION_MS);
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Não foi possível girar a roleta.");
      setSpinning(false);
      audioRef.current?.stop();
    }
  }

  async function handleToggleDebug(debug: boolean) {
    try {
      setDiagnostics(await setRouletteDebug(token, debug));
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Não foi possível alterar o modo debug.");
    }
  }

  async function handleTestIntegration() {
    setTestingIntegration(true);
    setMessage(null);
    try {
      const result = await testRouletteIntegration(token);
      setDiagnostics(result.diagnostics);
      setTestReport(result.report);
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Não foi possível testar a integração.");
    } finally {
      setTestingIntegration(false);
    }
  }

  function addHistory(nextGiveaway: Giveaway, winner: GiveawayWinner) {
    const snapshot: SpinSnapshot = {
      criterion: participantModeLabel(nextGiveaway.participantMode),
      participants: nextGiveaway.participants.map((participant) => ({
        displayName: participant.displayName,
        platform: participant.platform,
        tickets: participant.tickets,
        username: participant.username
      })),
      winner,
      wonAt: winner.wonAt
    };
    setHistory((current) => {
      const next = [snapshot, ...current].slice(0, 30);
      window.localStorage.setItem(historyKey(token), JSON.stringify(next));
      return next;
    });
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#060606] px-4 text-white">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </main>
    );
  }

  if (!giveaway) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#060606] px-4 text-center text-white">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-6">
          <p className="text-sm text-zinc-300">{message ?? "Roleta indisponivel."}</p>
        </div>
      </main>
    );
  }

  const pageClass = theme === "light"
    ? "min-h-screen bg-[#f4f7fb] text-zinc-950"
    : overlay
      ? "min-h-screen bg-transparent text-white"
      : "min-h-screen bg-[#060606] text-white";

  return (
    <main className={`${pageClass} px-3 py-3 sm:px-5 sm:py-5`}>
      {showConfetti ? <Confetti /> : null}
      <div className="mx-auto grid max-w-7xl gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className={`${panelClass(theme, overlay)} min-h-[calc(100vh-40px)] overflow-hidden p-4 sm:p-5`}>
          <header className="flex flex-col gap-4 border-b border-white/10 pb-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${status.className}`}>{status.label}</span>
                <span className={platformPillClass(giveaway.livePlatform)}>{platformLabel(giveaway.livePlatform)}</span>
                <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold">
                  {participantModeLabel(giveaway.participantMode)}
                </span>
              </div>
              <h1 className="mt-3 truncate text-2xl font-bold sm:text-4xl">{giveaway.title}</h1>
              <p className="mt-1 truncate text-sm text-zinc-400">Premio: {giveaway.prizeName}</p>
            </div>
            {!overlay ? (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} size="icon" title="Alternar tema" variant="outline">
                  <Moon className="h-4 w-4" />
                </Button>
                <Button onClick={() => setAudio((current) => ({ ...current, enabled: !current.enabled }))} size="icon" title="Ativar sons" variant="outline">
                  {audio.enabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                </Button>
                <Button onClick={() => window.open(`${window.location.pathname}?overlay=1`, "_blank", "noopener,noreferrer")} size="icon" title="Abrir overlay OBS" variant="outline">
                  <Maximize2 className="h-4 w-4" />
                </Button>
              </div>
            ) : null}
          </header>

          <div className="grid gap-5 pt-5 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="flex min-h-[520px] flex-col items-center justify-center">
              <div className="relative flex w-full max-w-[680px] items-center justify-center">
                <div className="absolute -top-2 z-20 h-0 w-0 border-x-[22px] border-t-[42px] border-x-transparent border-t-white drop-shadow-[0_6px_12px_rgba(0,0,0,0.45)]" />
                <Wheel participants={participants} rotation={rotation} segmentColors={segmentColors} spinning={spinning} />
              </div>

              {lastWinner ? (
                <motion.div
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  className="mt-5 w-full max-w-lg rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-5 py-4 text-center shadow-[0_0_45px_rgba(16,185,129,0.22)]"
                  initial={{ opacity: 0, scale: 0.92, y: 12 }}
                >
                  <p className="text-xs font-bold uppercase text-emerald-300">Vencedor</p>
                  <p className="mt-1 truncate text-3xl font-black">{lastWinner.displayName}</p>
                  <p className="mt-1 text-xs text-zinc-400">@{lastWinner.username} - {formatDateTime(lastWinner.wonAt)}</p>
                </motion.div>
              ) : null}

              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Button className="h-12 bg-emerald-400 px-6 font-bold text-black hover:bg-emerald-300" disabled={!canSpin || spinning} onClick={() => void handleSpin()}>
                  {spinning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Girar Roleta
                </Button>
                {!overlay ? (
                  <Button onClick={() => window.open(giveaway.liveUrl, "_blank", "noopener,noreferrer")} variant="outline">
                    <ExternalLink className="h-4 w-4" />
                    Abrir live
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="grid content-start gap-3">
              <Metric icon={Users} label="Participantes" value={String(participantCount)} />
              <Metric icon={Trophy} label="Tickets" value={String(ticketCount)} />
              <Metric icon={Users} label="Twitch" value={String(platformStats.twitch)} />
              <Metric icon={Users} label="Kick" value={String(platformStats.kick)} />
              {!overlay ? (
                <div className={panelClass(theme, false)}>
                  <div className="flex items-center justify-between px-4 pt-4">
                    <p className="text-sm font-semibold">Volume</p>
                    <span className="text-xs text-zinc-500">{Math.round(audio.volume * 100)}%</span>
                  </div>
                  <div className="p-4">
                    <input
                      className="w-full accent-emerald-400"
                      disabled={!audio.enabled}
                      max={1}
                      min={0}
                      onChange={(event) => setAudio((current) => ({ ...current, volume: Number(event.target.value) }))}
                      step={0.05}
                      type="range"
                      value={audio.volume}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {!overlay ? (
          <aside className="grid gap-4">
            {message ? <div className="rounded-lg border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-100">{message}</div> : null}
            <DiagnosticsPanel
              diagnostics={diagnostics}
              onTest={() => void handleTestIntegration()}
              onToggleDebug={(debug) => void handleToggleDebug(debug)}
              testReport={testReport}
              testing={testingIntegration}
            />
            <ParticipantList participants={participants} />
            <HistoryPanel giveaway={giveaway} history={history} />
          </aside>
        ) : null}
      </div>
    </main>
  );
}

function Wheel({
  participants,
  rotation,
  segmentColors,
  spinning
}: {
  participants: Giveaway["participants"];
  rotation: number;
  segmentColors: string[];
  spinning: boolean;
}) {
  if (!participants.length) {
    return (
      <div className="flex aspect-square w-full max-w-[680px] items-center justify-center rounded-full border border-dashed border-white/15 bg-black/55 text-sm text-zinc-500">
        Sem participantes carregados.
      </div>
    );
  }

  const segmentAngle = 360 / participants.length;
  const labelRadius = participants.length > 24 ? 31 : 33;

  return (
    <svg className="aspect-square w-full max-w-[680px] drop-shadow-[0_28px_90px_rgba(0,0,0,0.5)]" viewBox="0 0 100 100">
      <defs>
        <radialGradient id="wheelGlow" cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.18" />
          <stop offset="68%" stopColor="#ffffff" stopOpacity="0.04" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.24" />
        </radialGradient>
      </defs>
      <g style={{ transform: `rotate(${rotation}deg)`, transformBox: "fill-box", transformOrigin: "center", transition: `transform ${SPIN_DURATION_MS}ms cubic-bezier(0.08, 0.74, 0.08, 1)` }}>
        {participants.map((participant, index) => {
          const start = index * segmentAngle - 90;
          const end = start + segmentAngle;
          const textAngle = start + segmentAngle / 2;
          const text = `${participant.displayName || participant.username}${participant.tickets > 1 ? ` x${participant.tickets}` : ""}`;
          const textPosition = polarToCartesian(50, 50, labelRadius, textAngle);

          return (
            <g key={participant.id}>
              <path d={describeArcSlice(50, 50, 48, start, end)} fill={segmentColors[index] ?? "#8b5cf6"} stroke="#050505" strokeWidth="0.35" />
              {participants.length <= 84 ? (
                <text dominantBaseline="middle" fill="#ffffff" fontSize={participants.length > 48 ? "1.35" : "2.05"} fontWeight="800" textAnchor="middle" transform={`rotate(${textAngle + 90} ${textPosition.x} ${textPosition.y})`} x={textPosition.x} y={textPosition.y}>
                  {truncateText(text, participants.length > 48 ? 7 : 13)}
                </text>
              ) : null}
            </g>
          );
        })}
        <circle cx="50" cy="50" fill="url(#wheelGlow)" r="48" />
        <circle cx="50" cy="50" fill="#09090b" r="10.5" stroke="#ffffff" strokeOpacity="0.2" strokeWidth="1" />
        <circle cx="50" cy="50" fill={spinning ? "#facc15" : "#10b981"} r="5.2" />
      </g>
    </svg>
  );
}

function ParticipantList({ participants }: { participants: GiveawayParticipant[] }) {
  return (
    <section className="rounded-lg border border-white/10 bg-zinc-950/86 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-white">Participantes</h2>
        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-zinc-400">{participants.length}</span>
      </div>
      <div className="mt-4 max-h-[420px] space-y-2 overflow-y-auto pr-1 discord-scrollbar">
        {participants.length ? participants.map((participant, index) => (
          <div className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2" key={participant.id}>
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 truncate text-sm font-semibold text-white">{index + 1}. {participant.displayName}</p>
              <span className={platformPillClass(participant.platform)}>{participant.platform === "kick" ? "Kick" : "Twitch"}</span>
            </div>
            <p className="mt-1 truncate text-xs text-zinc-500">@{participant.username} - {participantLabel(participant)} - {participant.tickets} ticket(s)</p>
          </div>
        )) : (
          <div className="flex min-h-28 items-center justify-center rounded-lg border border-dashed border-zinc-800 text-sm text-zinc-500">
            Sem participantes carregados.
          </div>
        )}
      </div>
    </section>
  );
}

function DiagnosticsPanel({
  diagnostics,
  onTest,
  onToggleDebug,
  testing,
  testReport
}: {
  diagnostics: GiveawayDiagnostics | null;
  onTest: () => void;
  onToggleDebug: (debug: boolean) => void;
  testing: boolean;
  testReport: string[];
}) {
  const twitch = diagnostics?.twitch ?? null;
  const kick = diagnostics?.kick ?? null;

  return (
    <section className="rounded-lg border border-white/10 bg-zinc-950/86 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-white">Diagnostico em tempo real</h2>
        <Button disabled={testing} onClick={onTest} size="sm" variant="outline">
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Testar integração
        </Button>
      </div>

      <div className="mt-4 grid gap-3">
        <PlatformDiagnostic name="Twitch" platform="twitch" state={twitch} />
        <PlatformDiagnostic name="Kick" platform="kick" state={kick} />
      </div>

      <label className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-zinc-900 bg-black/35 p-3">
        <span className="flex items-center gap-2 text-sm font-medium text-zinc-100">
          <Bug className="h-4 w-4 text-zinc-400" />
          Modo Debug
        </span>
        <input
          checked={diagnostics?.debug === true}
          className="h-4 w-4 accent-emerald-400"
          onChange={(event) => onToggleDebug(event.target.checked)}
          type="checkbox"
        />
      </label>

      {testReport.length ? (
        <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-xs leading-5 text-emerald-100">
          {testReport.map((line) => <p key={line}>{line}</p>)}
        </div>
      ) : null}

      <div className="mt-4 max-h-52 space-y-2 overflow-y-auto pr-1 discord-scrollbar">
        {diagnostics?.logs.length ? diagnostics.logs.map((log) => (
          <div className="rounded-md border border-zinc-900 bg-black/35 px-3 py-2" key={`${log.at}:${log.message}`}>
            <div className="flex items-center justify-between gap-2">
              <span className={log.level === "error" ? "text-xs font-semibold text-red-300" : log.level === "debug" ? "text-xs font-semibold text-yellow-200" : "text-xs font-semibold text-zinc-300"}>
                [{log.platform.toUpperCase()}]
              </span>
              <span className="text-[11px] text-zinc-600">{formatDateTime(log.at)}</span>
            </div>
            <p className="mt-1 text-xs text-zinc-400">{log.message}</p>
            {diagnostics.debug && log.payload !== undefined ? (
              <pre className="mt-2 max-h-28 overflow-auto rounded bg-black/50 p-2 text-[11px] text-zinc-500">{JSON.stringify(log.payload, null, 2)}</pre>
            ) : null}
          </div>
        )) : (
          <div className="flex min-h-20 items-center justify-center rounded-lg border border-dashed border-zinc-800 text-sm text-zinc-500">
            Aguardando eventos Twitch/Kick.
          </div>
        )}
      </div>
    </section>
  );
}

function PlatformDiagnostic({
  name,
  platform,
  state
}: {
  name: string;
  platform: "twitch" | "kick";
  state: GiveawayDiagnostics["twitch"] | null;
}) {
  const connected = state?.connected === true;

  return (
    <div className="rounded-lg border border-zinc-900 bg-black/35 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {connected ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-red-300" />}
          <p className="text-sm font-semibold text-white">{name}</p>
        </div>
        <span className={platformPillClass(platform)}>{connected ? "Conectado" : "Desconectado"}</span>
      </div>
      <div className="mt-3 grid gap-2 text-xs text-zinc-500">
        <p>Canal: <span className="text-zinc-300">{state?.channel ?? "Não configurado"}</span></p>
        <p>Usuarios recebidos: <span className="text-zinc-300">{state?.usersReceived ?? 0}</span></p>
        <p>Token: <span className="text-zinc-300">{state?.tokenStatus ?? "unknown"}</span></p>
        <p className="truncate">Ultima msg: <span className="text-zinc-300">{state?.lastMessage ?? "Nenhuma"}</span></p>
        {state?.lastError ? <p className="text-red-300">Erro: {state.lastError}</p> : null}
      </div>
    </div>
  );
}

function HistoryPanel({ giveaway, history }: { giveaway: Giveaway; history: SpinSnapshot[] }) {
  return (
    <section className="rounded-lg border border-white/10 bg-zinc-950/86 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-white">Histórico</h2>
        <div className="flex gap-2">
          <Button onClick={() => downloadHistory(giveaway, history, "json")} size="icon" title="Exportar JSON" variant="outline">
            <FileJson className="h-4 w-4" />
          </Button>
          <Button onClick={() => downloadHistory(giveaway, history, "csv")} size="icon" title="Exportar Excel" variant="outline">
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        {history.length ? history.slice(0, 6).map((item, index) => (
          <div className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2" key={`${item.winner.participantId}:${item.wonAt}:${index}`}>
            <p className="truncate text-sm font-semibold text-white">{item.winner.displayName}</p>
            <p className="mt-1 text-xs text-zinc-500">{item.criterion} - {item.participants.length} participante(s) - {formatDateTime(item.wonAt)}</p>
          </div>
        )) : (
          <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed border-zinc-800 text-sm text-zinc-500">
            Nenhum giro registrado nesta tela.
          </div>
        )}
      </div>
    </section>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.06] p-4">
      <Icon className="h-4 w-4 text-zinc-400" />
      <p className="mt-3 text-xs font-semibold uppercase text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-black">{value}</p>
    </div>
  );
}

function Confetti() {
  return (
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {Array.from({ length: 70 }).map((_, index) => (
        <span
          className="absolute top-[-10px] h-3 w-2 animate-[roulette-confetti_2600ms_ease-out_forwards]"
          key={index}
          style={{
            animationDelay: `${(index % 18) * 38}ms`,
            background: rouletteColors[index % rouletteColors.length],
            left: `${(index * 37) % 100}%`,
            transform: `rotate(${index * 21}deg)`
          }}
        />
      ))}
    </div>
  );
}

class RouletteAudio {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private timers: number[] = [];

  async start(volume: number, durationMs: number) {
    this.stop();
    this.context = new AudioContext();
    this.gain = this.context.createGain();
    this.gain.gain.value = volume * 0.35;
    this.gain.connect(this.context.destination);

    const startedAt = performance.now();
    const tick = () => {
      const elapsed = performance.now() - startedAt;
      const progress = Math.min(1, elapsed / durationMs);
      this.beep(520 + (1 - progress) * 220, 0.026, 0.55 - progress * 0.34);
      if (progress < 1) {
        this.timers.push(window.setTimeout(tick, 42 + progress * 190));
      }
    };

    tick();
  }

  setVolume(volume: number) {
    if (this.gain) {
      this.gain.gain.value = volume * 0.35;
    }
  }

  victory(volume: number) {
    if (!this.context) {
      return;
    }

    this.setVolume(volume);
    [523, 659, 784, 1046].forEach((frequency, index) => {
      this.timers.push(window.setTimeout(() => this.beep(frequency, 0.16, 0.65), index * 95));
    });
  }

  stop() {
    this.timers.forEach((timer) => window.clearTimeout(timer));
    this.timers = [];
  }

  private beep(frequency: number, duration: number, level: number) {
    if (!this.context || !this.gain) {
      return;
    }

    const oscillator = this.context.createOscillator();
    const tickGain = this.context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.value = frequency;
    tickGain.gain.value = level;
    oscillator.connect(tickGain);
    tickGain.connect(this.gain);
    oscillator.start();
    oscillator.stop(this.context.currentTime + duration);
  }
}

function panelClass(theme: "dark" | "light", overlay: boolean) {
  if (overlay) return "rounded-lg border border-white/10 bg-black/45 backdrop-blur-md";
  return theme === "light"
    ? "rounded-lg border border-zinc-200 bg-white shadow-sm"
    : "rounded-lg border border-white/10 bg-zinc-950/86";
}

function participantLabel(participant: GiveawayParticipant) {
  if (participant.isVip) return "VIP";
  if (participant.isModerator) return "Moderador";
  if (participant.subscriber) return participant.subTierLabel ?? "Sub";
  if (participant.follower) return "Follower";
  return "Chat";
}

function participantModeLabel(mode: Giveaway["participantMode"]) {
  const labels: Record<Giveaway["participantMode"], string> = {
    all: "Todos elegiveis",
    kick_followers: "Seguidores Kick",
    kick_subs: "Subs Kick",
    twitch_followers: "Seguidores Twitch",
    twitch_kick: "Twitch + Kick",
    twitch_subs: "Subs Twitch",
    twitch_subs_followers: "Subs + seguidores Twitch"
  };
  return labels[mode] ?? "Personalizado";
}

function platformLabel(platform: Giveaway["livePlatform"] | GiveawayParticipant["platform"]) {
  if (platform === "multi") return "Twitch + Kick";
  return platform === "kick" ? "Kick" : "Twitch";
}

function platformPillClass(platform: Giveaway["livePlatform"] | GiveawayParticipant["platform"]) {
  if (platform === "kick") return "rounded-full border border-[#53fc18]/30 bg-[#53fc18]/10 px-2 py-0.5 text-xs font-bold text-[#53fc18]";
  if (platform === "multi") return "rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2 py-0.5 text-xs font-bold text-cyan-200";
  return "rounded-full border border-[#9146ff]/35 bg-[#9146ff]/15 px-2 py-0.5 text-xs font-bold text-[#d2b8ff]";
}

function statusMeta(status: Giveaway["status"]) {
  if (status === "running") return { className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300", label: "Em andamento" };
  if (status === "ended") return { className: "border-red-500/25 bg-red-500/10 text-red-300", label: "Encerrado" };
  return { className: "border-yellow-500/25 bg-yellow-500/10 text-yellow-200", label: "Aguardando" };
}

function describeArcSlice(cx: number, cy: number, radius: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return [`M ${cx} ${cy}`, `L ${start.x} ${start.y}`, `A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`, "Z"].join(" ");
}

function polarToCartesian(cx: number, cy: number, radius: number, angleInDegrees: number) {
  const angleInRadians = (angleInDegrees * Math.PI) / 180;
  return { x: cx + radius * Math.cos(angleInRadians), y: cy + radius * Math.sin(angleInRadians) };
}

function truncateText(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}.` : value;
}

function formatDateTime(value?: string | null) {
  if (!value) return "Não registrado";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function downloadHistory(giveaway: Giveaway, history: SpinSnapshot[], format: "json" | "csv") {
  const filename = `historico-${giveaway.id}.${format === "csv" ? "csv" : "json"}`;
  const content = format === "json"
    ? JSON.stringify({ giveaway: giveaway.title, prize: giveaway.prizeName, history }, null, 2)
    : toCsv(history);
  const blob = new Blob([content], { type: format === "json" ? "application/json" : "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function toCsv(history: SpinSnapshot[]) {
  const rows = [["data_hora", "criterio", "vencedor", "usuario", "participantes"]];
  for (const item of history) {
    rows.push([item.wonAt, item.criterion, item.winner.displayName, item.winner.username, String(item.participants.length)]);
  }
  return rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
}

function readAudioSettings(): AudioSettings {
  try {
    const stored = JSON.parse(window.localStorage.getItem("roulette.audio") ?? "");
    return { enabled: stored.enabled !== false, volume: Number.isFinite(stored.volume) ? stored.volume : 0.55 };
  } catch {
    return { enabled: true, volume: 0.55 };
  }
}

function readTheme(): "dark" | "light" {
  return window.localStorage.getItem("roulette.theme") === "light" ? "light" : "dark";
}

function readHistory(token: string): SpinSnapshot[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(historyKey(token)) ?? "[]");
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
}

function historyKey(token: string) {
  return `roulette.history.${token}`;
}

function isOverlayMode() {
  return window.location.pathname.endsWith("/overlay") || new URLSearchParams(window.location.search).get("overlay") === "1";
}

function readRequestMessage(error: unknown) {
  if (typeof error !== "object" || error === null || !("response" in error)) return null;
  const response = (error as { response?: { data?: { message?: unknown } } }).response;
  return typeof response?.data?.message === "string" ? response.data.message : null;
}
