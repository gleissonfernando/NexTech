import {
  Bot,
  Check,
  CheckCircle2,
  Code2,
  Gauge,
  Headphones,
  KeyRound,
  Layers3,
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
  Sparkles,
  Terminal,
  Wrench,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { Button } from "../components/ui/button";
import type { AuthResponse } from "../types";

const SUPPORT_URL = "https://discord.gg/7WYzSwVBPm";
const LANDING_SERVERS_REFRESH_MS = 60_000;

type LoginProps = {
  auth: AuthResponse | null;
  error?: string | null;
  onLoginDiscord: () => void;
  onVerify: () => void;
  verifying: boolean;
};

type PublicConnectedServer = {
  botNames: string[];
  connectedBots: number;
  guildId: string;
  iconUrl: string | null;
  memberCount: number;
  name: string;
  online: boolean;
};

type PublicConnectedServersResponse = {
  generatedAt: string;
  servers: PublicConnectedServer[];
  totalBots: number;
  totalUniqueServers: number;
};

type PublicMarketingFeature = {
  category: string;
  fullDescription: string;
  icon: string;
  id: string;
  shortDescription: string;
  title: string;
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
  responseTimeMs: number | null;
  updatedAt: string | null;
  uptimePercent: number | null;
};

type ServerState = {
  error: boolean;
  loading: boolean;
  value: PublicConnectedServersResponse | null;
};

type MarketingFeatureState = {
  loading: boolean;
  value: PublicMarketingFeature[];
};

type TerminalBlock = {
  category: string;
  lines: string[];
};

const fallbackServers: PublicConnectedServersResponse = {
  generatedAt: new Date(0).toISOString(),
  servers: [],
  totalBots: 0,
  totalUniqueServers: 0
};

const fallbackFeatures: [PublicMarketingFeature, PublicMarketingFeature, PublicMarketingFeature] = [
  {
    category: "Automação",
    fullDescription: "Crie sistemas de tickets, cursos, ações, verificações, logs e outros módulos integrados ao Discord e à dashboard NexTech.",
    icon: "bot",
    id: "automation",
    shortDescription: "Automatize tarefas, processos e fluxos do seu servidor.",
    title: "Automação completa"
  },
  {
    category: "Dashboard",
    fullDescription: "Controle configurações, canais, cargos, módulos e integrações sem precisar alterar o código manualmente.",
    icon: "monitor",
    id: "central-control",
    shortDescription: "Gerencie bots, servidores e permissões em um único painel.",
    title: "Controle centralizado"
  },
  {
    category: "Monitoramento",
    fullDescription: "Visualize bots online, servidores conectados, tempo de resposta, logs operacionais e informações essenciais da plataforma.",
    icon: "gauge",
    id: "monitoring",
    shortDescription: "Acompanhe status, desempenho e atividade em tempo real.",
    title: "Monitoramento inteligente"
  }
];

const terminalBlocks: TerminalBlock[] = [
  {
    category: "Inicialização",
    lines: [
      "> Inicializando NexTech Core...",
      "> Conectando módulos seguros...",
      "> Carregando componentes V2...",
      "const nexTech = await createAutomation({",
      '  platform: "Discord",',
      '  dashboard: true,',
      '  monitoring: "realtime",',
      '  security: "enabled"',
      "});",
      "> Sistema disponível."
    ]
  },
  {
    category: "Componentes V2",
    lines: [
      "> Preparando painel de componentes...",
      "> Verificando permissões públicas...",
      "await nexTech.modules.register([",
      '  "tickets",',
      '  "logs",',
      '  "courses",',
      '  "actions",',
      '  "verification"',
      "]);",
      "> Componentes sincronizados."
    ]
  },
  {
    category: "Monitoramento",
    lines: [
      "> Sincronizando métricas da dashboard...",
      "> Validando status operacional...",
      "const status = await nexTech.deploy();",
      "console.log({",
      '  gateway: "connected",',
      '  dashboard: "online",',
      '  components: "synchronized",',
      '  responseTime: "42ms"',
      "});",
      "> Deploy visual concluído."
    ]
  },
  {
    category: "Segurança",
    lines: [
      "> Validando escopos seguros...",
      "> Aplicando políticas de cache...",
      "await nexTech.security.configure({",
      '  tokens: "hidden",',
      '  publicDataOnly: true,',
      '  rateLimit: "enabled"',
      "});",
      "> Nenhum segredo exposto."
    ]
  }
];

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
  const [servers, setServers] = useState<ServerState>({ error: false, loading: true, value: null });
  const [features, setFeatures] = useState<MarketingFeatureState>({ loading: true, value: fallbackFeatures });
  const [landingMetrics, setLandingMetrics] = useState<LandingMetrics>({
    responseTimeMs: null,
    updatedAt: null,
    uptimePercent: null
  });
  const currentYear = new Date().getFullYear();
  const verificationPending = Boolean(auth && !auth.access.verified);
  const startLabel = verifying ? "Verificando..." : verificationPending ? "Verificar acesso" : "Entrar na Dashboard";
  const serverData = servers.value ?? fallbackServers;
  const stats = buildLandingStats(landingMetrics, serverData);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    const loadServers = async () => {
      try {
        const response = await fetch("/api/public/connected-servers", {
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) throw new Error("Falha ao carregar servidores");
        const data = await response.json() as PublicConnectedServersResponse;
        if (!active) return;
        setServers({ error: false, loading: false, value: normalizeServersResponse(data) });
      } catch {
        if (active) setServers((current) => ({ ...current, error: !current.value, loading: false }));
      }
    };

    void loadServers();
    const interval = window.setInterval(() => { void loadServers(); }, LANDING_SERVERS_REFRESH_MS);

    return () => {
      active = false;
      controller.abort();
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    async function loadFeatures() {
      try {
        const response = await fetch("/api/public/marketing-features", {
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) throw new Error("Falha ao carregar recursos");
        const data = await response.json() as { features?: PublicMarketingFeature[] };
        if (active) setFeatures({ loading: false, value: ensureThreeFeatures(data.features ?? []) });
      } catch {
        if (active) setFeatures({ loading: false, value: fallbackFeatures });
      }
    }

    void loadFeatures();
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  useEffect(() => {
    let active = true;

    function applyStatus(snapshot: PublicStatusSnapshot) {
      if (!active) return;
      setLandingMetrics({
        responseTimeMs: getLandingResponseTime(snapshot),
        updatedAt: snapshot.generatedAt ?? new Date().toISOString(),
        uptimePercent: getLandingUptime(snapshot)
      });
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
    const interval = window.setInterval(() => { void loadStatus(); }, 10_000);

    return () => {
      active = false;
      window.clearInterval(interval);
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
    if (id === "termos") {
      window.location.assign("/termos");
      return;
    }
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <main className="nex-tech-home min-h-screen w-full max-w-[100vw] overflow-x-hidden bg-[#050505] text-white">
      <div className="fixed inset-0 -z-10 bg-[#050505]" />
      <Header entering={verifying} onStart={handleStart} onNavigate={scrollTo} />

      <section id="inicio" className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col items-center overflow-hidden px-4 pb-16 pt-32 text-center sm:px-6 lg:px-8">
        <Reveal delay={0.1} className="inline-flex max-w-full items-center gap-2 rounded-full border border-[#FFD500]/25 bg-[#FFD500]/10 px-4 py-2 text-center text-xs font-semibold leading-5 text-[#FFEA70] sm:text-sm">
          <Sparkles className="h-4 w-4" />
          Plataforma completa de automação para Discord
        </Reveal>

        <Reveal delay={0.2} className="mt-8 w-full max-w-5xl">
          <h1 className="mx-auto max-w-5xl text-4xl font-black leading-tight text-white sm:text-6xl lg:text-7xl">
            Automação inteligente para o seu servidor{" "}
            <span className="text-[#FFD500]">do seu jeito</span>
          </h1>
        </Reveal>

        <Reveal delay={0.4} className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
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
            <p className="whitespace-pre-line">{error}</p>
            <Button asChild className="mt-3 h-10 w-full sm:w-auto" variant="outline">
              <a href={SUPPORT_URL} rel="noreferrer" target="_blank">
                <Headphones className="h-4 w-4" />
                Falar com suporte
              </a>
            </Button>
          </Reveal>
        ) : null}

        <Reveal delay={0.5} className="mt-12 w-full max-w-5xl">
          <TerminalMockup />
        </Reveal>

      </section>

      <ConnectedServersSection state={servers} />

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
          {stats.map((stat) => (
            <StatCounter key={stat.label} {...stat} />
          ))}
        </Reveal>
      </section>

      <PowerfulFeaturesSection features={features.value} loading={features.loading} onStart={handleStart} />

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
            <span>Acesso instantâneo</span>
            <span className="text-[#FFD500]/50">·</span>
            <span>Suporte 24/7</span>
            <span className="text-[#FFD500]/50">·</span>
            <span>API documentada</span>
          </div>
        </Reveal>
      </section>

      <Footer currentYear={currentYear} onNavigate={scrollTo} />
    </main>
  );
}

function Header({ entering, onNavigate, onStart }: { entering: boolean; onNavigate: (id: string) => void; onStart: () => void }) {
  const [isScrolled, setIsScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    let ticking = false;
    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        setIsScrolled(window.scrollY > 42);
        ticking = false;
      });
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const nav = [
    ["Início", "inicio"],
    ["Soluções", "solucoes"],
    ["Planos", "planos"],
    ["Status", "status"],
    ["Termos", "termos"],
    ["Docs", "docs"],
    ["Suporte", "suporte"]
  ] as const;

  return (
    <header
      className={`fixed left-0 right-0 top-0 z-50 border-b px-4 transition-[background-color,border-color,box-shadow,padding] duration-300 sm:px-6 lg:px-8 ${isScrolled ? "border-transparent bg-transparent py-3" : "border-[#FFD500]/12 bg-[#050505]/88 py-4"}`}
    >
      <div className="relative mx-auto flex max-w-7xl items-center justify-between gap-4">
        <button className="flex items-center gap-2 text-left" onClick={() => onNavigate("inicio")} type="button">
          <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg border border-[#FFD500]/30 bg-[#050505] shadow-[0_0_22px_rgba(255,213,0,0.18)]">
            <img alt="NexTech" className="h-full w-full object-cover object-center" src="/brand/nextech.png" />
          </span>
          <span className="text-xl font-black text-[#FFD500] drop-shadow-[0_0_18px_rgba(255,213,0,0.28)]">Nex Tech</span>
        </button>

        <nav className={`hidden items-center gap-1 border p-1 transition-[transform,border-radius,background-color,box-shadow,backdrop-filter] duration-300 md:flex ${
          isScrolled
            ? "fixed left-1/2 top-3 -translate-x-1/2 rounded-full border-[#FFD500]/22 bg-[#050505]/78 shadow-[0_14px_38px_rgba(0,0,0,0.44)] backdrop-blur-xl"
            : "rounded-full border-[#FFD500]/15 bg-black/35"
        }`}>
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
        <div className="mx-auto mt-3 grid max-w-7xl gap-2 rounded-lg border border-[#FFD500]/20 bg-[#050505]/98 p-3 shadow-[0_14px_38px_rgba(0,0,0,0.42)] md:hidden">
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

function TerminalMockup() {
  const reducedMotion = usePrefersReducedMotion();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(true);
  const [blockIndex, setBlockIndex] = useState(0);
  const [lineIndex, setLineIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const block = terminalBlocks[blockIndex % terminalBlocks.length] ?? terminalBlocks[0]!;
  const displayedLines = useMemo(() => {
    const completed = block.lines.slice(0, lineIndex);
    const current = block.lines[lineIndex] ?? "";
    return current ? [...completed, current.slice(0, charIndex)] : completed;
  }, [block.lines, charIndex, lineIndex]);
  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? true), { threshold: 0.2 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;

    if (reducedMotion) {
      setLineIndex(block.lines.length);
      setCharIndex(0);
      const timer = window.setTimeout(() => {
        setBlockIndex((current) => (current + 1) % terminalBlocks.length);
        setLineIndex(0);
      }, 6000);
      return () => window.clearTimeout(timer);
    }

    const currentLine = block.lines[lineIndex] ?? "";
    const isLineDone = charIndex >= currentLine.length;
    const isBlockDone = lineIndex >= block.lines.length;
    const delay = isBlockDone ? 2600 : isLineDone ? 360 : 18 + Math.round(Math.random() * 22);
    const timer = window.setTimeout(() => {
      if (isBlockDone) {
        setBlockIndex((current) => (current + 1) % terminalBlocks.length);
        setLineIndex(0);
        setCharIndex(0);
        return;
      }
      if (isLineDone) {
        setLineIndex((current) => current + 1);
        setCharIndex(0);
        return;
      }
      setCharIndex((current) => current + 1);
    }, delay);

    return () => window.clearTimeout(timer);
  }, [block.lines, blockIndex, charIndex, lineIndex, reducedMotion, visible]);

  function handleMouseMove(event: MouseEvent<HTMLDivElement>) {
    if (reducedMotion || window.matchMedia("(pointer: coarse)").matches) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - bounds.left) / bounds.width - 0.5;
    event.currentTarget.style.setProperty("--terminal-offset", `${Math.round(ratio * 16)}px`);
    event.currentTarget.style.setProperty("--terminal-rotation", `${(ratio * 5).toFixed(2)}deg`);
  }

  function handleMouseLeave(event: MouseEvent<HTMLDivElement>) {
    event.currentTarget.style.setProperty("--terminal-offset", "0px");
    event.currentTarget.style.setProperty("--terminal-rotation", "0deg");
  }

  return (
    <div
      className="landing-terminal relative overflow-hidden rounded-lg border border-[#FFD500]/28 bg-[#050505] text-left shadow-[0_18px_54px_rgba(0,0,0,0.58)]"
      onMouseLeave={handleMouseLeave}
      onMouseMove={handleMouseMove}
      ref={containerRef}
      style={{ "--terminal-offset": "0px", "--terminal-rotation": "0deg" } as CSSProperties}
    >
      <div className="relative flex items-center gap-3 border-b border-[#FFD500]/18 bg-[#080808] px-4 py-3">
        <div className="flex shrink-0 items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-[#FFD900]" />
          <span className="h-3 w-3 rounded-full bg-[#4B4B4B]" />
          <span className="h-3 w-3 rounded-full bg-[#4B4B4B]" />
        </div>
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-zinc-400">
          <Terminal className="h-4 w-4 text-[#FFD500]" />
          <span className="truncate">nextech-terminal ~ visual-demo</span>
        </div>
      </div>

      <div className="landing-terminal__content relative">
        <div aria-label="Simulação visual segura do terminal NexTech" aria-live="off" className="min-h-[24rem] max-h-[30rem] overflow-hidden p-5 font-mono text-sm leading-7">
          <div className="mb-5 flex flex-wrap gap-2 font-sans text-[11px] font-bold uppercase tracking-[0.08em] text-zinc-400">
            <span className="rounded-md border border-[#FFD500]/20 bg-[#FFD500]/10 px-2.5 py-1 text-[#FFEA70]">{block.category}</span>
            <span className="rounded-md border border-zinc-800 bg-black/40 px-2.5 py-1">componentes v2</span>
            <span className="rounded-md border border-zinc-800 bg-black/40 px-2.5 py-1">demo segura</span>
          </div>
          <div className="min-h-[18rem]">
            {displayedLines.map((line, index) => (
              <TerminalResponseItem key={`${block.category}-${index}`} text={line} />
            ))}
            {!reducedMotion ? <span className="terminal-caret ml-1 inline-block h-4 w-2 bg-[#FFD500]" /> : null}
          </div>
        </div>
      </div>

      <div className="relative flex flex-wrap items-center justify-between gap-2 border-t border-[#FFD500]/15 bg-[#080808] px-4 py-3 text-xs text-zinc-500">
        <span>request_id: nextech-visual-demo</span>
        <span className="flex items-center gap-2 text-[#FFEA70]">
          <span className="h-2.5 w-2.5 rounded-full bg-[#FFD500]" />
          Terminal visual
        </span>
      </div>
    </div>
  );
}

function TerminalResponseItem({ text }: { text: string }) {
  const lineClass = text.startsWith(">") ? "text-[#FFEA70]" : text.includes('"') || text.includes(":") ? "text-zinc-200" : "text-zinc-400";
  return (
    <p className={`min-h-7 whitespace-pre-wrap break-words ${lineClass}`}>
      <TerminalHighlightedLine text={text} />
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

function ConnectedServersSection({ state }: { state: ServerState }) {
  const data = state.value ?? fallbackServers;

  return (
    <section aria-label="Servidores conectados" className="relative border-y border-[#FFD500]/12 bg-black/30 py-12">
      <div className="mx-auto max-w-4xl px-4 text-center">
        <h2 className="text-2xl font-black text-white sm:text-3xl">Servidores conectados à NexTech</h2>
        <p className="mt-3 text-sm leading-6 text-[#B3B3B3]">Bots ativos e servidores gerenciados através da plataforma.</p>
      </div>

      <div className="mt-8">
        {state.loading ? <ServerSkeletonMarquee /> : null}
        {!state.loading && state.error ? (
          <p className="px-4 py-10 text-center text-sm font-semibold text-zinc-400">Não foi possível carregar os servidores agora. Tentaremos novamente em breve.</p>
        ) : null}
        {!state.loading && !state.error && !data.servers.length ? (
          <p className="px-4 py-10 text-center text-sm font-semibold text-zinc-400">Nenhum servidor conectado foi encontrado no momento.</p>
        ) : null}
        {!state.loading && data.servers.length ? <ServerMarquee servers={data.servers} /> : null}
      </div>
    </section>
  );
}

function ServerSkeletonMarquee() {
  return (
    <div className="mx-auto flex max-w-6xl justify-center gap-4 overflow-hidden px-4">
      {Array.from({ length: 6 }).map((_, index) => (
        <div className="h-28 w-64 shrink-0 animate-pulse rounded-lg border border-[#FFD500]/12 bg-[#141414]" key={index} />
      ))}
    </div>
  );
}

function ServerMarquee({ servers }: { servers: PublicConnectedServer[] }) {
  const items = servers.length >= 4 ? servers : [...servers, ...servers, ...servers].slice(0, Math.max(servers.length, 4));
  const marqueeItems = [...items, ...items];

  return (
    <div className="server-marquee overflow-hidden">
      <div className="server-marquee__track flex w-max gap-4 px-4">
        {marqueeItems.map((server, index) => (
          <ServerCard key={`${server.guildId}-${index}`} server={server} />
        ))}
      </div>
    </div>
  );
}

function ServerCard({ server }: { server: PublicConnectedServer }) {
  return (
    <div className="flex w-72 shrink-0 items-center gap-4 rounded-lg border border-[#FFD500]/18 bg-[#141414] p-4 shadow-[0_0_28px_rgba(255,213,0,0.08)]">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#FFD500]/28 bg-[#080808]">
        {server.iconUrl ? <img alt="" className="h-full w-full object-cover" loading="lazy" src={server.iconUrl} /> : <Server aria-hidden="true" className="h-6 w-6 text-[#FFD500]" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-white" title={server.name}>{server.name}</p>
        <p className="mt-1 text-xs font-medium text-zinc-400">{server.memberCount.toLocaleString("pt-BR")} membros</p>
        <p className="mt-1 text-xs font-semibold text-[#FFEA70]">{server.connectedBots} {server.connectedBots === 1 ? "bot conectado" : "bots conectados"}</p>
      </div>
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${server.online ? "bg-[#FFD500]" : "bg-zinc-600"}`} title={server.online ? "Online" : "Offline"} />
    </div>
  );
}

function PowerfulFeaturesSection({ features, loading, onStart }: { features: PublicMarketingFeature[]; loading: boolean; onStart: () => void }) {
  return (
    <section id="docs" className="home-section mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
      <SectionHeading
        subtitle="Três pilares selecionados com dados públicos e fallback local para manter a landing sempre completa."
        title="Recursos Poderosos"
      />

      <div className="mt-12 grid gap-5 lg:grid-cols-3">
        {(loading ? fallbackFeatures : ensureThreeFeatures(features)).map((feature, index) => (
          <FlipFeatureCard feature={feature} index={index} key={feature.id} onStart={onStart} />
        ))}
      </div>
    </section>
  );
}

function FlipFeatureCard({ feature, index, onStart }: { feature: PublicMarketingFeature; index: number; onStart: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = iconForFeature(feature.icon);

  return (
    <Reveal className="feature-card min-h-[23rem]" delay={index * 0.08}>
      <button
        aria-expanded={expanded}
        className="feature-card__inner h-full w-full text-left"
        onClick={() => setExpanded((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setExpanded(false);
        }}
        type="button"
      >
        <div className="feature-card__front rounded-lg border border-[#FFD500]/20 bg-[#141414] p-6">
          <span className="flex h-12 w-12 items-center justify-center rounded-lg border border-[#FFD500]/30 bg-[#FFD500]/10 text-[#FFD500]">
            <Icon className="h-6 w-6" />
          </span>
          <p className="mt-5 text-sm font-semibold text-[#FFEA70]">{feature.category}</p>
          <h3 className="mt-2 text-2xl font-black text-white">{feature.title}</h3>
          <p className="mt-4 text-sm leading-6 text-[#B3B3B3]">{feature.shortDescription}</p>
          <p className="mt-8 text-xs font-bold uppercase text-zinc-500">Passe o mouse para saber mais</p>
        </div>
        <div className="feature-card__back rounded-lg border border-[#FFD500]/35 bg-[#111111] p-6">
          <p className="text-sm font-semibold text-[#FFEA70]">{feature.category}</p>
          <h3 className="mt-2 text-2xl font-black text-white">{feature.title}</h3>
          <p className="mt-4 text-sm leading-7 text-[#D7D7D7]">{feature.fullDescription}</p>
          <div className="mt-6 space-y-2 text-sm text-zinc-300">
            <p className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-[#FFD500]" /> Configuração centralizada</p>
            <p className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-[#FFD500]" /> Integração com Discord</p>
            <p className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-[#FFD500]" /> Operação em tempo real</p>
          </div>
          <span className="mt-7 inline-flex h-10 items-center justify-center rounded-lg bg-[#FFD500] px-4 text-sm font-bold text-black" onClick={(event) => { event.stopPropagation(); onStart(); }} role="button" tabIndex={-1}>
            Conhecer solução
          </span>
        </div>
      </button>
    </Reveal>
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

function buildLandingStats(metrics: LandingMetrics, data: PublicConnectedServersResponse) {
  const responseTime = metrics.responseTimeMs;
  const uptime = metrics.uptimePercent;

  return [
    { displayOverride: data.totalBots ? undefined : "ao vivo", label: "Bots Criados", prefix: "+", value: data.totalBots },
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

function normalizeServersResponse(data: PublicConnectedServersResponse): PublicConnectedServersResponse {
  return {
    generatedAt: data.generatedAt,
    servers: (data.servers ?? []).slice(0, 24).map((server) => ({
      botNames: (server.botNames ?? []).slice(0, 6).map((name) => sanitizeText(name, 80)),
      connectedBots: clampNumber(server.connectedBots, 0, 100),
      guildId: sanitizeText(server.guildId, 40),
      iconUrl: safePublicImageUrl(server.iconUrl),
      memberCount: clampNumber(server.memberCount, 0, 1_000_000),
      name: sanitizeText(server.name, 80) || "Servidor NexTech",
      online: Boolean(server.online)
    })),
    totalBots: clampNumber(data.totalBots, 0, 1000),
    totalUniqueServers: clampNumber(data.totalUniqueServers, 0, 1000)
  };
}

function ensureThreeFeatures(features: PublicMarketingFeature[]) {
  const normalized = features.slice(0, 3).map((feature) => ({
    category: sanitizeText(feature.category, 40),
    fullDescription: sanitizeText(feature.fullDescription, 280),
    icon: sanitizeText(feature.icon, 32),
    id: sanitizeText(feature.id, 64),
    shortDescription: sanitizeText(feature.shortDescription, 140),
    title: sanitizeText(feature.title, 70)
  }));
  const byId = new Map(normalized.map((feature) => [feature.id, feature]));
  for (const fallback of fallbackFeatures) {
    if (byId.size >= 3) break;
    byId.set(fallback.id, fallback);
  }
  return [...byId.values()].slice(0, 3);
}

function iconForFeature(icon: string) {
  const icons = {
    bot: Bot,
    gauge: Gauge,
    headphones: Headphones,
    monitor: MonitorCog,
    shield: ShieldCheck
  };
  return icons[icon as keyof typeof icons] ?? Layers3;
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const handleChange = () => setReduced(query.matches);
    query.addEventListener?.("change", handleChange);
    return () => query.removeEventListener?.("change", handleChange);
  }, []);

  return reduced;
}

function sanitizeText(value: string | null | undefined, maxLength: number) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function safePublicImageUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.hostname === "cdn.discordapp.com" || url.hostname === "media.discordapp.net" ? url.toString() : null;
  } catch {
    return null;
  }
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? Math.round(value) : min));
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

function Footer({ currentYear, onNavigate }: { currentYear: number; onNavigate: (id: string) => void }) {
  return (
    <footer className="border-t border-[#FFD500]/15 bg-[#050505] px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-4">
        <div>
          <button className="text-2xl font-black text-[#FFD500]" onClick={() => onNavigate("inicio")} type="button">Nex Tech</button>
          <p className="mt-3 text-sm text-zinc-400">Desde {currentYear}</p>
          <p className="mt-3 text-sm leading-6 text-[#B3B3B3]">Plataforma para criação, controle e gerenciamento de bots conectados ao Discord.</p>
        </div>
        <FooterColumn title="Navegação" links={[["Início", "inicio"], ["Soluções", "solucoes"], ["Status", "status"], ["Termos", "termos"], ["Documentação", "docs"], ["Dashboard", "inicio"]]} onNavigate={onNavigate} />
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

function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return <div className={className} style={delay ? { transitionDelay: `${delay * 1000}ms` } : undefined}>{children}</div>;
}
