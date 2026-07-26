import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import {
  Activity,
  ArrowRight,
  Bot,
  Boxes,
  Braces,
  Check,
  CheckCircle2,
  Cloud,
  Database,
  Gauge,
  GitBranch,
  Globe2,
  KeyRound,
  Layers3,
  LockKeyhole,
  Radio,
  Server,
  ShieldCheck,
  Sparkles,
  Webhook,
  Workflow,
  Zap
} from "lucide-react";
import { ComoFunciona } from "./ComoFunciona";
import { Button } from "../ui/button";

type Icon = ComponentType<{ className?: string }>;

type HomeModule = {
  description: string;
  icon: Icon;
  id: string;
  onOpen: () => void;
  title: string;
};

type DashboardHomeProps = {
  activeModules: number;
  botOnline: boolean;
  channelCount: number;
  guildName: string;
  memberCount: number;
  modules: HomeModule[];
  totalModules: number;
};

const solutions = [
  { icon: Workflow, title: "Automação inteligente", text: "Fluxos claros para reduzir ações repetitivas e manter a operação previsível." },
  { icon: Bot, title: "Gerenciamento de bots", text: "Status, comandos, permissões e eventos reunidos no mesmo ambiente." },
  { icon: Braces, title: "APIs e integrações", text: "Conexões externas com histórico, escopo e rastreabilidade." },
  { icon: Activity, title: "Monitoramento ao vivo", text: "Sinais importantes aparecem rápido, sem procurar em várias telas." },
  { icon: ShieldCheck, title: "Segurança aplicada", text: "Sessões, permissões e ações validadas no contexto certo." },
  { icon: Cloud, title: "Escala organizada", text: "Bots e servidores crescem sem virar uma pilha de configuração solta." }
];

const integrations = [
  { icon: Bot, label: "Bots" },
  { icon: Webhook, label: "Webhooks" },
  { icon: Braces, label: "API REST" },
  { icon: Database, label: "Dados" },
  { icon: GitBranch, label: "Código" },
  { icon: Cloud, label: "Nuvem" }
];

export function DashboardHome(props: DashboardHomeProps) {
  const featuredModules = props.modules.slice(0, 6);
  const moduleProgress = props.totalModules > 0 ? Math.round((props.activeModules / props.totalModules) * 100) : 0;
  const statusText = props.botOnline ? "Operação online" : "Aguardando conexão";

  return (
    <div className="nex-tech-home -mx-4 overflow-hidden px-4 pb-8 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <section className="relative isolate overflow-hidden rounded-lg border border-white/[.08] bg-[#08090d] px-5 py-8 shadow-[0_24px_80px_rgba(0,0,0,.42)] sm:px-8 lg:px-10">
        <HomeBackdrop />
        <div className="relative grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(420px,.86fr)] xl:items-center">
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            initial={{ opacity: 0, y: 22 }}
            transition={{ duration: 0.55, ease: "easeOut" }}
          >
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill online={props.botOnline} text={statusText} />
              <span className="rounded-md border border-cyan-300/20 bg-cyan-300/[.07] px-3 py-1.5 text-xs font-medium text-cyan-100">
                Dashboard central
              </span>
            </div>

            <h1 className="mt-6 max-w-4xl text-4xl font-bold text-white sm:text-5xl xl:text-6xl">
              Controle sua operação sem perder velocidade.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
              Acompanhe bots, servidores, módulos e permissões em uma tela inicial mais clara, com atalhos diretos para o que precisa de ação.
            </p>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Button asChild className="h-11">
                <a href="#modulos">Abrir módulos <ArrowRight className="h-4 w-4" /></a>
              </Button>
              <Button asChild className="h-11" variant="secondary">
                <a href="#visao-geral">Ver visão geral</a>
              </Button>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <HeroMetric icon={Server} label="Servidor" value={props.guildName || "Selecionado"} />
              <HeroMetric icon={Layers3} label="Módulos ativos" value={`${props.activeModules}/${props.totalModules}`} />
              <HeroMetric icon={Gauge} label="Cobertura" value={`${moduleProgress}%`} />
            </div>
          </motion.div>

          <PlatformPreview {...props} moduleProgress={moduleProgress} />
        </div>
      </section>

      <Reveal className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <TrustItem icon={Radio} title="Bot monitorado" text={props.botOnline ? "Conectado agora" : "Status acompanhado pelo painel"} />
        <TrustItem icon={LockKeyhole} title="Sessões seguras" text="Acesso validado no backend" />
        <TrustItem icon={Gauge} title="Módulos visíveis" text={`${props.activeModules} recursos ativos`} />
        <TrustItem icon={Server} title="Escopo isolado" text="Dados separados por bot e servidor" />
      </Reveal>

      <Reveal className="home-section" id="visao-geral">
        <div className="grid gap-4 lg:grid-cols-[.95fr_1.05fr]">
          <div className="rounded-lg border border-white/[.08] bg-white/[.03] p-6 sm:p-7">
            <SectionHeading align="left" eyebrow="Visão geral" title="Resumo da operação" text="Dados úteis logo na entrada, sem poluir a navegação principal." />
            <div className="mt-7 grid gap-4 sm:grid-cols-2">
              <Stat value={props.memberCount} label="membros no servidor" />
              <Stat value={props.channelCount} label="canais acompanhados" />
              <Stat value={props.activeModules} suffix={`/${props.totalModules}`} label="módulos ativos" />
              <Stat value={props.botOnline ? 100 : 0} suffix="%" label="bot disponível" />
            </div>
          </div>
          <OperationalTimeline online={props.botOnline} />
        </div>
      </Reveal>

      <section className="home-section pt-0" id="solucoes">
        <SectionHeading eyebrow="Soluções" title="Áreas organizadas por função" text="Cada bloco tem um papel claro para facilitar leitura, comparação e ação." />
        <div className="mt-9 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {solutions.map((item, index) => <SolutionCard index={index} key={item.title} {...item} />)}
        </div>
      </section>

      <section className="home-section pt-0" id="recursos">
        <SectionHeading eyebrow="Recursos" title="Menos ruído, mais controle" text="A tela inicial prioriza status, atalhos e sinais que ajudam no dia a dia." />
        <div className="mt-9 grid gap-4 xl:grid-cols-3">
          <Feature icon={Boxes} title="Controle completo" text="Bots, servidores e módulos no mesmo fluxo." bullets={["Visão centralizada", "Ações contextuais", "Navegação consistente"]} />
          <Feature icon={Zap} title="Fluxos rápidos" text="Configure recursos com estados claros." bullets={["Configuração modular", "Estados visíveis", "Rotinas automatizadas"]} />
          <Feature icon={Activity} title="Dados atuais" text="Sinais relevantes aparecem conforme mudam." bullets={["Status dos serviços", "Atividades recentes", "Indicadores essenciais"]} />
        </div>
      </section>

      <ComoFunciona />

      <section className="home-section grid items-center gap-6 pt-0 xl:grid-cols-2">
        <div>
          <SectionHeading align="left" eyebrow="Integrações" title="Conexões sem bagunça" text="Serviços externos ficam visíveis sem tomar o espaço das ações principais." />
          <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {integrations.map(({ icon: ItemIcon, label }) => (
              <div className="flex min-h-14 items-center gap-3 rounded-lg border border-white/[.08] bg-white/[.035] p-3 text-sm text-zinc-200" key={label}>
                <ItemIcon className="h-4 w-4 text-cyan-200" />
                {label}
              </div>
            ))}
          </div>
        </div>
        <IntegrationVisual />
      </section>

      <section className="home-section grid gap-4 pt-0 xl:grid-cols-[.9fr_1.1fr]">
        <Reveal className="rounded-lg border border-white/[.08] bg-[#0a0d11] p-6 sm:p-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-emerald-300/20 bg-emerald-300/[.08]">
            <ShieldCheck className="h-6 w-6 text-emerald-200" />
          </div>
          <h2 className="mt-6 text-2xl font-bold text-white sm:text-3xl">Segurança em todos os níveis</h2>
          <p className="mt-3 leading-7 text-slate-400">Controles para reduzir exposição e manter cada ação no contexto correto.</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {["Proteção de sessões", "Controle de acesso", "Logs de atividades", "Validação de requisições", "Permissões por função", "Monitoramento contínuo"].map((item) => (
              <span className="flex items-center gap-2 text-sm text-slate-300" key={item}>
                <Check className="h-4 w-4 text-emerald-200" />
                {item}
              </span>
            ))}
          </div>
        </Reveal>
        <SecurityPanel />
      </section>

      {featuredModules.length ? (
        <section className="home-section pt-0" id="modulos">
          <SectionHeading eyebrow="Seu ambiente" title="Módulos disponíveis" text="Atalhos para as ferramentas liberadas neste bot." />
          <div className="mt-9 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {featuredModules.map(({ icon: ModuleIcon, ...module }, index) => (
              <Reveal delay={index * 0.035} key={module.id}>
                <button
                  className="group flex min-h-32 w-full items-start gap-4 rounded-lg border border-white/[.08] bg-white/[.03] p-5 text-left transition duration-200 hover:-translate-y-1 hover:border-amber-200/30 hover:bg-amber-200/[.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
                  onClick={module.onOpen}
                  type="button"
                >
                  <span className="rounded-lg bg-amber-200/[.09] p-2.5 text-amber-100">
                    <ModuleIcon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0">
                    <strong className="text-sm text-white">{module.title}</strong>
                    <span className="mt-2 block text-xs leading-5 text-slate-500">{module.description}</span>
                  </span>
                  <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-slate-600 transition group-hover:translate-x-1 group-hover:text-amber-100" />
                </button>
              </Reveal>
            ))}
          </div>
        </section>
      ) : null}

      <Reveal className="relative overflow-hidden rounded-lg border border-white/[.08] bg-[#08090d] p-8 text-center sm:p-10">
        <div className="absolute inset-0 nex-tech-grid opacity-30" />
        <div className="relative">
          <p className="text-xs font-semibold uppercase text-amber-100">Continue sua jornada</p>
          <h2 className="mx-auto mt-4 max-w-2xl text-3xl font-bold text-white sm:text-4xl">Configure o próximo módulo com mais clareza</h2>
          <p className="mx-auto mt-4 max-w-xl text-slate-400">Use os atalhos da tela inicial para chegar ao ponto certo sem percorrer menus desnecessários.</p>
          <Button asChild className="mt-7 h-11">
            <a href="#modulos">Ver módulos <ArrowRight className="h-4 w-4" /></a>
          </Button>
        </div>
      </Reveal>

      <footer className="flex flex-col gap-3 px-2 pb-2 pt-8 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} Nex Tech. Operação centralizada.</p>
        <span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${props.botOnline ? "bg-emerald-300" : "bg-slate-600"}`} />{props.botOnline ? "Bot conectado" : "Status indisponível"}</span>
      </footer>
    </div>
  );
}

function HomeBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className="nex-tech-grid absolute inset-0 opacity-45" />
      <motion.div
        animate={{ x: ["-30%", "130%"] }}
        className="absolute top-0 h-px w-1/2 bg-gradient-to-r from-transparent via-amber-100/70 to-transparent"
        transition={{ duration: 6, ease: "easeInOut", repeat: Infinity }}
      />
      <motion.div
        animate={{ x: ["120%", "-30%"] }}
        className="absolute bottom-0 h-px w-1/3 bg-gradient-to-r from-transparent via-cyan-200/50 to-transparent"
        transition={{ duration: 7.5, ease: "easeInOut", repeat: Infinity }}
      />
    </div>
  );
}

function StatusPill({ online, text }: { online: boolean; text: string }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium ${online ? "border-emerald-300/25 bg-emerald-300/[.08] text-emerald-100" : "border-slate-500/30 bg-slate-400/[.08] text-slate-300"}`}>
      <span className={`h-2 w-2 rounded-full ${online ? "bg-emerald-300" : "bg-slate-500"}`} />
      {text}
    </span>
  );
}

function PlatformPreview(props: DashboardHomeProps & { moduleProgress: number }) {
  const bars = useMemo(() => [34, 52, 46, 70, 58, 82, 68, 94], []);

  return (
    <motion.div
      animate={{ opacity: 1, scale: 1, y: 0 }}
      className="relative"
      initial={{ opacity: 0, scale: 0.97, y: 18 }}
      transition={{ duration: 0.65, delay: 0.12, ease: "easeOut" }}
    >
      <div className="relative overflow-hidden rounded-lg border border-white/[.1] bg-[#0c0f14]/95 shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[.08] px-4 py-3">
          <div className="flex items-center gap-2">
            <i className="h-2.5 w-2.5 rounded-full bg-slate-600" />
            <i className="h-2.5 w-2.5 rounded-full bg-amber-200" />
            <i className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
          </div>
          <span className="text-[10px] text-slate-500">nex-tech / início</span>
        </div>

        <div className="grid grid-cols-[72px_1fr] sm:grid-cols-[92px_1fr]">
          <aside className="border-r border-white/[.07] p-3">
            <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg bg-amber-200 text-black">
              <Bot className="h-5 w-5" />
            </div>
            <div className="mt-6 space-y-3">
              {[1, 2, 3, 4, 5].map((item) => (
                <motion.i
                  animate={{ opacity: item === 1 ? 1 : [0.45, 0.75, 0.45] }}
                  className={`mx-auto block h-7 rounded-md ${item === 1 ? "bg-amber-200/18" : "bg-white/[.045]"}`}
                  key={item}
                  transition={{ duration: 2.4, delay: item * 0.18, repeat: Infinity }}
                />
              ))}
            </div>
          </aside>

          <div className="min-w-0 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs text-slate-500">Servidor atual</p>
                <p className="mt-1 truncate text-sm font-semibold text-white">{props.guildName}</p>
              </div>
              <StatusPill online={props.botOnline} text={props.botOnline ? "Online" : "Offline"} />
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <MiniMetric label="Membros" value={compact(props.memberCount)} />
              <MiniMetric label="Módulos" value={`${props.activeModules}/${props.totalModules}`} />
            </div>

            <div className="mt-3 rounded-lg border border-white/[.07] bg-white/[.025] p-3">
              <div className="flex h-24 items-end gap-1.5">
                {bars.map((height, index) => (
                  <motion.i
                    animate={{ height }}
                    className="flex-1 rounded-t bg-gradient-to-t from-amber-300/20 via-cyan-200/35 to-emerald-200/85"
                    initial={{ height: 5 }}
                    key={index}
                    transition={{ duration: 0.55, delay: 0.2 + index * 0.045, ease: "easeOut" }}
                  />
                ))}
              </div>
              <div className="mt-3 flex justify-between text-[10px] text-slate-500">
                <span>Atividade</span>
                <span>{props.moduleProgress}% liberado</span>
              </div>
            </div>

            <div className="mt-3 space-y-2">
              {["Permissões verificadas", "Sessões protegidas", "Serviços sincronizados"].map((item, index) => (
                <motion.div
                  animate={{ x: 0, opacity: 1 }}
                  className="flex items-center gap-2 rounded-md bg-white/[.03] px-3 py-2 text-[11px] text-slate-300"
                  initial={{ x: 12, opacity: 0 }}
                  key={item}
                  transition={{ duration: 0.35, delay: 0.45 + index * 0.08 }}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${index === 0 ? "bg-emerald-300" : index === 1 ? "bg-cyan-200" : "bg-amber-200"}`} />
                  {item}
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function HeroMetric({ icon: Icon, label, value }: { icon: Icon; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/[.08] bg-white/[.035] p-4">
      <Icon className="h-4 w-4 text-amber-100" />
      <p className="mt-3 text-[11px] uppercase text-slate-500">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[.07] bg-white/[.03] p-3">
      <p className="text-[10px] text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function TrustItem({ icon: Icon, title, text }: { icon: Icon; title: string; text: string }) {
  return (
    <div className="flex min-h-20 items-center gap-3 rounded-lg border border-white/[.08] bg-white/[.035] p-4">
      <span className="rounded-lg bg-amber-200/[.09] p-2.5 text-amber-100"><Icon className="h-5 w-5" /></span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-white">{title}</p>
        <p className="mt-1 text-xs text-slate-500">{text}</p>
      </div>
    </div>
  );
}

function SectionHeading({ align = "center", eyebrow, title, text }: { align?: "left" | "center"; eyebrow: string; title: string; text: string }) {
  return (
    <Reveal className={align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-xl"}>
      <p className="text-xs font-semibold uppercase text-amber-100">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-bold text-white sm:text-4xl">{title}</h2>
      <p className="mt-4 leading-7 text-slate-400">{text}</p>
    </Reveal>
  );
}

function SolutionCard({ icon: Icon, title, text, index }: { icon: Icon; title: string; text: string; index: number }) {
  return (
    <Reveal delay={index * 0.045} className="group rounded-lg border border-white/[.08] bg-white/[.03] p-6 transition duration-200 hover:-translate-y-1 hover:border-amber-200/25 hover:bg-amber-200/[.045]">
      <span className="inline-flex rounded-lg border border-amber-200/20 bg-amber-200/[.08] p-3 text-amber-100">
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="mt-5 font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-500">{text}</p>
    </Reveal>
  );
}

function Feature({ icon: Icon, title, text, bullets }: { icon: Icon; title: string; text: string; bullets: string[] }) {
  return (
    <Reveal className="rounded-lg border border-white/[.08] bg-[#0a0d11] p-6">
      <Icon className="h-7 w-7 text-cyan-200" />
      <h3 className="mt-6 text-xl font-semibold text-white">{title}</h3>
      <p className="mt-3 text-sm leading-6 text-slate-400">{text}</p>
      <ul className="mt-6 space-y-3">
        {bullets.map((item) => (
          <li className="flex items-center gap-2 text-sm text-slate-300" key={item}>
            <Check className="h-4 w-4 text-emerald-200" />
            {item}
          </li>
        ))}
      </ul>
    </Reveal>
  );
}

function OperationalTimeline({ online }: { online: boolean }) {
  const items = [
    ["Sessão", "Autenticação validada para o painel."],
    ["Permissões", "Acesso conferido por bot e servidor."],
    ["Sincronização", online ? "Bot conectado e pronto para operar." : "Aguardando reconexão do bot."]
  ];

  return (
    <Reveal className="rounded-lg border border-white/[.08] bg-[#0a0d11] p-6 sm:p-7">
      <p className="text-xs font-semibold uppercase text-cyan-200">Fluxo atual</p>
      <div className="mt-6 space-y-4">
        {items.map(([title, text], index) => (
          <div className="grid grid-cols-[28px_1fr] gap-3" key={title}>
            <div className="flex flex-col items-center">
              <span className={`h-3 w-3 rounded-full ${index === 2 && !online ? "bg-slate-500" : "bg-emerald-300"}`} />
              {index < items.length - 1 ? <span className="mt-2 h-full min-h-10 w-px bg-white/[.08]" /> : null}
            </div>
            <div className="pb-2">
              <p className="text-sm font-semibold text-white">{title}</p>
              <p className="mt-1 text-sm leading-6 text-slate-500">{text}</p>
            </div>
          </div>
        ))}
      </div>
    </Reveal>
  );
}

function Stat({ value, suffix = "", label }: { value: number; suffix?: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useInView(ref, { once: true, margin: "-50px" });
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (!visible) return undefined;
    if (reduced) {
      setShown(value);
      return undefined;
    }

    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - started) / 800, 1);
      setShown(Math.round(value * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reduced, value, visible]);

  return (
    <div className="rounded-lg border border-white/[.07] bg-white/[.025] p-4" ref={ref}>
      <p className="text-3xl font-bold text-white sm:text-4xl">{shown.toLocaleString("pt-BR")}{suffix}</p>
      <p className="mt-2 text-sm text-slate-500">{label}</p>
    </div>
  );
}

function IntegrationVisual() {
  return (
    <Reveal className="relative mx-auto flex min-h-80 w-full max-w-xl items-center justify-center overflow-hidden rounded-lg border border-white/[.08] bg-[#08090d]">
      <div className="nex-tech-grid absolute inset-0 opacity-35" />
      <motion.div
        animate={{ rotate: 360 }}
        className="absolute h-56 w-56 rounded-full border border-dashed border-amber-100/20"
        transition={{ duration: 28, ease: "linear", repeat: Infinity }}
      />
      <motion.div
        animate={{ rotate: -360 }}
        className="absolute h-40 w-40 rounded-full border border-cyan-200/15"
        transition={{ duration: 22, ease: "linear", repeat: Infinity }}
      />
      {integrations.map(({ icon: Icon, label }, index) => {
        const angle = (Math.PI * 2 * index) / integrations.length;
        const x = Math.cos(angle) * 106;
        const y = Math.sin(angle) * 106;
        return (
          <motion.div
            animate={{ y: [y, y - 6, y] }}
            className="absolute flex h-12 w-12 items-center justify-center rounded-lg border border-white/[.08] bg-[#10131a] text-cyan-100 shadow-lg"
            key={label}
            style={{ x }}
            title={label}
            transition={{ duration: 3 + index * 0.22, repeat: Infinity, ease: "easeInOut" }}
          >
            <Icon className="h-5 w-5" />
          </motion.div>
        );
      })}
      <div className="relative flex h-20 w-20 items-center justify-center rounded-lg bg-amber-200 text-black shadow-[0_0_40px_rgba(253,230,138,.18)]">
        <Globe2 className="h-9 w-9" />
      </div>
    </Reveal>
  );
}

function SecurityPanel() {
  const rows = [
    [KeyRound, "Sessão autenticada", "Acesso verificado"],
    [ShieldCheck, "Escopo do servidor", "Contexto isolado"],
    [LockKeyhole, "Credenciais privadas", "Mantidas no backend"]
  ] as const;

  return (
    <Reveal className="rounded-lg border border-white/[.08] bg-[#08090d] p-5 sm:p-6">
      <div className="flex items-center justify-between border-b border-white/[.08] pb-4">
        <div>
          <p className="text-sm font-semibold text-white">Centro de proteção</p>
          <p className="mt-1 text-xs text-slate-500">Visão operacional</p>
        </div>
        <span className="rounded-md bg-emerald-300/[.08] px-3 py-1 text-xs text-emerald-100">Monitorado</span>
      </div>
      <div className="mt-5 space-y-3">
        {rows.map(([ItemIcon, title, text]) => (
          <div className="flex items-center gap-4 rounded-lg border border-white/[.07] bg-white/[.03] p-4" key={title}>
            <ItemIcon className="h-5 w-5 text-emerald-200" />
            <div>
              <p className="text-sm font-medium text-white">{title}</p>
              <p className="mt-1 text-xs text-slate-500">{text}</p>
            </div>
          </div>
        ))}
      </div>
    </Reveal>
  );
}

function Reveal({ children, className = "", delay = 0, id }: { children: ReactNode; className?: string; delay?: number; id?: string }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className={className}
      id={id}
      initial={reduced ? false : { opacity: 0, y: 18 }}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
      viewport={{ once: true, amount: 0.14 }}
      whileInView={{ opacity: 1, y: 0 }}
    >
      {children}
    </motion.div>
  );
}

function compact(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, notation: "compact" }).format(value);
}
