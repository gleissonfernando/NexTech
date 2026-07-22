import { motion, useReducedMotion } from "framer-motion";
import {
  Activity,
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
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button } from "../components/ui/button";
import { fetchPublicStatus, type PublicStatusSnapshot } from "../lib/publicStatus";
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

const reveal = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0 }
};

type TerminalResponseLine = {
  text: string;
  tone?: "status";
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
    command: "$ POST /api/v1/bots/create",
    response: [
      { text: "{" },
      { text: '  "name": "Nex Tech Manager",' },
      { text: '  "modules": ["moderation", "logs", "tickets"]' },
      { text: "}" },
      { text: "201 Created", tone: "status" },
      { text: 'bot_id: "orv_94A7"' },
      { text: 'status: "online"' },
      { text: 'dashboard_link: "/dashboard/nex-tech-manager"' }
    ]
  }
];

const TYPEWRITER_DELAY_MS = 28;
const RESPONSE_REVEAL_DELAY_MS = 190;
const RESPONSE_START_DELAY_MS = 220;
const TERMINAL_HOLD_MS = 3400;

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

const stats = [
  { label: "Bots Criados", prefix: "+", suffix: "K", value: 600 },
  { label: "Uptime", suffix: "%", value: 99 },
  { label: "Tempo de Resposta", prefix: "<", suffix: "ms", value: 500 },
  { label: "Suporte", suffix: "/7", value: 24 }
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
  const currentYear = new Date().getFullYear();
  const verificationPending = Boolean(auth && !auth.access.verified);
  const startLabel = verifying ? "Verificando..." : verificationPending ? "Verificar acesso" : "Entrar na Dashboard";

  useEffect(() => {
    let active = true;
    fetch("/api/health/servers", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Falha ao carregar servidores")))
      .then((data: { servers?: PublicServer[] }) => {
        if (active) setPublicServers(data.servers ?? []);
      })
      .catch(() => undefined);
    return () => { active = false; };
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
    <main className="min-h-screen overflow-hidden bg-[#0A0A0A] text-white">
      <div className="fixed inset-0 -z-10 bg-[#0A0A0A]" />
      <div className="fixed inset-0 -z-10 bg-[linear-gradient(rgba(255,213,0,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,213,0,0.035)_1px,transparent_1px)] bg-[size:44px_44px]" />
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(circle_at_top,rgba(255,213,0,0.16),transparent_32rem)]" />

      <Header entering={verifying} onStart={handleStart} onNavigate={scrollTo} />

      <section id="inicio" className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col items-center justify-center px-4 pb-16 pt-32 text-center sm:px-6 lg:px-8">
        <Reveal delay={0.1} className="inline-flex items-center rounded-full border border-[#FFD500]/25 bg-[#FFD500]/10 px-4 py-2 text-sm font-medium text-[#FFEA70] shadow-[0_0_24px_rgba(255,213,0,0.16)]">
          A plataforma #1 de automação para Discord
        </Reveal>

        <Reveal delay={0.2} className="mt-8 max-w-5xl">
          <h1 className="text-5xl font-black leading-tight text-white sm:text-6xl lg:text-7xl">
            Automatize seu servidor{" "}
            <span className="inline-block text-[#FFD500] drop-shadow-[0_0_28px_rgba(255,213,0,0.45)]">
              do seu jeito
            </span>
          </h1>
        </Reveal>

        <Reveal delay={0.3} className="max-w-5xl">
          <p className="mx-auto mt-6 max-w-2xl text-base leading-8 text-[#B3B3B3] sm:text-lg">
            {verificationPending
              ? "Confirme a segunda etapa de autenticação para liberar a dashboard deste usuário."
              : "Entre pela Dashboard com OAuth2 do Discord, configure seus bots e controle módulos, permissões, canais e logs em tempo real."}
          </p>
        </Reveal>

        <Reveal delay={0.4} className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button className="h-12 min-w-44" disabled={verifying} onClick={handleStart}>
            {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            {startLabel}
          </Button>
          <Button className="h-12 min-w-44" onClick={() => scrollTo("solucoes")} variant="outline">
            Ver Soluções
          </Button>
          <Button className="h-12 min-w-44" onClick={() => scrollTo("planos")} variant="outline">
            Ver Planos
          </Button>
          <Button asChild className="h-12 min-w-44" variant="outline">
            <a href="/status">
              <Activity className="h-4 w-4" />
              Ver Status
            </a>
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

        <Reveal delay={0.5} className="mt-12 w-full max-w-3xl">
          <TerminalMockup />
        </Reveal>
      </section>

      <PublicServerMarquee servers={publicServers} />

      <PublicStatusPreview />

      <section id="solucoes" className="mx-auto w-full max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
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

      <section id="docs" className="mx-auto w-full max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <SectionHeading
          subtitle="Ferramentas para criar, operar e escalar bots com menos trabalho manual."
          title="Recursos Poderosos"
        />

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {resources.map((resource, index) => (
            <Reveal
              className="rounded-lg border border-[#FFD500]/20 bg-[#141414]/90 p-5 transition duration-300 hover:-translate-y-1 hover:border-[#FFD500]/50 hover:shadow-[0_0_32px_rgba(255,213,0,0.13)]"
              delay={index * 0.035}
              key={resource.title}
            >
              <resource.icon className="h-6 w-6 text-[#FFD500]" />
              <h3 className="mt-5 text-base font-bold text-white">{resource.title}</h3>
              <p className="mt-3 text-sm leading-6 text-[#B3B3B3]">{resource.description}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section id="como-funciona" className="mx-auto w-full max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <SectionHeading
          subtitle="Em 3 passos simples você já está com tudo funcionando."
          title="Como Funciona"
        />

        <div className="relative mx-auto mt-14 max-w-5xl">
          <div className="absolute left-[16.666%] right-[16.666%] top-8 hidden h-px bg-gradient-to-r from-[#FFD500]/20 via-[#FFD500]/70 to-[#FFD500]/20 lg:block" />
          <div className="grid gap-12 lg:grid-cols-3 lg:gap-8">
            {steps.map((step, index) => (
              <Reveal className="relative flex flex-col items-center text-center" delay={index * 0.08} key={step.title}>
                <div className="relative z-10 flex h-16 w-16 items-center justify-center rounded-2xl border border-[#FFD500]/40 bg-[#111108] text-[#FFD500] shadow-[0_0_26px_rgba(255,213,0,0.12)]">
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

      <section id="suporte" className="px-4 py-24 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-5xl rounded-lg border border-[#FFD500]/25 bg-[#141414]/95 px-6 py-12 text-center shadow-glow sm:px-10">
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
  const reducedMotion = useReducedMotion();

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
    <motion.header
      animate={{ opacity: 1, y: 0 }}
      className={`fixed left-0 right-0 top-0 z-50 border-b px-4 transition duration-300 sm:px-6 lg:px-8 ${scrolled ? "border-[#FFD500]/20 bg-[#0A0A0A]/88 py-3 shadow-[0_16px_60px_rgba(0,0,0,0.42)] backdrop-blur-xl" : "border-transparent bg-[#0A0A0A]/65 py-4 backdrop-blur-md"}`}
      initial={reducedMotion ? false : { opacity: 0, y: -18 }}
      transition={{ duration: 0.48, ease: "easeOut" }}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
        <button className="flex items-center gap-2 text-left" onClick={() => onNavigate("inicio")} type="button">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#FFD500]/30 bg-[#FFD500]/10 text-[#FFD500] shadow-[0_0_22px_rgba(255,213,0,0.18)]">
            <Bot className="h-5 w-5" />
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
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto mt-3 grid max-w-7xl gap-2 rounded-lg border border-[#FFD500]/20 bg-[#0A0A0A]/95 p-3 shadow-[0_18px_70px_rgba(0,0,0,0.55)] backdrop-blur-xl md:hidden"
          initial={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
        >
          {nav.map(([label, id]) => (
            <button className="rounded-lg px-3 py-3 text-left text-sm font-semibold text-zinc-200 transition hover:bg-[#FFD500]/10 hover:text-[#FFEA70]" key={`mobile-${id}`} onClick={() => { setMenuOpen(false); onNavigate(id); }} type="button">
              {label}
            </button>
          ))}
          <Button className="h-11 w-full" disabled={entering} onClick={() => { setMenuOpen(false); onStart(); }}>
            {entering ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {entering ? "Entrando..." : "Dashboard"}
          </Button>
        </motion.div>
      ) : null}
    </motion.header>
  );
}

function SectionHeading({ badge, subtitle, title }: { badge?: string; subtitle: string; title: string }) {
  return (
    <Reveal className="mx-auto max-w-3xl text-center">
      {badge ? <p className="mx-auto mb-4 inline-flex rounded-full border border-[#FFD500]/25 bg-[#FFD500]/10 px-4 py-2 text-sm font-medium text-[#FFEA70]">{badge}</p> : null}
      <h2 className="text-4xl font-black text-white sm:text-5xl">{title}</h2>
      <p className="mx-auto mt-4 max-w-2xl text-base leading-8 text-[#B3B3B3]">{subtitle}</p>
    </Reveal>
  );
}

function TerminalMockup() {
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = useReducedMotion();
  const [sequenceIndex, setSequenceIndex] = useState(0);
  const [typedCommand, setTypedCommand] = useState("");
  const [visibleResponseCount, setVisibleResponseCount] = useState(0);
  const [typing, setTyping] = useState(true);
  const sequence = terminalSequences[sequenceIndex] ?? terminalSequences[0];

  useEffect(() => {
    const timers: number[] = [];
    let cancelled = false;

    const schedule = (callback: () => void, delay: number) => {
      const timer = window.setTimeout(() => {
        if (!cancelled) callback();
      }, delay);
      timers.push(timer);
    };

    setTypedCommand("");
    setVisibleResponseCount(0);
    setTyping(true);

    for (let index = 1; index <= sequence.command.length; index += 1) {
      schedule(() => setTypedCommand(sequence.command.slice(0, index)), index * TYPEWRITER_DELAY_MS);
    }

    const typingCompleteAt = sequence.command.length * TYPEWRITER_DELAY_MS + 240;
    const responseStartAt = typingCompleteAt + RESPONSE_START_DELAY_MS;
    schedule(() => setTyping(false), typingCompleteAt);

    sequence.response.forEach((_, index) => {
      schedule(() => setVisibleResponseCount(index + 1), responseStartAt + index * RESPONSE_REVEAL_DELAY_MS);
    });

    const restartAt = responseStartAt + sequence.response.length * RESPONSE_REVEAL_DELAY_MS + TERMINAL_HOLD_MS;
    schedule(() => {
      setTypedCommand("");
      setVisibleResponseCount(0);
      setSequenceIndex((current) => (current + 1) % terminalSequences.length);
    }, restartAt);

    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [sequence.command, sequence.response.length]);

  const visibleResponse = sequence.response.slice(0, visibleResponseCount);

  function handleTerminalPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (reducedMotion || event.pointerType !== "mouse") return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    const bounds = terminal.getBoundingClientRect();
    const horizontal = (event.clientX - bounds.left) / bounds.width - 0.5;
    const vertical = (event.clientY - bounds.top) / bounds.height - 0.5;
    terminal.style.transform = `perspective(1000px) rotateX(${-vertical * 8}deg) rotateY(${horizontal * 12}deg) scale3d(1.012, 1.012, 1.012)`;
  }

  function resetTerminalTilt() {
    const terminal = terminalRef.current;
    if (terminal) terminal.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)";
  }

  return (
    <div
      className="transform-gpu overflow-hidden rounded-lg border border-[#FFD500]/25 bg-[#0b0b0b] text-left shadow-[0_28px_90px_rgba(0,0,0,0.7),0_0_40px_8px_rgba(255,213,0,0.15)] transition-transform duration-200 ease-out"
      onPointerCancel={resetTerminalTilt}
      onPointerLeave={resetTerminalTilt}
      onPointerMove={handleTerminalPointerMove}
      ref={terminalRef}
    >
      <div className="flex items-center gap-3 border-b border-[#FFD500]/15 bg-[#141414] px-4 py-3">
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
      <div aria-label="Demonstração animada do terminal Nex Tech" aria-live="off" className="min-h-[21rem] p-5 font-mono text-sm leading-7">
        <TerminalCommandLine command={typedCommand} typing={typing} />
        {visibleResponse.map((line, index) => (
          <TerminalResponseItem key={`${sequenceIndex}-${line.text}-${index}`} line={line} />
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-[#FFD500]/15 px-4 py-3 text-xs text-zinc-400">
        <span>request_id: nex-tech-live-demo</span>
        <span className="flex items-center gap-2 text-[#3DDC84]">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#3DDC84]" />
          Online
        </span>
      </div>
    </div>
  );
}

function TerminalCommandLine({ command, typing }: { command: string; typing: boolean }) {
  const hasPrompt = command.startsWith("$");

  return (
    <p className="flex min-h-7 min-w-0 items-center whitespace-pre-wrap text-zinc-100">
      {hasPrompt ? <span className="text-[#FFD900]">$</span> : null}
      <span>{hasPrompt ? command.slice(1) : command}</span>
      {typing ? <span aria-hidden="true" className="terminal-cursor" /> : null}
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
      className={`relative flex min-h-[25rem] flex-col rounded-lg border bg-[#141414]/95 p-6 transition duration-300 hover:-translate-y-1 hover:border-[#FFD500]/55 hover:shadow-[0_0_34px_rgba(255,213,0,0.14)] ${solution.popular ? "border-[#FFD500]/50 shadow-glow lg:-translate-y-3" : "border-[#FFD500]/20"}`}
      delay={index * 0.08}
    >
      {solution.popular ? (
        <span className="absolute right-4 top-4 rounded-full border border-[#FFD500]/35 bg-[#FFD500] px-3 py-1 text-xs font-black text-black shadow-[0_0_24px_rgba(255,213,0,0.32)]">
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

function StatCounter({ delay = 0, label, prefix = "", suffix = "", value }: { delay?: number; label: string; prefix?: string; suffix?: string; value: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [displayValue, setDisplayValue] = useState(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setVisible(true);
        observer.disconnect();
      }
    }, { threshold: 0.4 });

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;

    if (reducedMotion) {
      setDisplayValue(value);
      return;
    }

    const duration = 1400;
    let start = 0;
    let animation = 0;
    let delayTimer = 0;

    const tick = (now: number) => {
      if (!start) start = now;
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(Math.round(value * eased));
      if (progress < 1) {
        animation = requestAnimationFrame(tick);
      }
    };

    delayTimer = window.setTimeout(() => {
      animation = requestAnimationFrame(tick);
    }, delay);

    return () => {
      window.clearTimeout(delayTimer);
      cancelAnimationFrame(animation);
    };
  }, [delay, reducedMotion, value, visible]);

  return (
    <div ref={ref} className="text-center">
      <p className="text-4xl font-black tracking-tight text-[#FFD500] drop-shadow-[0_0_12px_rgba(255,213,0,0.45)] sm:text-5xl">{prefix}{displayValue}{suffix}</p>
      <p className="mt-2 text-sm text-[#B3B3B3]">{label}</p>
    </div>
  );
}

function PublicStatusPreview() {
  const [snapshot, setSnapshot] = useState<PublicStatusSnapshot | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetchPublicStatus(controller.signal)
      .then((data) => {
        setSnapshot(data);
        setFailed(false);
      })
      .catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setFailed(true);
        }
      });
    return () => controller.abort();
  }, []);

  const services = snapshot?.categories.flatMap((category) => category.services) ?? [];
  const visibleServices = services.slice(0, 6);
  const operationalCount = services.filter((service) => service.currentStatus === "operational").length;
  const statusTone = snapshot?.globalStatus === "major_outage"
    ? "border-red-500/35 bg-red-500/10 text-red-200"
    : snapshot?.globalStatus === "degraded"
      ? "border-amber-500/35 bg-amber-500/10 text-amber-200"
      : "border-emerald-500/35 bg-emerald-500/10 text-emerald-200";

  return (
    <section id="status" className="mx-auto w-full max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
      <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <Reveal>
          <p className="inline-flex items-center gap-2 rounded-full border border-[#FFD500]/25 bg-[#FFD500]/10 px-4 py-2 text-sm font-medium text-[#FFEA70]">
            <Activity className="h-4 w-4" />
            Monitoramento público
          </p>
          <h2 className="mt-6 text-4xl font-black text-white sm:text-5xl">Status da plataforma</h2>
          <p className="mt-5 max-w-xl text-base leading-8 text-[#B3B3B3]">
            Acompanhe a disponibilidade da NextTech com dados tratados, sem expor APIs privadas, tokens, hosts internos ou detalhes sensíveis da infraestrutura.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Button asChild className="h-12 min-w-44">
              <a href="/status">
                <Activity className="h-4 w-4" />
                Ver Status
              </a>
            </Button>
          </div>
        </Reveal>

        <Reveal delay={0.12} className="rounded-lg border border-[#FFD500]/20 bg-[#101010]/95 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
          <div className="flex flex-col gap-4 border-b border-[#FFD500]/10 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[.18em] text-[#FFD500]">NextTech Status</p>
              <h3 className="mt-2 text-2xl font-black text-white">{snapshot?.globalMessage ?? (failed ? "Status indisponível" : "Carregando status")}</h3>
            </div>
            <span className={`w-fit rounded-full border px-3 py-1.5 text-xs font-black ${statusTone}`}>
              {snapshot ? `${operationalCount}/${services.length} online` : failed ? "falha" : "sincronizando"}
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {visibleServices.length ? visibleServices.map((service) => (
              <div className="grid gap-3 rounded-lg border border-white/5 bg-black/25 p-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] sm:items-center" key={service.id}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-white" title={service.name}>{service.name}</p>
                  <p className="mt-1 text-xs text-zinc-500">{serviceStatusLabel(service.currentStatus)}</p>
                </div>
                <div className="grid grid-cols-[repeat(30,minmax(0,1fr))] gap-1">
                  {service.history.slice(-30).map((item) => (
                    <span className={`h-6 rounded-sm ${previewHistoryClass(item.status)}`} key={`${service.id}-${item.startedAt}`} title={`${serviceStatusLabel(service.currentStatus)} - ${item.averageResponseTimeMs ?? "sem"} ms`} />
                  ))}
                </div>
              </div>
            )) : (
              <div className="rounded-lg border border-zinc-800 bg-black/25 p-6 text-sm font-medium text-zinc-300">
                {failed ? "Não foi possível carregar o resumo agora." : "Buscando dados públicos de disponibilidade."}
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500">
            <span>{snapshot ? `Atualizado às ${new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(snapshot.generatedAt))}` : "Aguardando primeira leitura"}</span>
            <span>{snapshot?.historyWindow.label ?? "Últimos 60 minutos"}</span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function serviceStatusLabel(status: PublicStatusSnapshot["categories"][number]["services"][number]["currentStatus"]) {
  if (status === "operational") return "Operacional";
  if (status === "degraded") return "Desempenho degradado";
  if (status === "maintenance") return "Em manutenção";
  if (status === "unknown") return "Sem informações";
  return "Indisponível";
}

function previewHistoryClass(status: PublicStatusSnapshot["categories"][number]["services"][number]["history"][number]["status"]) {
  if (status === "operational") return "bg-emerald-400";
  if (status === "degraded") return "bg-amber-400";
  if (status === "maintenance") return "bg-sky-400";
  if (status === "down") return "bg-red-500";
  return "bg-zinc-700";
}

function PublicServerMarquee({ servers }: { servers: PublicServer[] }) {
  if (!servers.length) return null;
  const items = Array.from({ length: Math.max(1, Math.ceil(8 / servers.length)) }, () => servers).flat();

  return (
    <section aria-label="Bots cadastrados" className="relative overflow-hidden border-y border-[#FFD500]/15 bg-black/35 py-8">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-20 bg-gradient-to-r from-[#0A0A0A] to-transparent sm:w-36" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-20 bg-gradient-to-l from-[#0A0A0A] to-transparent sm:w-36" />
      <p className="mb-6 text-center text-[11px] font-bold uppercase tracking-[.22em] text-[#FFD500]">
        {servers.length} {servers.length === 1 ? "bot cadastrado" : "bots cadastrados na Nex Tech"}
      </p>
      <div className="server-marquee-track flex w-max hover:[animation-play-state:paused]">
        <PublicServerGroup servers={items} />
        <PublicServerGroup ariaHidden servers={items} />
      </div>
    </section>
  );
}

function PublicServerGroup({ ariaHidden = false, servers }: { ariaHidden?: boolean; servers: PublicServer[] }) {
  return (
    <div aria-hidden={ariaHidden || undefined} className="flex shrink-0 items-center gap-12 pr-12 sm:gap-16 sm:pr-16">
      {servers.map((server, index) => (
        <div className="flex w-36 shrink-0 flex-col items-center text-center" key={`${server.botId ?? server.id}-${index}`}>
          <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border border-[#FFD500]/35 bg-[#141414] shadow-[0_0_22px_rgba(255,213,0,.12)]">
            {server.iconUrl ? <img alt="" className="h-full w-full object-cover" loading="lazy" src={server.iconUrl} /> : <Server aria-hidden="true" className="h-6 w-6 text-[#FFD500]" />}
          </div>
          <p className="mt-3 w-full truncate text-sm font-semibold text-zinc-200" title={server.botName ?? server.name}>{server.botName ?? server.name}</p>
          <p className="mt-1 w-full truncate text-xs font-medium text-[#FFD500]" title={server.name}>{server.name}</p>
          <p className="mt-1 text-[11px] font-medium text-zinc-400">{server.memberCount.toLocaleString("pt-BR")} membros</p>
        </div>
      ))}
    </div>
  );
}

function Footer({ currentYear, onNavigate }: { currentYear: number; onNavigate: (id: string) => void }) {
  const reducedMotion = useReducedMotion();

  return (
    <motion.footer
      className="border-t border-[#FFD500]/15 bg-[#050505] px-4 py-12 sm:px-6 lg:px-8"
      initial={reducedMotion ? false : { opacity: 0, y: 20 }}
      transition={{ duration: 0.55, ease: "easeOut" }}
      viewport={{ once: true, amount: 0.15 }}
      whileInView={reducedMotion ? undefined : { opacity: 1, y: 0 }}
    >
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
    </motion.footer>
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
  const reducedMotion = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={reducedMotion ? false : "hidden"}
      transition={{ delay: reducedMotion ? 0 : delay, duration: 0.55, ease: "easeOut" }}
      variants={reducedMotion ? undefined : reveal}
      viewport={{ once: true, amount: 0.18 }}
      whileInView={reducedMotion ? undefined : "visible"}
    >
      {children}
    </motion.div>
  );
}
