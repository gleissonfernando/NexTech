import { ArrowRight, Bot, Check, ExternalLink, Headphones, Loader2, LogIn, Menu, Rocket, Server, ShieldCheck, Sparkles, X } from "lucide-react";
import { useState } from "react";
import type { Plan } from "../../types";
import { bentoFeatures, benefitItems, faqItems, integrationNodes, MONITORING_STATUS_URL, securityItems, SUPPORT_URL, workflowSteps } from "./data";
import { DashboardMockup } from "./DashboardMockup";
import { FaqItem, GlowCard, HomeButton, Metric, Section, SectionHeader } from "./HomeUi";
import type { PublicConnectedServer, PublicMarketingFeature, ServerState } from "./types";
import { cycleSuffix, ensureThreeFeatures, formatPrice, formatStatNumber, iconForFeature, readablePlanFeature } from "./utils";

type ActionProps = {
  onNavigate: (id: string) => void;
  onStart: () => void;
  startLabel: string;
  verifying: boolean;
};

export function Navbar({ onNavigate, onStart, startLabel, verifying }: ActionProps) {
  const [open, setOpen] = useState(false);
  const links: Array<[string, string]> = [
    ["Produto", "produto"],
    ["Soluções", "solucoes"],
    ["Recursos", "recursos"],
    ["Preços", "planos"],
    ["Documentação", "docs"]
  ];

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/[.07] bg-black/72 backdrop-blur-xl">
      <div className="mx-auto flex h-[76px] w-full max-w-[1480px] items-center justify-between gap-4 px-5 sm:px-6 lg:px-10 xl:px-12">
        <button className="flex items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#FFD400]/30" onClick={() => onNavigate("inicio")} type="button">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#FFD400] text-black">
            <Bot className="h-5 w-5" />
          </span>
          <span className="text-lg font-black uppercase text-white">NexTech</span>
        </button>

        <nav className="hidden items-center gap-7 lg:flex" aria-label="Navegacao principal">
          {links.map(([label, id]) => (
            <button className="text-sm font-bold text-[#D4D4D4] transition hover:text-[#FFD400]" key={id} onClick={() => onNavigate(id)} type="button">
              {label}
            </button>
          ))}
        </nav>

        <div className="hidden items-center gap-3 lg:flex">
          <HomeButton onClick={onStart} variant="secondary">Entrar</HomeButton>
          <HomeButton onClick={onStart}>{verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{startLabel}</HomeButton>
        </div>

        <button
          aria-expanded={open}
          aria-label="Abrir menu"
          className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-[#111111] text-white lg:hidden"
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open ? (
        <div className="border-t border-white/[.07] bg-[#080808] px-5 py-4 lg:hidden">
          <nav className="grid gap-2" aria-label="Navegacao mobile">
            {links.map(([label, id]) => (
              <button className="min-h-11 rounded-lg px-3 text-left text-sm font-bold text-[#D4D4D4] hover:bg-white/[.04]" key={id} onClick={() => { setOpen(false); onNavigate(id); }} type="button">
                {label}
              </button>
            ))}
          </nav>
          <div className="mt-4 grid gap-3">
            <HomeButton onClick={onStart} variant="secondary">Entrar</HomeButton>
            <HomeButton onClick={onStart}>{startLabel}</HomeButton>
          </div>
        </div>
      ) : null}
    </header>
  );
}

export function Hero({ error, onNavigate, onStart, startLabel, stats, verifying }: ActionProps & { error?: string | null; stats: Array<{ displayOverride?: string; label: string; prefix?: string; suffix?: string; value: number }> }) {
  return (
    <Section className="relative min-h-[calc(100dvh-76px)] overflow-hidden" id="inicio">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(rgba(255,212,0,.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,212,0,.035)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:linear-gradient(to_bottom,black,transparent_92%)]" />
      <div className="grid min-h-[calc(100dvh-76px)] items-center gap-12 py-12 lg:grid-cols-[1.08fr_.92fr]">
        <div className="min-w-0">
          <div className="inline-flex max-w-full items-center gap-2 rounded-lg border border-[#FFD400]/20 bg-[#FFD400]/10 px-3 py-2 text-xs font-black uppercase text-[#FFD400]">
            <Sparkles className="h-4 w-4" />
            Plataforma NexTech
          </div>
          <h1 className="mt-7 max-w-[760px] text-balance text-[clamp(3rem,6vw,5.5rem)] font-black leading-[.98] text-white">
            Gerencie tudo. Em um unico lugar.
          </h1>
          <p className="mt-6 max-w-[680px] text-pretty text-lg leading-8 text-[#D4D4D4] sm:text-xl">
            Uma plataforma criada para simplificar gerenciamento, automacao e operacoes conectadas ao Discord.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <HomeButton className="sm:min-w-48" onClick={onStart}>
              {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              {startLabel}
            </HomeButton>
            <HomeButton className="sm:min-w-52" onClick={() => onNavigate("produto")} variant="secondary">
              Conhecer plataforma
              <ArrowRight className="h-4 w-4" />
            </HomeButton>
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-3 text-sm font-semibold text-[#A3A3A3]">
            <span className="inline-flex items-center gap-2 text-[#D4D4D4]"><span className="h-2.5 w-2.5 rounded-full bg-[#FFD400]" />Online</span>
            <span>Configuracao rapida</span>
            <span className="text-[#FFD400]/50">•</span>
            <span>Gestao centralizada</span>
          </div>
          {error ? (
            <div className="mt-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm leading-6 text-red-100">
              <p className="whitespace-pre-line">{error}</p>
              <HomeButton className="mt-3" href={SUPPORT_URL} variant="secondary"><Headphones className="h-4 w-4" />Suporte</HomeButton>
            </div>
          ) : null}
        </div>
        <DashboardMockup />
      </div>
      <MetricsStrip stats={stats} />
    </Section>
  );
}

export function MetricsStrip({ stats }: { stats: Array<{ displayOverride?: string; label: string; prefix?: string; suffix?: string; value: number }> }) {
  return (
    <div className="grid gap-y-6 border-y border-white/[.07] bg-[#080808]/80 py-6 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <Metric key={stat.label} label={stat.label} value={stat.displayOverride ?? `${stat.prefix ?? ""}${formatStatNumber(stat.value, stat.value % 1 === 0 ? 0 : 1)}${stat.suffix ?? ""}`} />
      ))}
    </div>
  );
}

export function PlatformShowcase() {
  return (
    <Section className="py-20 sm:py-24" id="produto">
      <SectionHeader eyebrow="Plataforma" subtitle="Gerencie suas operacoes atraves de uma unica plataforma, com dados organizados e acoes claras." title="Tudo centralizado. Sem complicacao." />
      <div className="mt-12">
        <DashboardMockup large />
      </div>
    </Section>
  );
}

export function FeatureBento({ features, loading }: { features: PublicMarketingFeature[]; loading: boolean }) {
  const marketing = ensureThreeFeatures(loading ? [] : features);
  return (
    <Section className="py-20 sm:py-24" id="recursos">
      <SectionHeader eyebrow="Funcionalidades" subtitle="Cards com pesos diferentes para destacar o que realmente organiza a operacao." title="Recursos para operar com controle." />
      <div className="mt-12 grid auto-rows-fr gap-4 lg:grid-cols-12">
        {bentoFeatures.map((feature) => (
          <GlowCard className={`min-h-56 p-6 ${feature.className}`} key={feature.title}>
            <feature.icon className="h-7 w-7 text-[#FFD400]" />
            <h3 className="mt-6 text-2xl font-black text-white">{feature.title}</h3>
            <p className="mt-3 max-w-xl text-sm leading-7 text-[#A3A3A3]">{feature.description}</p>
          </GlowCard>
        ))}
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {marketing.map((feature) => {
          const Icon = iconForFeature(feature.icon);
          return (
            <GlowCard className="p-5" key={feature.id}>
              <Icon className="h-6 w-6 text-[#FFD400]" />
              <p className="mt-4 text-xs font-black uppercase text-[#FFD400]">{feature.category}</p>
              <h3 className="mt-2 text-lg font-black text-white">{feature.title}</h3>
              <p className="mt-2 text-sm leading-6 text-[#A3A3A3]">{feature.shortDescription}</p>
            </GlowCard>
          );
        })}
      </div>
    </Section>
  );
}

export function HowItWorks() {
  return (
    <Section className="py-20 sm:py-24" id="como-funciona">
      <SectionHeader eyebrow="Como funciona" subtitle="Um fluxo curto para sair da configuracao inicial e chegar ao controle do ambiente." title="Tres etapas para colocar tudo em operacao." />
      <div className="mt-14 grid gap-6 lg:grid-cols-3 lg:gap-0">
        {workflowSteps.map((step, index) => (
          <div className="relative min-w-0 lg:px-4" key={step.title}>
            {index < workflowSteps.length - 1 ? <div className="absolute left-[calc(50%+3rem)] right-[-3rem] top-8 hidden h-px bg-gradient-to-r from-[#FFD400]/60 to-white/10 lg:block" /> : null}
            <GlowCard className="relative p-6">
              <span className="text-5xl font-black text-[#FFD400]">0{index + 1}</span>
              <h3 className="mt-8 text-2xl font-black text-white">{step.title}</h3>
              <p className="mt-3 text-sm leading-7 text-[#A3A3A3]">{step.description}</p>
            </GlowCard>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function Benefits() {
  return (
    <Section className="py-20 sm:py-24" id="solucoes">
      <div className="grid gap-10 lg:grid-cols-[.9fr_1.1fr] lg:items-center">
        <SectionHeader align="left" eyebrow="Beneficios" subtitle="Menos telas soltas, menos configuracao manual e mais rastreabilidade para cada acao." title="Controle total para operacoes em crescimento." />
        <div className="grid gap-3 sm:grid-cols-2">
          {benefitItems.map((item) => (
            <GlowCard className="flex items-start gap-3 p-4" key={item}>
              <Check className="mt-0.5 h-5 w-5 shrink-0 text-[#FFD400]" />
              <p className="text-sm leading-6 text-[#D4D4D4]">{item}</p>
            </GlowCard>
          ))}
        </div>
      </div>
    </Section>
  );
}

export function ProductDemo() {
  return (
    <Section className="py-20 sm:py-24" id="demonstracao">
      <div className="grid gap-10 lg:grid-cols-[.8fr_1.2fr] lg:items-center">
        <SectionHeader align="left" eyebrow="Controle total" subtitle="Monitoramento de servicos, atividade, usuarios e operacoes em uma interface desenhada para leitura rapida." title="Veja tudo acontecendo em tempo real." />
        <GlowCard className="p-5">
          <div className="grid gap-3">
            {["Servico conectado", "Nova atividade registrada", "Usuario autenticado", "Sincronizacao concluida"].map((item) => (
              <div className="flex items-center justify-between gap-3 rounded-md border border-white/[.07] bg-black/25 p-4" key={item}>
                <span className="flex min-w-0 items-center gap-3 text-sm font-bold text-white">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#FFD400]" />
                  <span className="truncate">{item}</span>
                </span>
                <span className="text-xs font-semibold text-[#777777]">agora</span>
              </div>
            ))}
          </div>
        </GlowCard>
      </div>
    </Section>
  );
}

export function Integrations() {
  return (
    <Section className="py-20 sm:py-24" id="integracoes">
      <SectionHeader eyebrow="Integracoes" subtitle="Somente tecnologias e areas existentes no projeto: API, bot Discord, pagamentos, status, logs e banco de dados." title="Conecte suas ferramentas." />
      <div className="mx-auto mt-12 grid max-w-5xl gap-4 md:grid-cols-[1fr_auto_1fr] md:items-center">
        <div className="grid gap-4 sm:grid-cols-2">
          {integrationNodes.slice(0, 3).map((node) => <IntegrationNode key={node.label} {...node} />)}
        </div>
        <div className="flex h-28 w-full items-center justify-center rounded-lg border border-[#FFD400]/25 bg-[#FFD400] px-8 text-center text-xl font-black text-black md:h-40 md:w-44">NEXTECH</div>
        <div className="grid gap-4 sm:grid-cols-2">
          {integrationNodes.slice(3).map((node) => <IntegrationNode key={node.label} {...node} />)}
        </div>
      </div>
    </Section>
  );
}

export function Security() {
  return (
    <Section className="py-20 sm:py-24" id="seguranca">
      <div className="grid gap-10 lg:grid-cols-[1fr_.9fr] lg:items-center">
        <SectionHeader align="left" eyebrow="Seguranca" subtitle="Permissoes, logs e isolamento por servidor continuam no backend e no banco, sem depender apenas da interface." title="Sua operacao. Sob controle." />
        <GlowCard className="p-6">
          <div className="mx-auto flex aspect-square max-w-64 flex-col items-center justify-center rounded-lg border border-[#FFD400]/25 bg-[#0D0D0D] text-center">
            <ShieldCheck className="h-16 w-16 text-[#FFD400]" />
            <p className="mt-5 text-xs font-black uppercase text-[#777777]">Escudo</p>
            <p className="text-2xl font-black text-white">Protegido</p>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {securityItems.map((item) => (
              <p className="flex items-center gap-3 text-sm font-semibold text-[#D4D4D4]" key={item}>
                <Check className="h-4 w-4 text-[#FFD400]" />
                {item}
              </p>
            ))}
          </div>
        </GlowCard>
      </div>
    </Section>
  );
}

export function Pricing({ plans }: { onNavigate: (id: string) => void; plans: Plan[] }) {
  const visiblePlans = plans.filter((plan) => plan.isPublic && plan.isActive).slice(0, 3);
  return (
    <Section className="py-20 sm:py-24" id="planos">
      <SectionHeader eyebrow="Planos" subtitle="Os valores abaixo vêm dos planos públicos cadastrados no sistema." title="Escolha o plano correto para sua operacao." />
      {visiblePlans.length ? (
        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          {visiblePlans.map((plan) => <PlanCard key={plan.id} plan={plan} />)}
        </div>
      ) : (
        <GlowCard className="mx-auto mt-12 max-w-2xl p-6 text-center">
          <p className="text-sm leading-7 text-[#A3A3A3]">Nenhum plano publico ativo foi encontrado agora. A pagina de planos continua disponivel para consulta.</p>
        </GlowCard>
      )}
      <div className="mt-8 text-center">
        <HomeButton href="/planos">Ver todos os planos <ArrowRight className="h-4 w-4" /></HomeButton>
      </div>
    </Section>
  );
}

export function Faq() {
  return (
    <Section className="py-20 sm:py-24" id="faq">
      <SectionHeader eyebrow="FAQ" subtitle="Respostas curtas sobre acesso, suporte e funcionamento geral." title="Perguntas frequentes." />
      <div className="mx-auto mt-10 max-w-3xl rounded-lg border border-white/[.07] bg-[#101010] px-5 sm:px-7">
        {faqItems.map((item) => <FaqItem key={item.question} {...item} />)}
      </div>
    </Section>
  );
}

export function FinalCta({ onStart, startLabel, verifying }: Pick<ActionProps, "onStart" | "startLabel" | "verifying">) {
  return (
    <Section className="py-20 sm:py-24">
      <div className="rounded-lg border border-[#FFD400]/20 bg-[radial-gradient(circle_at_50%_0%,rgba(255,212,0,.20),transparent_42%),#0A0A0A] px-6 py-14 text-center sm:px-10">
        <p className="text-xs font-black uppercase text-[#FFD400]">Pronto para comecar?</p>
        <h2 className="mx-auto mt-4 max-w-3xl text-balance text-4xl font-black leading-tight text-white sm:text-5xl">Centralize sua operacao com a NexTech.</h2>
        <div className="mt-8">
          <HomeButton onClick={onStart}>{verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}{startLabel}</HomeButton>
        </div>
      </div>
    </Section>
  );
}

export function Footer({ currentYear, onNavigate }: { currentYear: number; onNavigate: (id: string) => void }) {
  return (
    <footer className="w-full border-t border-white/[.07] bg-[#050505] py-12">
      <div className="mx-auto grid w-full max-w-[1480px] gap-8 px-5 sm:px-6 md:grid-cols-2 lg:grid-cols-5 lg:px-10 xl:px-12">
        <div className="lg:col-span-2">
          <button className="text-left text-2xl font-black uppercase text-white" onClick={() => onNavigate("inicio")} type="button">NexTech</button>
          <p className="mt-4 max-w-sm text-sm leading-7 text-[#999999]">Uma plataforma para simplificar sua operacao.</p>
        </div>
        <FooterColumn links={[["Plataforma", "produto"], ["Recursos", "recursos"], ["Precos", "planos"]]} onNavigate={onNavigate} title="Produto" />
        <FooterColumn links={[["Sobre", "inicio"], ["Contato", "suporte"]]} onNavigate={onNavigate} title="Empresa" />
        <FooterColumn links={[["Documentacao", "docs"], ["Suporte", "suporte"], ["Status", "status"]]} onNavigate={onNavigate} title="Recursos" />
      </div>
      <div className="mx-auto mt-10 flex w-full max-w-[1480px] flex-col gap-3 border-t border-white/[.07] px-5 pt-6 text-sm text-[#777777] sm:px-6 md:flex-row md:items-center md:justify-between lg:px-10 xl:px-12">
        <span>© {currentYear} NexTech. Todos os direitos reservados.</span>
        <button className="w-fit text-[#999999] transition hover:text-[#FFD400]" onClick={() => onNavigate("termos")} type="button">Termos e privacidade</button>
      </div>
    </footer>
  );
}

export function ConnectedServers({ state }: { state: ServerState }) {
  const data = state.value;
  if (state.loading) {
    return <Section className="border-y border-white/[.07] bg-[#080808] py-10"><p className="text-center text-sm font-semibold text-[#999999]">Carregando servidores conectados...</p></Section>;
  }
  if (state.error || !data?.servers.length) {
    return <Section className="border-y border-white/[.07] bg-[#080808] py-10"><p className="text-center text-sm font-semibold text-[#999999]">Servidores conectados serao exibidos quando houver dados publicos disponiveis.</p></Section>;
  }
  return (
    <Section className="border-y border-white/[.07] bg-[#080808] py-10">
      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-4">
        {data.servers.slice(0, 8).map((server) => <ServerCard key={server.guildId} server={server} />)}
      </div>
    </Section>
  );
}

function IntegrationNode({ icon: Icon, label }: { icon: typeof Bot; label: string }) {
  return (
    <GlowCard className="flex min-h-24 items-center gap-3 p-4">
      <Icon className="h-5 w-5 shrink-0 text-[#FFD400]" />
      <span className="min-w-0 truncate text-sm font-bold text-white">{label}</span>
    </GlowCard>
  );
}

function PlanCard({ plan }: { plan: Plan }) {
  const price = plan.promotionalPriceInCents ?? plan.priceInCents;
  const features = plan.entitlements.filter((item) => item.enabled).slice(0, 4);
  return (
    <GlowCard className={`flex min-h-full flex-col p-6 ${plan.isRecommended ? "border-[#FFD400]/55" : ""}`}>
      <div className="flex min-h-8 items-start justify-between gap-3">
        <p className="text-sm font-black uppercase text-[#FFD400]">{plan.badge || "Plano"}</p>
        {plan.isRecommended ? <span className="rounded-md bg-[#FFD400] px-2.5 py-1 text-xs font-black text-black">Recomendado</span> : null}
      </div>
      <h3 className="mt-4 text-2xl font-black text-white">{plan.name}</h3>
      <p className="mt-3 min-h-14 text-sm leading-7 text-[#A3A3A3]">{plan.shortDescription || plan.description}</p>
      <div className="mt-6 border-y border-white/[.07] py-5">
        <span className="text-4xl font-black text-white">{formatPrice(price, plan.currency)}</span>
        <span className="text-sm font-semibold text-[#777777]"> {cycleSuffix(plan.billingCycle)}</span>
      </div>
      <ul className="mt-6 grid flex-1 gap-3">
        {features.map((feature) => (
          <li className="flex gap-3 text-sm leading-6 text-[#D4D4D4]" key={feature.key}>
            <Check className="mt-1 h-4 w-4 shrink-0 text-[#FFD400]" />
            {readablePlanFeature(feature.key)}
          </li>
        ))}
      </ul>
      <HomeButton className="mt-8" href="/planos">Comecar agora</HomeButton>
    </GlowCard>
  );
}

function ServerCard({ server }: { server: PublicConnectedServer }) {
  return (
    <GlowCard className="flex min-w-0 items-center gap-4 p-4">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-[#080808]">
        {server.iconUrl ? <img alt="" className="h-full w-full object-cover" loading="lazy" src={server.iconUrl} /> : <Server className="h-5 w-5 text-[#FFD400]" />}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-white">{server.name}</p>
        <p className="truncate text-xs text-[#999999]">{server.memberCount.toLocaleString("pt-BR")} membros</p>
      </div>
    </GlowCard>
  );
}

function FooterColumn({ links, onNavigate, title }: { links: Array<[string, string]>; onNavigate: (id: string) => void; title: string }) {
  return (
    <div>
      <h3 className="text-sm font-black uppercase text-white">{title}</h3>
      <div className="mt-4 grid gap-3">
        {links.map(([label, id]) => (
          <button className="w-fit text-left text-sm text-[#999999] transition hover:text-[#FFD400]" key={`${title}-${label}`} onClick={() => onNavigate(id)} type="button">
            {label === "Status" ? <span className="inline-flex items-center gap-1">{label}<ExternalLink className="h-3 w-3" /></span> : label}
          </button>
        ))}
      </div>
    </div>
  );
}

export { MONITORING_STATUS_URL };
