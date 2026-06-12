import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2, LogIn, RefreshCw, Ticket, Trophy, Users } from "lucide-react";
import { enterRouletteGiveaway, getGiveawayIdentity, getRouletteGiveaway, giveawayConnectUrl, spinRoulette } from "../lib/api";
import type { Giveaway, GiveawayIdentity, GiveawayWinner } from "../types";
import { Button } from "../components/ui/button";

type GiveawayRoulettePageProps = {
  token: string;
};

export function GiveawayRoulettePage({ token }: GiveawayRoulettePageProps) {
  const [giveaway, setGiveaway] = useState<Giveaway | null>(null);
  const [loading, setLoading] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [lastWinner, setLastWinner] = useState<GiveawayWinner | null>(null);
  const [identity, setIdentity] = useState<GiveawayIdentity | null>(null);
  const [entering, setEntering] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const participants = giveaway?.participants ?? [];
  const status = statusMeta(giveaway?.status ?? "waiting");
  const canSpin = Boolean(giveaway && giveaway.status === "running" && participants.length > 0 && giveaway.winners.length < giveaway.winnerCount);
  const segmentColors = useMemo(
    () => participants.map((_, index) => wheelColor(index)),
    [participants]
  );

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const [next, nextIdentity] = await Promise.all([
          getRouletteGiveaway(token),
          getGiveawayIdentity(token)
        ]);
        if (!mounted) return;
        setGiveaway(next);
        setIdentity(nextIdentity);
      } catch (error) {
        if (mounted) setMessage(readRequestMessage(error) ?? "Roleta nao encontrada.");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void load();
    const interval = window.setInterval(load, 5000);

    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [token]);

  async function handleSpin() {
    if (!canSpin || spinning) {
      return;
    }

    setSpinning(true);
    setMessage(null);

    try {
      const result = await spinRoulette(token);
      const winnerIndex = Math.max(0, result.giveaway.participants.findIndex((participant) => participant.id === result.winner.participantId));
      const segmentAngle = 360 / Math.max(1, result.giveaway.participants.length);
      const targetRotation = rotation + 1440 + (360 - (winnerIndex * segmentAngle + segmentAngle / 2));

      setRotation(targetRotation);
      window.setTimeout(() => {
        setGiveaway(result.giveaway);
        setLastWinner(result.winner);
        setSpinning(false);
      }, 2200);
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Nao foi possivel girar a roleta.");
      setSpinning(false);
    }
  }

  async function handleEnter() {
    setEntering(true);
    setMessage(null);

    try {
      const result = await enterRouletteGiveaway(token);
      setGiveaway(result.giveaway);
      setIdentity(result.identity);
      const approved = result.verifications.filter((verification) => verification.eligible).length;
      setMessage(approved ? "Entrada confirmada no sorteio." : result.verifications[0]?.reason ?? "Conta conectada nao esta elegivel.");
    } catch (error) {
      setMessage(readRequestMessage(error) ?? "Nao foi possivel entrar no sorteio.");
    } finally {
      setEntering(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#050505] px-4 text-white">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
      </main>
    );
  }

  if (!giveaway) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#050505] px-4 text-center text-white">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-6">
          <p className="text-sm text-zinc-300">{message ?? "Roleta indisponivel."}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#050505] px-4 py-5 text-white sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="flex flex-col gap-4 rounded-lg border border-zinc-900 bg-zinc-950/80 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold text-white">{giveaway.title}</h1>
              <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${status.className}`}>
                {status.label}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-sm text-zinc-400">
              <span className="rounded-md border border-zinc-900 bg-black/35 px-2.5 py-1">Premio: {giveaway.prizeName}</span>
              <a
                className="rounded-md border border-zinc-900 bg-black/35 px-2.5 py-1 text-blue-300 hover:text-blue-200"
                href={giveaway.liveUrl}
                rel="noreferrer"
                target="_blank"
              >
                {giveaway.liveName}
              </a>
            </div>
          </div>
          <div className="grid gap-2 text-sm text-zinc-300 sm:grid-cols-2">
            <Metric icon={Users} label="Participantes" value={String(participants.length)} />
            <Metric icon={Ticket} label="Tickets" value={String(participants.reduce((total, participant) => total + Math.max(1, participant.tickets ?? 1), 0))} />
            <Metric icon={Trophy} label="Ganhadores" value={`${giveaway.winners.length}/${giveaway.winnerCount}`} />
          </div>
        </header>

        {message ? (
          <div className="rounded-lg border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {message}
          </div>
        ) : null}

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-h-[640px] flex-col items-center justify-center rounded-lg border border-zinc-900 bg-zinc-950/70 p-4">
            <div className="relative flex w-full max-w-[620px] items-center justify-center">
              <div className="absolute -top-2 z-10 h-0 w-0 border-x-[18px] border-t-[34px] border-x-transparent border-t-white drop-shadow" />
              <Wheel participants={participants} rotation={rotation} segmentColors={segmentColors} />
            </div>

            {lastWinner ? (
              <div className="mt-5 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-5 py-3 text-center">
                <p className="text-xs uppercase text-emerald-300">Ganhador</p>
                <p className="mt-1 text-xl font-semibold text-white">{lastWinner.displayName}</p>
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Button
                className="h-12 bg-emerald-500 px-6 text-black hover:bg-emerald-400"
                disabled={!canSpin || spinning}
                onClick={() => void handleSpin()}
              >
                {spinning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Girar Roleta
              </Button>
              <Button onClick={() => window.open(giveaway.liveUrl, "_blank", "noopener,noreferrer")} variant="outline">
                <ExternalLink className="h-4 w-4" />
                Abrir live
              </Button>
            </div>
          </div>

          <aside className="rounded-lg border border-zinc-900 bg-zinc-950/80 p-4">
            <div className="border-b border-zinc-900 pb-4">
              <div className="flex items-center gap-2">
                <LogIn className="h-5 w-5 text-emerald-300" />
                <h2 className="text-base font-semibold text-white">Minha entrada</h2>
              </div>
              <div className="mt-3 grid gap-2">
                <Button onClick={() => window.location.assign(giveawayConnectUrl(token, "twitch"))} variant="outline">
                  <ExternalLink className="h-4 w-4" />
                  Conectar Twitch
                </Button>
                <Button onClick={() => window.location.assign(giveawayConnectUrl(token, "kick"))} variant="outline">
                  <ExternalLink className="h-4 w-4" />
                  Conectar Kick
                </Button>
                <Button disabled={entering || giveaway.status === "ended"} onClick={() => void handleEnter()}>
                  {entering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ticket className="h-4 w-4" />}
                  Entrar no Sorteio
                </Button>
              </div>
              <div className="mt-3 space-y-2">
                {(identity?.accounts ?? []).length ? identity?.accounts.map((account) => (
                  <div className="rounded-lg border border-zinc-900 bg-black/35 px-3 py-2" key={account.id}>
                    <p className="text-sm font-medium text-white">{account.platform === "twitch" ? "Twitch" : "Kick"}: {account.displayName}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">@{account.username}</p>
                  </div>
                )) : (
                  <p className="rounded-lg border border-dashed border-zinc-800 px-3 py-3 text-sm text-zinc-500">Nenhuma conta conectada.</p>
                )}
                {(identity?.entries ?? []).map((entry) => (
                  <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2" key={entry.id}>
                    <p className="text-sm font-medium text-emerald-100">{entry.displayName}</p>
                    <p className="mt-0.5 text-xs text-emerald-200/70">{entry.tickets} ticket(s) · {entry.subscriber ? entry.subTierLabel ?? "Sub" : entry.follower ? "Follower" : "Normal"}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 border-b border-zinc-900 pb-3">
              <Trophy className="h-5 w-5 text-yellow-300" />
              <h2 className="text-base font-semibold text-white">Ganhadores</h2>
            </div>
            <div className="mt-4 space-y-2">
              {giveaway.winners.length ? giveaway.winners.map((winner, index) => (
                <div className="rounded-lg border border-zinc-900 bg-black/35 px-3 py-2" key={`${winner.participantId}:${winner.wonAt}:${index}`}>
                  <p className="text-sm font-medium text-white">{index + 1}. {winner.displayName}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">@{winner.username}</p>
                </div>
              )) : (
                <div className="flex min-h-32 items-center justify-center rounded-lg border border-dashed border-zinc-800 text-sm text-zinc-500">
                  Nenhum ganhador ainda.
                </div>
              )}
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}

function Wheel({
  participants,
  rotation,
  segmentColors
}: {
  participants: Giveaway["participants"];
  rotation: number;
  segmentColors: string[];
}) {
  if (!participants.length) {
    return (
      <div className="flex aspect-square w-full max-w-[620px] items-center justify-center rounded-full border border-dashed border-zinc-800 bg-black text-sm text-zinc-500">
        Sem participantes carregados.
      </div>
    );
  }

  const segmentAngle = 360 / participants.length;
  const radius = 48;
  const labelRadius = 32;

  return (
    <svg
      className="aspect-square w-full max-w-[620px] drop-shadow-[0_24px_80px_rgba(0,0,0,0.42)]"
      viewBox="0 0 100 100"
    >
      <g
        style={{
          transform: `rotate(${rotation}deg)`,
          transformBox: "fill-box",
          transformOrigin: "center",
          transition: "transform 2200ms cubic-bezier(0.2, 0.8, 0.16, 1)"
        }}
      >
        {participants.map((participant, index) => {
          const start = index * segmentAngle - 90;
          const end = start + segmentAngle;
          const textAngle = start + segmentAngle / 2;
          const text = `${participant.displayName || participant.username}${participant.tickets > 1 ? ` x${participant.tickets}` : ""}`;
          const textPosition = polarToCartesian(50, 50, labelRadius, textAngle);

          return (
            <g key={participant.id}>
              <path
                d={describeArcSlice(50, 50, radius, start, end)}
                fill={segmentColors[index] ?? "#7c3aed"}
                stroke="#09090b"
                strokeWidth="0.35"
              />
              {participants.length <= 72 ? (
                <text
                  dominantBaseline="middle"
                  fill="#ffffff"
                  fontSize={participants.length > 36 ? "1.6" : "2.2"}
                  fontWeight="700"
                  textAnchor="middle"
                  transform={`rotate(${textAngle + 90} ${textPosition.x} ${textPosition.y})`}
                  x={textPosition.x}
                  y={textPosition.y}
                >
                  {truncateText(text, participants.length > 36 ? 8 : 12)}
                </text>
              ) : null}
            </g>
          );
        })}
        <circle cx="50" cy="50" fill="#09090b" r="10" stroke="#ffffff" strokeOpacity="0.16" strokeWidth="1" />
        <circle cx="50" cy="50" fill="#a855f7" r="5" />
      </g>
    </svg>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return (
    <div className="flex min-h-12 items-center gap-3 rounded-lg border border-zinc-900 bg-black/35 px-3 py-2">
      <Icon className="h-4 w-4 text-zinc-400" />
      <div>
        <p className="text-[11px] uppercase text-zinc-500">{label}</p>
        <p className="text-sm font-semibold text-white">{value}</p>
      </div>
    </div>
  );
}

function statusMeta(status: Giveaway["status"]) {
  if (status === "running") {
    return {
      className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
      label: "Em andamento"
    };
  }

  if (status === "ended") {
    return {
      className: "border-red-500/25 bg-red-500/10 text-red-300",
      label: "Encerrado"
    };
  }

  return {
    className: "border-yellow-500/25 bg-yellow-500/10 text-yellow-200",
    label: "Aguardando"
  };
}

function describeArcSlice(cx: number, cy: number, radius: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";

  return [
    `M ${cx} ${cy}`,
    `L ${start.x} ${start.y}`,
    `A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`,
    "Z"
  ].join(" ");
}

function polarToCartesian(cx: number, cy: number, radius: number, angleInDegrees: number) {
  const angleInRadians = (angleInDegrees * Math.PI) / 180;

  return {
    x: cx + radius * Math.cos(angleInRadians),
    y: cy + radius * Math.sin(angleInRadians)
  };
}

function wheelColor(index: number) {
  const colors = ["#7c3aed", "#2563eb", "#059669", "#ca8a04", "#dc2626", "#0891b2"];
  return colors[index % colors.length] ?? "#7c3aed";
}

function truncateText(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}.` : value;
}

function readRequestMessage(error: unknown) {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return null;
  }

  const response = (error as { response?: { data?: { message?: unknown } } }).response;
  return typeof response?.data?.message === "string" ? response.data.message : null;
}
