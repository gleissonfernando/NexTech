import { motion, useScroll, useTransform } from "framer-motion";
import {
  Bot,
  Check,
  CheckCircle2,
  Code2,
  Gauge,
  Headphones,
  KeyRound,
  Link2,
  Lock,
  LogIn,
  Menu,
  MonitorCog,
  Network,
  PanelTop,
  PlugZap,
  Rocket,
  Settings2,
  ShieldCheck,
  Terminal,
  Wrench,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "../components/ui/avatar";
import { Button } from "../components/ui/button";
import type { AccessValidationResult, AuthResponse } from "../types";
import type { AuthStatus } from "../hooks/useAuth";

const ACCESS_DENIED_MESSAGE = "Você não está liberado para acessar esta dashboard.";
const SUPPORT_URL = "https://discord.gg/2jCEx3XwMh";

type LoginProps = {
  accessValidation: AccessValidationResult | null;
  auth: AuthResponse | null;
  checkingAccess: boolean;
  error: string | null;
  onLoginDiscord: () => void;
  onLogout: () => void;
  onRetry: () => void;
  onVerify: () => void;
  status: AuthStatus;
  verifying: boolean;
};

const reveal = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0 }
};

const terminalLines = [
  "GET /auth/discord/dashboard",
  "302 Discord OAuth2",
  "GET /dashboard/session",
  "{",
  '  "user": "discord:authorized",',
  '  "access": "verified",',
  '  "modules": ["logs", "tickets", "courses"]',
  "}",
  'dashboard: "online"',
  'redirect: "/dashboard"'
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
  accessValidation,
  auth,
  checkingAccess,
  error,
  onLoginDiscord,
  onLogout,
  onRetry,
  onVerify,
  status,
  verifying
}: LoginProps) {
  const stepsRef = useRef<HTMLElement | null>(null);
  const { scrollYProgress } = useScroll({ target: stepsRef, offset: ["start 80%", "end 45%"] });
  const progressWidth = useTransform(scrollYProgress, [0, 1], ["0%", "100%"]);
  const currentYear = new Date().getFullYear();
  const startLabel = auth ? (verifying ? "Verificando..." : "Verificar Dashboard") : "Entrar na Dashboard";

  function handleStart() {
    if (auth) {
      onVerify();
      return;
    }

    onLoginDiscord();
  }

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#0A0A0A] text-white">
      <div className="fixed inset-0 -z-10 bg-[#0A0A0A]" />
      <div className="fixed inset-0 -z-10 bg-[linear-gradient(rgba(255,213,0,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,213,0,0.035)_1px,transparent_1px)] bg-[size:44px_44px]" />
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(circle_at_top,rgba(255,213,0,0.16),transparent_32rem)]" />

      <Header onStart={handleStart} onNavigate={scrollTo} />

      <section id="inicio" className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col items-center justify-center px-4 pb-16 pt-32 text-center sm:px-6 lg:px-8">
        <Reveal className="inline-flex items-center rounded-full border border-[#FFD500]/25 bg-[#FFD500]/10 px-4 py-2 text-sm font-medium text-[#FFEA70] shadow-[0_0_24px_rgba(255,213,0,0.16)]">
          A plataforma #1 de automação para Discord
        </Reveal>

        <Reveal delay={0.08} className="mt-8 max-w-5xl">
          <h1 className="text-5xl font-black leading-tight text-white sm:text-6xl lg:text-7xl">
            Automatize seu servidor{" "}
            <span className="inline-block animate-pulse-glow rounded-lg px-2 text-[#FFD500] drop-shadow-[0_0_28px_rgba(255,213,0,0.45)]">
              do seu jeito
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-8 text-[#B3B3B3] sm:text-lg">
            Entre pela Dashboard com OAuth2 do Discord, configure seus bots e controle módulos, permissões, canais e logs em tempo real.
          </p>
        </Reveal>

        <Reveal delay={0.16} className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button className="h-12 min-w-44" disabled={verifying} onClick={handleStart}>
            <LogIn className="h-4 w-4" />
            {startLabel}
          </Button>
          <Button className="h-12 min-w-44" onClick={() => scrollTo("solucoes")} variant="outline">
            Ver Soluções
          </Button>
        </Reveal>

        {auth || error ? (
          <AuthStatusPanel
            accessValidation={accessValidation}
            auth={auth}
            checkingAccess={checkingAccess}
            error={error}
            onLoginDiscord={onLoginDiscord}
            onLogout={onLogout}
            onRetry={onRetry}
            onVerify={onVerify}
            status={status}
            verifying={verifying}
          />
        ) : null}

        <Reveal delay={0.24} className="mt-12 w-full max-w-3xl">
          <TerminalMockup />
        </Reveal>
      </section>

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

        <Reveal className="mt-10 grid gap-3 rounded-lg border border-[#FFD500]/20 bg-[#141414]/90 p-4 shadow-glow sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <StatCounter key={stat.label} {...stat} />
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

      <section id="como-funciona" ref={stepsRef} className="mx-auto w-full max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <SectionHeading
          subtitle="Em 3 passos simples você já está com tudo funcionando."
          title="Como Funciona"
        />

        <div className="relative mt-14">
          <div className="absolute left-0 right-0 top-9 hidden border-t border-dashed border-[#FFD500]/20 lg:block" />
          <motion.div className="absolute left-0 top-9 hidden border-t-2 border-[#FFD500] lg:block" style={{ width: progressWidth }} />
          <div className="grid gap-5 lg:grid-cols-3">
            {steps.map((step, index) => (
              <Reveal className="relative rounded-lg border border-[#FFD500]/20 bg-[#141414]/95 p-6 text-center shadow-[0_18px_50px_rgba(0,0,0,0.35)]" delay={index * 0.08} key={step.title}>
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-lg border border-[#FFD500]/35 bg-black text-[#FFD500] shadow-[0_0_22px_rgba(255,213,0,0.12)]">
                  <step.icon className="h-7 w-7" />
                </div>
                <p className="mt-5 font-mono text-sm font-bold text-[#FFD500]">0{index + 1}</p>
                <h3 className="mt-2 text-xl font-bold text-white">{step.title}</h3>
                <p className="mt-3 text-sm leading-6 text-[#B3B3B3]">{step.description}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section id="suporte" className="px-4 py-24 sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-5xl rounded-lg border border-[#FFD500]/25 bg-[#141414]/95 px-6 py-12 text-center shadow-glow sm:px-10">
          <h2 className="text-4xl font-black text-white sm:text-5xl">Pronto para automatizar seus bots?</h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-[#B3B3B3]">
            Entre com Discord, valide seu acesso e comece a controlar seus bots pelo Orvitek.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button className="h-12 min-w-44" disabled={verifying} onClick={handleStart}>
              <Rocket className="h-4 w-4" />
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

function Header({ onNavigate, onStart }: { onNavigate: (id: string) => void; onStart: () => void }) {
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
    ["Docs", "docs"],
    ["Suporte", "suporte"]
  ] as const;

  return (
    <header className={`fixed left-0 right-0 top-0 z-50 border-b px-4 transition duration-300 sm:px-6 lg:px-8 ${scrolled ? "border-[#FFD500]/20 bg-[#0A0A0A]/88 py-3 shadow-[0_16px_60px_rgba(0,0,0,0.42)] backdrop-blur-xl" : "border-transparent bg-[#0A0A0A]/65 py-4 backdrop-blur-md"}`}>
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
        <button className="flex items-center gap-2 text-left" onClick={() => onNavigate("inicio")} type="button">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#FFD500]/30 bg-[#FFD500]/10 text-[#FFD500] shadow-[0_0_22px_rgba(255,213,0,0.18)]">
            <Bot className="h-5 w-5" />
          </span>
          <span className="text-xl font-black text-[#FFD500] drop-shadow-[0_0_18px_rgba(255,213,0,0.28)]">Orvitek</span>
        </button>

        <nav className="hidden items-center gap-1 rounded-full border border-[#FFD500]/15 bg-black/35 p-1 md:flex">
          {nav.map(([label, id]) => (
            <button className="rounded-full px-4 py-2 text-sm font-medium text-zinc-300 transition hover:bg-[#FFD500]/10 hover:text-[#FFEA70]" key={id} onClick={() => { setMenuOpen(false); onNavigate(id); }} type="button">
              {label}
            </button>
          ))}
        </nav>

        <Button className="hidden h-10 px-4 sm:inline-flex" onClick={onStart}>
          Dashboard
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
          <Button className="h-11 w-full" onClick={() => { setMenuOpen(false); onStart(); }}>
            Dashboard
          </Button>
        </motion.div>
      ) : null}
    </header>
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
  return (
    <div className="overflow-hidden rounded-lg border border-[#FFD500]/25 bg-[#0b0b0b] text-left shadow-[0_28px_90px_rgba(0,0,0,0.7),0_0_44px_rgba(255,213,0,0.12)]">
      <div className="flex items-center justify-between border-b border-[#FFD500]/15 bg-[#141414] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-red-400" />
          <span className="h-3 w-3 rounded-full bg-[#FFD500]" />
          <span className="h-3 w-3 rounded-full bg-[#3DDC84]" />
        </div>
        <div className="flex items-center gap-2 text-xs font-medium text-zinc-400">
          <Terminal className="h-4 w-4 text-[#FFD500]" />
          orvitek-cli
        </div>
      </div>
      <div className="min-h-[21rem] p-5 font-mono text-sm leading-7">
        {terminalLines.map((line, index) => (
          <p
            className={`terminal-line ${line.includes("201 Created") || line.includes("online") ? "text-[#3DDC84]" : line.includes("token") ? "text-[#FFEA70]" : "text-zinc-300"}`}
            key={`${line}-${index}`}
            style={{ animationDelay: `${index * 0.52}s` }}
          >
            <span className="mr-2 text-[#FFD500]">$</span>
            {line}
          </p>
        ))}
      </div>
      <div className="flex items-center justify-between border-t border-[#FFD500]/15 px-4 py-3 text-xs text-zinc-400">
        <span>request_id: orvitek-live-demo</span>
        <span className="flex items-center gap-2 text-[#3DDC84]">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#3DDC84]" />
          Online
        </span>
      </div>
    </div>
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

function StatCounter({ label, prefix = "", suffix = "", value }: { label: string; prefix?: string; suffix?: string; value: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [displayValue, setDisplayValue] = useState(0);

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

    const duration = 900;
    const start = performance.now();
    let animation = 0;

    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      setDisplayValue(Math.round(value * progress));
      if (progress < 1) {
        animation = requestAnimationFrame(tick);
      }
    };

    animation = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animation);
  }, [value, visible]);

  return (
    <div ref={ref} className="rounded-lg border border-[#FFD500]/15 bg-black/35 p-5 text-center">
      <p className="text-3xl font-black text-[#FFD500]">{prefix}{displayValue}{suffix}</p>
      <p className="mt-2 text-sm text-[#B3B3B3]">{label}</p>
    </div>
  );
}

function AuthStatusPanel({
  accessValidation,
  auth,
  checkingAccess,
  error,
  onLoginDiscord,
  onLogout,
  onRetry,
  onVerify,
  status,
  verifying
}: LoginProps) {
  const rejectionReasons = useMemo(() => accessValidation?.rejectionReasons ?? [], [accessValidation]);

  return (
    <Reveal className="mt-8 w-full max-w-2xl rounded-lg border border-[#FFD500]/20 bg-[#141414]/92 p-4 text-left shadow-[0_18px_60px_rgba(0,0,0,0.4)]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#FFEA70]">{error ? "Atenção no acesso" : status}</p>
          <p className="mt-1 text-sm text-[#B3B3B3]">
            {checkingAccess ? "Checando se seu usuário pode acessar o site..." : auth ? "Sessão Discord detectada. Confirme para entrar no dashboard." : "Use Discord para continuar."}
          </p>
        </div>
        {auth ? (
          <div className="flex min-w-0 items-center gap-3">
            <Avatar className="h-11 w-11 rounded-lg border border-[#FFD500]/30" fallback={auth.user.username} src={auth.user.avatarUrl ?? auth.user.avatar} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{auth.user.username}</p>
              <p className="truncate text-xs text-zinc-500">{auth.user.tag}</p>
            </div>
          </div>
        ) : null}
      </div>

      {error ? <p className="mt-4 rounded-lg border border-[#FFD500]/15 bg-black/40 p-3 text-sm text-zinc-200">{error}</p> : null}
      {rejectionReasons.length ? (
        <div className="mt-3 space-y-1 text-xs leading-5 text-zinc-500">
          <p>{ACCESS_DENIED_MESSAGE}</p>
          {rejectionReasons.map((reason) => <p key={reason}>{reason}</p>)}
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        {auth ? (
          <>
            <Button disabled={verifying} onClick={onVerify}>
              {verifying ? "Verificando..." : "Verificar acesso"}
            </Button>
            <Button onClick={onLogout} variant="outline">Sair</Button>
          </>
        ) : (
          <>
            <Button onClick={onLoginDiscord}>Entrar com Discord</Button>
            {error ? <Button onClick={onRetry} variant="outline">Tentar novamente</Button> : null}
          </>
        )}
      </div>
    </Reveal>
  );
}

function Footer({ currentYear, onNavigate }: { currentYear: number; onNavigate: (id: string) => void }) {
  return (
    <footer className="border-t border-[#FFD500]/15 bg-[#050505] px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-4">
        <div>
          <button className="text-2xl font-black text-[#FFD500]" onClick={() => onNavigate("inicio")} type="button">Orvitek</button>
          <p className="mt-3 text-sm text-zinc-400">Desde {currentYear} — Transforma</p>
          <p className="mt-3 text-sm leading-6 text-[#B3B3B3]">Plataforma para criação, controle e gerenciamento de bots conectados ao Discord.</p>
        </div>
        <FooterColumn title="Navegação" links={[["Início", "inicio"], ["Soluções", "solucoes"], ["Documentação", "docs"], ["Dashboard", "inicio"]]} onNavigate={onNavigate} />
        <FooterColumn title="Soluções" links={[["API de Bots", "solucoes"], ["Bot Pronto", "solucoes"], ["Painel de Controle", "solucoes"]]} onNavigate={onNavigate} />
        <div>
          <h3 className="text-sm font-bold uppercase text-white">Contato</h3>
          <a className="mt-4 inline-flex text-sm text-[#B3B3B3] transition hover:text-[#FFEA70]" href={SUPPORT_URL} rel="noreferrer" target="_blank">Discord</a>
        </div>
      </div>
      <div className="mx-auto mt-10 max-w-7xl border-t border-[#FFD500]/10 pt-6 text-sm text-zinc-500">
        © {currentYear} Orvitek. Todos os direitos reservados.
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
  return (
    <motion.div
      className={className}
      initial="hidden"
      transition={{ delay, duration: 0.55, ease: "easeOut" }}
      variants={reveal}
      viewport={{ once: true, amount: 0.18 }}
      whileInView="visible"
    >
      {children}
    </motion.div>
  );
}
