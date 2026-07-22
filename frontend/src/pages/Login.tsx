import {
  Bot,
  Check,
  CheckCircle2,
  Code2,
  Gauge,
  Headphones,
  KeyRound,
  Link2,
  Loader2,
  LogIn,
  Menu,
  MonitorCog,
  Network,
  PanelTop,
  PlugZap,
  Rocket,
  Server,
  Settings2,
  ShieldCheck,
  Terminal,
  Wrench,
  X
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import type { AuthResponse } from "../types";

const SUPPORT_URL = "https://discord.gg/KAGgfuTcDS";

type LoginProps = {
  auth: AuthResponse | null;
  error?: string | null;
  onLoginDiscord: () => void;
  onVerify: () => void;
  verifying: boolean;
};

type PublicServer = {
  botId?: string;
  botName?: string;
  iconUrl: string | null;
  id: string;
  memberCount: number;
  name: string;
  status?: string;
};

type PublicStatusService = {
  currentStatus?: string;
  id: string;
  responseTimeMs: number | null;
  uptimePercentage?: number;
};

type PublicStatusSnapshot = {
  categories?: Array<{
    services?: PublicStatusService[];
  }>;
  generatedAt?: string;
};

type LandingMetrics = {
  botsCreated: number | null;
  responseTimeMs: number | null;
  updatedAt: string | null;
  uptimePercent: number | null;
};

type TerminalResponseLine = {
  text: string;
  tone?: "status" | "muted";
};

type TerminalSequence = {
  command: string;
  response: TerminalResponseLine[];
};

const terminalSequences: [TerminalSequence, ...TerminalSequence[]] = [
  {
    command: "$ GET /auth/discord/dashboard",
    response: [
      { text: "302 Discord OAuth2", tone: "status" },
      { text: "GET /dashboard/session" },
      { text: "{" },
      { text: '  "user": "discord:authorized",' },
      { text: '  "access": "verified",' },
      { text: '  "modules": ["logs", "tickets", "courses"]' },
      { text: "}" },
      { text: 'dashboard: "online"' },
      { text: 'redirect: "/dashboard"' }
    ]
  },
  {
    command: "$ POST /api/v1/panels/sync",
    response: [
      { text: "{" },
      { text: '  "server": "NextTech",' },
      { text: '  "modules": ["tickets", "payments", "welcome"]' },
      { text: '  "mode": "components-v2"' },
      { text: "}" },
      { text: "200 Synced", tone: "status" },
      { text: 'cache: "updated"' },
      { text: 'status: "online"' },
      { text: 'deploy: "ready"' }
    ]
  }
];

const terminalRuntimeRows = [
  { label: "Dashboard", value: "operacional", width: "w-[94%]" },
  { label: "Bot Discord", value: "online", width: "w-[82%]" },
  { label: "Componentes V2", value: "sincronizado", width: "w-[88%]" }
];

const LANDING_SERVERS_REFRESH_MS = 60_000;

const solutionCards = [
  {
    badge: "Para desenvolvedores",
    cta: "Usar API",
    description: "Endpoints diretos para criar, configurar e monitorar bots com velocidade.",
    features: ["Tokens seguros", "Webhooks e logs", "Resposta em milissegundos"],
    icon: Code2,
    popular: false,
    title: "API de Bots"
  },
  {
    badge: "Sem programar",
    cta: "Criar Bot",
    description: "Fluxo guiado para ativar um bot pronto com módulos essenciais.",
    features: ["Setup rapido", "Módulos prontos", "Painel visual"],
    icon: Bot,
    popular: true,
    title: "Bot Pronto"
  },
  {
    badge: "Para gerenciadores",
    cta: "Abrir Painel",
    description: "Controle permissões, servidores, bots e recursos por uma interface central.",
    features: ["Controle total", "Multi-servidor", "Acesso por cargos"],
    icon: Wrench,
    popular: false,
    title: "Painel de Controle"
  }
];

const resources = [
  { description: "Criação, validação e ativação em poucos cliques.", icon: Rocket, title: "Crie em Milissegundos" },
  { description: "Ajustes finos para módulos, permissões e mensagens.", icon: Settings2, title: "Muitas Configurações" },
  { description: "Status, logs e operação em tempo real.", icon: Gauge, title: "Monitoramento" },
  { description: "Gerencie bots, servidores e acessos sem sair do painel.", icon: MonitorCog, title: "Controle Total" },
  { description: "Estruture contas e identidades para cada operação.", icon: ShieldCheck, title: "Criação de Contas" },
  { description: "Integre seu fluxo com endpoints diretos e previsíveis.", icon: PlugZap, title: "API Simples e Poderosa" },
  { description: "Gere links e convites de forma automática.", icon: Link2, title: "Link de Convite Automático" },
  { description: "Conecte moderação, logs, vendas, FiveM e integrações sociais.", icon: Network, title: "Múltiplos Modos/Integrações" }
];

const steps = [
  { description: "Entre com Discord e valide seu acesso à plataforma.", icon: KeyRound, title: "Obtenha seu Token" },
  { description: "Escolha módulos, permissões, canais e comportamento do bot.", icon: PanelTop, title: "Configure seu Bot" },
  { description: "Publique, monitore e ajuste tudo pelo dashboard.", icon: CheckCircle2, title: "Pronto para Usar" }
];

export function Login({
  auth,
  error,
  onLoginDiscord,
  onVerify,
  verifying
}: LoginProps) {
  const [publicServers, setPublicServers] = useState<PublicServer[]>([]);
  const [landingMetrics, setLandingMetrics] = useState<LandingMetrics>({
    botsCreated: null,
    responseTimeMs: null,
    updatedAt: null,
    uptimePercent: null
  });
  const currentYear = new Date().getFullYear();
  const verificationPending = Boolean(auth && !auth.access.verified);
  const startLabel = verifying ? "Verificando..." : verificationPending ? "Verificar acesso" : "Entrar na Dashboard";
  const stats = buildLandingStats(landingMetrics, publicServers);

  useEffect(() => {
    let active = true;

    const loadServers = async () => {
      try {
        const response = await fetch("/api/health/servers", { cache: "no-store" });
        if (!response.ok) throw new Error("Falha ao carregar servidores");
        const data = await response.json() as { servers?: PublicServer[] };
        if (!active) return;

        const servers = data.servers ?? [];
        setPublicServers(servers);
        setLandingMetrics((current) => ({
          ...current,
          botsCreated: servers.length,
          updatedAt: current.updatedAt ?? new Date().toISOString()
        }));
      } catch {
        // Mantém a última leitura válida na landing pública.
      }
    };

    void loadServers();
    const interval = window.setInterval(() => { void loadServers(); }, LANDING_SERVERS_REFRESH_MS);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let active = true;

    function applyStatus(snapshot: PublicStatusSnapshot) {
      if (!active) return;
      setLandingMetrics((current) => ({
        ...current,
        responseTimeMs: getLandingResponseTime(snapshot),
        updatedAt: snapshot.generatedAt ?? new Date().toISOString(),
        uptimePercent: getLandingUptime(snapshot)
      }));
    }

    const loadStatus = async () => {
      try {
        const response = await fetch("/api/public/status", { cache: "no-store" });
        if (!response.ok) throw new Error("Falha ao carregar status");
        applyStatus(await response.json() as PublicStatusSnapshot);
      } catch {
        // Mantém a última leitura válida na landing pública.
      }
    };

    void loadStatus();

    if (typeof EventSource === "undefined") {
      const interval = window.setInterval(() => { void loadStatus(); }, 5_000);
      return () => {
        active = false;
        window.clearInterval(interval);
      };
    }

    const source = new EventSource("/api/public/status/events");
    source.addEventListener("status-update", (event) => {
      try {
        applyStatus(JSON.parse(event.data) as PublicStatusSnapshot);
      } catch {
        // Ignora eventos inválidos sem quebrar a landing pública.
      }
    });
    source.onerror = () => {
      void loadStatus();
    };

    return () => {
      active = false;
      source.close();
    };
  }, []);

  function handleStart() {
    if (auth) {
      onVerify();
      return;
    }

    onLoginDiscord();
  }

  function scrollTo(id: string) {
    if (id === "planos") {
      window.location.assign("/planos");
      return;
    }
    if (id === "docs") {
      window.location.assign("/docs");
      return;
    }
    if (id === "status") {
      window.location.assign("/status");
      return;
    }
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <main className="min-h-screen w-full max-w-[100vw] overflow-x-hidden bg-[#0A0A0A] text-white">
      <div className="fixed inset-0 -z-10 bg-[#0A0A0A]" />

      <Header entering={verifying} onStart={handleStart} onNavigate={scrollTo} />

      <section id="inicio" className="relative mx-auto grid min-h-screen w-full max-w-[100vw] items-center gap-10 overflow-hidden px-4 pb-16 pt-32 text-center sm:max-w-7xl sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(25rem,0.95fr)] lg:px-8 lg:text-left">
        <div className="flex w-full min-w-0 max-w-[21rem] flex-col items-center justify-self-center lg:max-w-none lg:items-start">
          <Reveal delay={0.1} className="inline-flex w-full max-w-[20rem] items-center justify-center rounded-full border border-[#FFD500]/25 bg-[#FFD500]/10 px-4 py-2 text-center text-xs font-medium leading-5 text-[#FFEA70] sm:w-auto sm:max-w-full sm:text-sm">
            A plataforma #1 de automação para Discord
          </Reveal>

          <Reveal delay={0.2} className="mt-8 w-full max-w-[21rem] sm:max-w-5xl">
            <h1 className="max-w-full text-3xl font-black leading-tight text-white sm:text-6xl lg:text-7xl">
              Automatize seu servidor{" "}
              <span className="inline-block text-[#FFD500]">
                do seu jeito
              </span>
            </h1>
          </Reveal>

          <Reveal delay={0.3} className="w-full max-w-[21rem] sm:max-w-5xl">
            <p className="mx-auto mt-6 max-w-2xl text-base leading-8 text-[#B3B3B3] sm:text-lg lg:mx-0">
              {verificationPending
                ? "Confirme a segunda etapa de autenticação para liberar a dashboard deste usuário."
                : "Entre pela Dashboard com OAuth2 do Discord, configure seus bots e controle módulos, permissões, canais e logs em tempo real."}
            </p>
          </Reveal>

          <Reveal delay={0.4} className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start">
            <Button className="h-12 min-w-44" disabled={verifying} onClick={handleStart}>
              {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              {startLabel}
            </Button>
            <Button className="h-12 min-w-44" onClick={() => scrollTo("solucoes")} variant="outline">
              Ver Soluções
            </Button>
          </Reveal>
          {error ? (
            <Reveal delay={0.45} className="mt-5 w-full max-w-2xl rounded-lg border border-red-500/35 bg-red-500/10 px-4 py-4 text-sm font-medium text-red-100">
              <p>{error}</p>
              <Button asChild className="mt-3 h-10 w-full sm:w-auto" variant="outline">
                <a href={SUPPORT_URL} rel="noreferrer" target="_blank">
                  <Headphones className="h-4 w-4" />
                  Falar com suporte
                </a>
              </Button>
            </Reveal>
          ) : null}
        </div>

        <Reveal delay={0.5} className="w-full max-w-3xl justify-self-center lg:max-w-none">
          <TerminalMockup metrics={landingMetrics} />
        </Reveal>
      </section>

      <PublicServerMarquee servers={publicServers} />

      <section id="solucoes" className="home-section mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeading
          badge="Uma plataforma, várias soluções"
          subtitle="Escolha o nível de automação que combina com o seu time, do painel visual à API."
          title="Escolha como quer automatizar"
        />

        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          {solutionCards.map((solution, index) => (
            <SolutionCard key={solution.title} onStart={handleStart} solution={solution} index={index} />
          ))}
        </div>

        <Reveal className="mt-24 grid gap-10 py-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-14">
          {stats.map((stat, index) => (
            <StatCounter delay={index * 120} key={stat.label} {...stat} />
          ))}
        </Reveal>
      </section>

      <section id="docs" className="home-section mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeading
          subtitle="Ferramentas para criar, operar e escalar bots com menos trabalho manual."
          title="Recursos Poderosos"
        />

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {resources.map((resource, index) => {
            const featured = resource.title === "Controle Total";
            return (
            <Reveal
              className={`rounded-lg border bg-[#141414] p-5 transition-colors duration-150 hover:border-[#FFD500]/45 ${featured ? "border-[#FFD500]/36 sm:col-span-2 lg:col-span-2" : "border-[#FFD500]/18"}`}
              delay={index * 0.035}
              key={resource.title}
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-lg border border-[#FFD500]/30 bg-[#FFD500]/10 text-[#FFD500]">
                <resource.icon className="h-6 w-6" />
              </span>
              <h3 className="mt-5 text-base font-bold text-white">{resource.title}</h3>
              <p className="mt-3 text-sm leading-6 text-[#B3B3B3]">{resource.description}</p>
            </Reveal>
            );
          })}
        </div>
      </section>

      <section id="como-funciona" className="home-section mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeading
          subtitle="Em 3 passos simples você já está com tudo funcionando."
          title="Como Funciona"
        />

        <div className="relative mx-auto mt-14 max-w-5xl">
          <div className="absolute left-[16.666%] right-[16.666%] top-8 hidden h-px bg-gradient-to-r from-[#FFD500]/20 via-[#FFD500]/70 to-[#FFD500]/20 lg:block" />
          <div className="grid gap-12 lg:grid-cols-3 lg:gap-8">
            {steps.map((step, index) => (
              <Reveal className="relative flex flex-col items-center text-center" delay={index * 0.08} key={step.title}>
                <div className="relative z-10 flex h-16 w-16 items-center justify-center rounded-lg border border-[#FFD500]/35 bg-[#111108] text-[#FFD500]">
                  <step.icon className="h-7 w-7" />
                  <span className="absolute -right-2 -top-2 flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-[#050505] bg-[#FFD500] px-1 text-[10px] font-black leading-none text-black">
                    0{index + 1}
                  </span>
                </div>
                <h3 className="mt-6 text-xl font-bold text-white">{step.title}</h3>
                <p className="mt-3 max-w-[280px] text-sm leading-6 text-[#B3B3B3]">{step.description}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section id="suporte" className="home-section px-4 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-5xl rounded-lg border border-[#FFD500]/22 bg-[#141414] px-6 py-12 text-center sm:px-10">
          <h2 className="text-4xl font-black text-white sm:text-5xl">Pronto para automatizar seus bots?</h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-[#B3B3B3]">
            Entre com Discord, valide seu acesso e comece a controlar seus bots pelo Nex Tech.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button className="h-12 min-w-44" disabled={verifying} onClick={handleStart}>
              {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              {startLabel}
            </Button>
            <Button asChild className="h-12 min-w-44" variant="outline">
              <a href={SUPPORT_URL} rel="noreferrer" target="_blank">
                <Headphones className="h-4 w-4" />
                Falar com Suporte
              </a>
            </Button>
          </div>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3 text-sm text-[#B3B3B3]">
            <span>⚡ Acesso instantâneo</span>
            <span className="text-[#FFD500]/50">·</span>
            <span>🎧 Suporte 24/7</span>
            <span className="text-[#FFD500]/50">·</span>
            <span>📄 API documentada</span>
          </div>
        </Reveal>
      </section>

      <Footer currentYear={currentYear} onNavigate={scrollTo} />
    </main>
  );
}

function Header({ entering, onNavigate, onStart }: { entering: boolean; onNavigate: (id: string) => void; onStart: () => void }) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const nav = [
    ["Início", "inicio"],
    ["Soluções", "solucoes"],
    ["Planos", "planos"],
    ["Status", "status"],
    ["Docs", "docs"],
    ["Suporte", "suporte"]
  ] as const;

  return (
    <header
      className={`fixed left-0 right-0 top-0 z-50 border-b px-4 transition-colors duration-200 sm:px-6 lg:px-8 ${scrolled ? "border-[#FFD500]/18 bg-[#0A0A0A]/95 py-3 shadow-[0_12px_34px_rgba(0,0,0,0.34)]" : "border-transparent bg-[#0A0A0A]/82 py-4"}`}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
        <button className="flex items-center gap-2 text-left" onClick={() => onNavigate("inicio")} type="button">
          <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg border border-[#FFD500]/30 bg-[#050505] shadow-[0_0_22px_rgba(255,213,0,0.18)]">
            <img alt="NexTech" className="h-full w-full object-cover object-center" src="/brand/nextech.png" />
          </span>
          <span className="text-xl font-black text-[#FFD500] drop-shadow-[0_0_18px_rgba(255,213,0,0.28)]">Nex Tech</span>
        </button>

        <nav className="hidden items-center gap-1 rounded-full border border-[#FFD500]/15 bg-black/35 p-1 md:flex">
          {nav.map(([label, id]) => (
            <button className="rounded-full px-4 py-2 text-sm font-medium text-zinc-300 transition hover:bg-[#FFD500]/10 hover:text-[#FFEA70]" key={id} onClick={() => { setMenuOpen(false); onNavigate(id); }} type="button">
              {label}
            </button>
          ))}
        </nav>

        <Button className="hidden h-10 px-4 sm:inline-flex" disabled={entering} onClick={onStart}>
          {entering ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {entering ? "Entrando..." : "Dashboard"}
        </Button>
        <button
          aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
          className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#FFD500]/25 bg-black/35 px-3 text-sm font-semibold text-[#FFEA70] md:hidden"
          onClick={() => setMenuOpen((current) => !current)}
          type="button"
        >
          {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          Menu
        </button>
      </div>
      {menuOpen ? (
        <div className="mx-auto mt-3 grid max-w-7xl gap-2 rounded-lg border border-[#FFD500]/20 bg-[#0A0A0A]/98 p-3 shadow-[0_14px_38px_rgba(0,0,0,0.42)] md:hidden">
          {nav.map(([label, id]) => (
            <button className="rounded-lg px-3 py-3 text-left text-sm font-semibold text-zinc-200 transition hover:bg-[#FFD500]/10 hover:text-[#FFEA70]" key={`mobile-${id}`} onClick={() => { setMenuOpen(false); onNavigate(id); }} type="button">
              {label}
            </button>
          ))}
          <Button className="h-11 w-full" disabled={entering} onClick={() => { setMenuOpen(false); onStart(); }}>
            {entering ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {entering ? "Entrando..." : "Dashboard"}
          </Button>
        </div>
      ) : null}
    </header>
  );
}

function SectionHeading({ badge, subtitle, title }: { badge?: string; subtitle: string; title: string }) {
  const titleClassName = title === "Como Funciona"
    ? "como-funciona-title text-4xl text-white sm:text-5xl"
    : "text-4xl font-black text-white sm:text-5xl";

  return (
    <Reveal className="mx-auto max-w-3xl text-center">
      {badge ? <p className="mx-auto mb-4 inline-flex rounded-full border border-[#FFD500]/25 bg-[#FFD500]/10 px-4 py-2 text-sm font-medium text-[#FFEA70]">{badge}</p> : null}
      <h2 className={titleClassName}>{title}</h2>
      <p className="mx-auto mt-4 max-w-2xl text-base leading-8 text-[#B3B3B3]">{subtitle}</p>
    </Reveal>
  );
}

function TerminalMockup({ metrics }: { metrics: LandingMetrics }) {
  const sequence = terminalSequences[0];
  const terminalMetrics = [
    { label: "Gateway", value: formatMilliseconds(metrics.responseTimeMs, "ao vivo"), tone: "text-[#3DDC84]" },
    { label: "Uptime", value: formatPercent(metrics.uptimePercent, "ao vivo"), tone: "text-[#FFEA70]" },
    { label: "Bots", value: metrics.botsCreated === null ? "ao vivo" : metrics.botsCreated.toLocaleString("pt-BR"), tone: "text-white" }
  ];

  return (
    <div className="relative overflow-hidden rounded-lg border border-[#FFD500]/22 bg-[#080808] text-left shadow-[0_18px_54px_rgba(0,0,0,0.46)]">
      <div className="relative flex items-center gap-3 border-b border-[#FFD500]/15 bg-[#111111]/95 px-4 py-3">
        <div className="flex shrink-0 items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-[#FFD900]" />
          <span className="h-3 w-3 rounded-full bg-[#4B4B4B]" />
          <span className="h-3 w-3 rounded-full bg-[#4B4B4B]" />
        </div>
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-zinc-400">
          <Terminal className="h-4 w-4 text-[#FFD500]" />
          <span className="truncate">nex-tech-cli ~ nextech.discloud.app</span>
        </div>
      </div>

      <div className="relative grid gap-0 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div aria-label="Demonstração do terminal Nex Tech" aria-live="off" className="min-h-[23rem] p-5 font-mono text-sm leading-7">
          <div className="mb-5 flex flex-wrap gap-2 font-sans text-[11px] font-bold uppercase tracking-[0.08em] text-zinc-400">
            <span className="rounded-md border border-[#FFD500]/20 bg-[#FFD500]/10 px-2.5 py-1 text-[#FFEA70]">auth</span>
            <span className="rounded-md border border-zinc-800 bg-black/40 px-2.5 py-1">dashboard</span>
            <span className="rounded-md border border-zinc-800 bg-black/40 px-2.5 py-1">discord api</span>
          </div>
          <TerminalCommandLine command={sequence.command} />
          {sequence.response.map((line, index) => (
            <TerminalResponseItem key={`${line.text}-${index}`} line={line} />
          ))}
          <div className="mt-5 grid gap-2 font-sans text-xs text-zinc-400 sm:grid-cols-3">
            {terminalMetrics.map((metric) => (
              <div className="rounded-md border border-zinc-900 bg-black/35 px-3 py-2" key={metric.label}>
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-zinc-500">{metric.label}</p>
                <p className={`mt-1 text-base font-black ${metric.tone}`}>{metric.value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-[#FFD500]/15 bg-black/25 p-5 lg:border-l lg:border-t-0">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#FFD500]">Runtime</p>
            <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-1 text-[11px] font-bold text-emerald-300">live</span>
          </div>
          <div className="mt-5 space-y-4">
            {terminalRuntimeRows.map((row) => (
              <div key={row.label}>
                <div className="mb-2 flex items-center justify-between gap-3 text-xs">
                  <span className="font-semibold text-white">{row.label}</span>
                  <span className="text-zinc-500">{row.value}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-zinc-900">
                  <span className={`block h-full rounded-full bg-[#3DDC84] ${row.width}`} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 rounded-md border border-[#FFD500]/15 bg-[#FFD500]/5 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-white">
              <Check className="h-4 w-4 text-[#3DDC84]" />
              Atualizacao segura
            </div>
            <p className="mt-2 text-xs leading-5 text-zinc-400">Painel validado, cache limpo e rotas prontas para uso.</p>
          </div>
        </div>
      </div>

      <div className="relative flex items-center justify-between border-t border-[#FFD500]/15 bg-[#0d0d0d]/90 px-4 py-3 text-xs text-zinc-400">
        <span>request_id: nex-tech-live-demo</span>
        <span className="flex items-center gap-2 text-[#3DDC84]">
          <span className="h-2.5 w-2.5 rounded-full bg-[#3DDC84]" />
          Online
        </span>
      </div>
    </div>
  );
}

function TerminalCommandLine({ command }: { command: string }) {
  const hasPrompt = command.startsWith("$");

  return (
    <p className="flex min-h-7 min-w-0 items-center whitespace-pre-wrap text-zinc-100">
      {hasPrompt ? <span className="text-[#FFD900]">$</span> : null}
      <span>{hasPrompt ? command.slice(1) : command}</span>
    </p>
  );
}

function TerminalResponseItem({ line }: { line: TerminalResponseLine }) {
  if (line.tone === "status") {
    return <p className="terminal-response-line min-h-7 whitespace-pre-wrap text-[#3DDC84]">{line.text}</p>;
  }

  return (
    <p className="terminal-response-line min-h-7 whitespace-pre-wrap text-zinc-300">
      <TerminalHighlightedLine text={line.text} />
    </p>
  );
}

function TerminalHighlightedLine({ text }: { text: string }) {
  const match = text.match(/^(\s*)("[^"]+"|[A-Za-z_][\w-]*)(:)(.*)$/);
  if (!match) return <>{text}</>;

  const [, leading, key, colon, rest] = match;

  return (
    <>
      {leading}
      <span className="text-[#FFEA70]">{key}</span>
      <span className="text-zinc-500">{colon}</span>
      {rest}
    </>
  );
}

function SolutionCard({ index, onStart, solution }: { index: number; onStart: () => void; solution: (typeof solutionCards)[number] }) {
  return (
    <Reveal
      className={`relative flex min-h-[25rem] flex-col rounded-lg border bg-[#141414] p-6 transition-colors duration-150 hover:border-[#FFD500]/50 ${solution.popular ? "border-[#FFD500]/45" : "border-[#FFD500]/18"}`}
      delay={index * 0.08}
    >
      {solution.popular ? (
        <span className="absolute right-4 top-4 rounded-full border border-[#FFD500]/35 bg-[#FFD500] px-3 py-1 text-xs font-black text-black">
          Mais popular
        </span>
      ) : null}
      <solution.icon className="h-8 w-8 text-[#FFD500]" />
      <p className="mt-5 text-sm font-semibold text-[#FFEA70]">{solution.badge}</p>
      <h3 className="mt-2 text-2xl font-black text-white">{solution.title}</h3>
      <p className="mt-3 text-sm leading-6 text-[#B3B3B3]">{solution.description}</p>
      <ul className="mt-6 space-y-3">
        {solution.features.map((feature) => (
          <li className="flex items-center gap-3 text-sm text-zinc-200" key={feature}>
            <Check className="h-4 w-4 text-[#FFD500]" />
            {feature}
          </li>
        ))}
      </ul>
      <Button className="mt-auto h-11 w-full" onClick={onStart} variant={solution.popular ? "default" : "outline"}>
        {solution.cta}
      </Button>
    </Reveal>
  );
}

function StatCounter({
  decimals = 0,
  displayOverride,
  label,
  prefix = "",
  suffix = "",
  value
}: {
  decimals?: number;
  delay?: number;
  displayOverride?: string;
  label: string;
  prefix?: string;
  suffix?: string;
  value: number;
}) {
  const formattedValue = displayOverride ?? `${prefix}${formatStatNumber(value, decimals)}${suffix}`;

  return (
    <div className="text-center">
      <p className="text-4xl font-black tracking-tight text-[#FFD500] sm:text-5xl">{formattedValue}</p>
      <p className="mt-2 text-sm text-[#B3B3B3]">{label}</p>
    </div>
  );
}

function buildLandingStats(metrics: LandingMetrics, servers: PublicServer[]) {
  const hasBotCount = metrics.botsCreated !== null || servers.length > 0;
  const botsCreated = metrics.botsCreated ?? servers.length;
  const responseTime = metrics.responseTimeMs;
  const uptime = metrics.uptimePercent;

  return [
    { displayOverride: hasBotCount ? undefined : "ao vivo", label: "Bots Criados", prefix: "+", value: botsCreated },
    {
      decimals: uptime !== null && uptime % 1 !== 0 ? 1 : 0,
      displayOverride: uptime === null ? "ao vivo" : undefined,
      label: "Uptime",
      suffix: "%",
      value: uptime ?? 0
    },
    {
      displayOverride: responseTime === null ? "ao vivo" : undefined,
      label: "Tempo de Resposta",
      suffix: "ms",
      value: responseTime ?? 0
    },
    { label: "Suporte", suffix: "/7", value: 24 }
  ];
}

function getLandingServices(snapshot: PublicStatusSnapshot) {
  return snapshot.categories?.flatMap((category) => category.services ?? []) ?? [];
}

function getLandingResponseTime(snapshot: PublicStatusSnapshot) {
  const services = getLandingServices(snapshot);
  const botService = services.find((service) => service.id === "discord-bot");
  if (typeof botService?.responseTimeMs === "number") return Math.max(0, Math.round(botService.responseTimeMs));

  const samples = services
    .map((service) => service.responseTimeMs)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (!samples.length) return null;
  return Math.max(0, Math.round(samples.reduce((total, value) => total + value, 0) / samples.length));
}

function getLandingUptime(snapshot: PublicStatusSnapshot) {
  const samples = getLandingServices(snapshot)
    .filter((service) => service.currentStatus !== "unknown")
    .map((service) => service.uptimePercentage)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (!samples.length) return null;
  const average = samples.reduce((total, value) => total + value, 0) / samples.length;
  return Math.round(average * 10) / 10;
}

function formatStatNumber(value: number, decimals: number) {
  return value.toLocaleString("pt-BR", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals
  });
}

function formatMilliseconds(value: number | null, fallback: string) {
  return value === null ? fallback : `${value.toLocaleString("pt-BR")}ms`;
}

function formatPercent(value: number | null, fallback: string) {
  return value === null ? fallback : `${formatStatNumber(value, value % 1 === 0 ? 0 : 1)}%`;
}

function PublicServerMarquee({ servers }: { servers: PublicServer[] }) {
  if (!servers.length) return null;
  const items = servers.slice(0, 10);

  return (
    <section aria-label="Bots cadastrados" className="relative border-y border-[#FFD500]/12 bg-black/30 py-10">
      <p className="mb-6 text-center text-[11px] font-bold uppercase tracking-[.22em] text-[#FFD500]">
        {servers.length} {servers.length === 1 ? "bot cadastrado" : "bots cadastrados na Nex Tech"}
      </p>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-8 px-4 sm:gap-10">
        <PublicServerGroup servers={items} />
      </div>
    </section>
  );
}

function PublicServerGroup({ servers }: { servers: PublicServer[] }) {
  return (
    <>
      {servers.map((server, index) => (
        <div className="flex w-36 shrink-0 flex-col items-center text-center" key={`${server.botId ?? server.id}-${index}`}>
          <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border border-[#FFD500]/28 bg-[#141414]">
            {server.iconUrl ? <img alt="" className="h-full w-full object-cover" loading="lazy" src={server.iconUrl} /> : <Server aria-hidden="true" className="h-6 w-6 text-[#FFD500]" />}
          </div>
          <p className="mt-3 w-full truncate text-sm font-semibold text-zinc-200" title={server.botName ?? server.name}>{server.botName ?? server.name}</p>
          <p className="mt-1 w-full truncate text-xs font-medium text-[#FFD500]" title={server.name}>{server.name}</p>
          <p className="mt-1 text-[11px] font-medium text-zinc-400">{server.memberCount.toLocaleString("pt-BR")} membros</p>
        </div>
      ))}
    </>
  );
}

function Footer({ currentYear, onNavigate }: { currentYear: number; onNavigate: (id: string) => void }) {
  return (
    <footer className="border-t border-[#FFD500]/15 bg-[#050505] px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-4">
        <div>
          <button className="text-2xl font-black text-[#FFD500]" onClick={() => onNavigate("inicio")} type="button">Nex Tech</button>
          <p className="mt-3 text-sm text-zinc-400">Desde {currentYear} — Transforma</p>
          <p className="mt-3 text-sm leading-6 text-[#B3B3B3]">Plataforma para criação, controle e gerenciamento de bots conectados ao Discord.</p>
        </div>
        <FooterColumn title="Navegação" links={[["Início", "inicio"], ["Soluções", "solucoes"], ["Status", "status"], ["Documentação", "docs"], ["Dashboard", "inicio"]]} onNavigate={onNavigate} />
        <FooterColumn title="Soluções" links={[["API de Bots", "solucoes"], ["Bot Pronto", "solucoes"], ["Painel de Controle", "solucoes"]]} onNavigate={onNavigate} />
        <div>
          <h3 className="text-sm font-bold uppercase text-white">Contato</h3>
          <a className="mt-4 inline-flex text-sm text-[#B3B3B3] transition hover:text-[#FFEA70]" href={SUPPORT_URL} rel="noreferrer" target="_blank">Discord</a>
        </div>
      </div>
      <div className="mx-auto mt-10 max-w-7xl border-t border-[#FFD500]/10 pt-6 text-sm text-zinc-500">
        © {currentYear} Nex Tech. Todos os direitos reservados.
      </div>
    </footer>
  );
}

function FooterColumn({ links, onNavigate, title }: { links: Array<[string, string]>; onNavigate: (id: string) => void; title: string }) {
  return (
    <div>
      <h3 className="text-sm font-bold uppercase text-white">{title}</h3>
      <div className="mt-4 grid gap-3">
        {links.map(([label, id]) => (
          <button className="w-fit text-left text-sm text-[#B3B3B3] transition hover:text-[#FFEA70]" key={`${title}-${label}`} onClick={() => onNavigate(id)} type="button">
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Reveal({ children, className, delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  return <div className={className} style={delay ? { transitionDelay: `${delay * 1000}ms` } : undefined}>{children}</div>;
}
