import { motion } from "framer-motion";
import { ArrowRight, Bot, Check, ExternalLink, Headphones, Loader2, LogIn, Menu, Rocket, Server, ShieldCheck, Sparkles, X } from "lucide-react";
import { useState } from "react";
import type { Plan } from "../../types";
import { bentoFeatures, benefitItems, faqItems, integrationNodes, MONITORING_STATUS_URL, securityItems, SUPPORT_URL, workflowSteps } from "./data";
import { DashboardMockup } from "./DashboardMockup";
import { FaqItem, GlowCard, HomeButton, InkRule, Metric, Reveal, Section, SectionHeader, StaggerGroup, StaggerItem } from "./HomeUi";
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
    <motion.header
      animate={{ y: 0, opacity: 1 }}
      className="core-theme sticky top-0 z-50 w-full border-b border-[var(--rule)] bg-black/70 backdrop-blur-xl"
      initial={{ y: -24, opacity: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="mx-auto flex h-[76px] w-full max-w-[1560px] items-center justify-between gap-4 px-[var(--core-margin)]">
        <button className="flex items-center gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFD400]/40" onClick={() => onNavigate("inicio")} type="button">
          <span className="core-chamfer-sm flex h-10 w-10 items-center justify-center bg-[#FFD400] text-black">
            <Bot className="h-5 w-5" />
          </span>
          <span className="core-voice-poster text-lg text-white">NexTech</span>
        </button>

        <nav className="hidden items-center gap-8 lg:flex" aria-label="Navegacao principal">
          {links.map(([label, id]) => (
            <button className="core-voice-caption text-[#9b9b9b] transition-colors hover:text-[#FFD400]" key={id} onClick={() => onNavigate(id)} type="button">
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
          className="core-chamfer-outline is-tab core-press inline-flex h-11 w-11 items-center justify-center text-white lg:hidden"
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open ? (
        <div className="border-t border-[var(--rule-soft)] bg-[var(--stock-2)] px-[var(--core-margin)] py-4 lg:hidden">
          <nav className="grid" aria-label="Navegacao mobile">
            {links.map(([label, id]) => (
              <button className="core-voice-caption min-h-12 border-b border-[var(--rule-soft)] px-1 text-left text-[#9b9b9b] transition-colors last:border-b-0 hover:text-[#FFD400]" key={id} onClick={() => { setOpen(false); onNavigate(id); }} type="button">
                {label}
              </button>
            ))}
          </nav>
          <div className="mt-5 grid gap-3">
            <HomeButton onClick={onStart} variant="secondary">Entrar</HomeButton>
            <HomeButton onClick={onStart}>{startLabel}</HomeButton>
          </div>
        </div>
      ) : null}
    </motion.header>
  );
}

export function Hero({ error, onNavigate, onStart, startLabel, stats, verifying }: ActionProps & { error?: string | null; stats: Array<{ displayOverride?: string; label: string; prefix?: string; suffix?: string; value: number }> }) {
  return (
    <Section className="relative min-h-[calc(100dvh-76px)]" id="inicio">
      <div className="grid min-h-[calc(100dvh-76px)] items-center gap-12 py-12 lg:grid-cols-[1.08fr_.92fr]">
        <StaggerGroup className="min-w-0">
          <StaggerItem className="core-chamfer-outline is-tab core-voice-rail inline-flex max-w-full items-center gap-2 px-3 py-2.5 text-[#FFD400]">
            <Sparkles className="h-3.5 w-3.5" />
            Plataforma NexTech
          </StaggerItem>
          <StaggerItem className="core-voice-poster mt-7 max-w-[820px] text-balance text-[clamp(3rem,6.2vw,5.75rem)] text-white">
            <h1>Gerencie tudo. Em um unico lugar.</h1>
          </StaggerItem>
          <StaggerItem className="mt-5 max-w-[420px]">
            <InkRule />
          </StaggerItem>
          <StaggerItem className="core-voice-body mt-6 max-w-[660px] text-pretty text-lg text-[#9b9b9b] sm:text-xl">
            <p>Uma plataforma criada para simplificar gerenciamento, automacao e operacoes conectadas ao Discord.</p>
          </StaggerItem>
          <StaggerItem className="mt-9 flex flex-col gap-3 sm:flex-row">
            <HomeButton className="sm:min-w-48" onClick={onStart}>
              {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              {startLabel}
            </HomeButton>
            <HomeButton className="sm:min-w-52" onClick={() => onNavigate("produto")} variant="secondary">
              Conhecer plataforma
              <ArrowRight className="h-4 w-4" />
            </HomeButton>
          </StaggerItem>
          <StaggerItem className="core-voice-rail mt-9 flex flex-wrap items-center gap-x-4 gap-y-3 text-[#8a8a8a]">
            <span className="inline-flex items-center gap-2 text-white"><motion.span animate={{ opacity: [1, .3, 1] }} className="h-2 w-2 rounded-full bg-[#FFD400]" transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }} />Online</span>
            <span className="text-[#FFD400]/40">/</span>
            <span>Configuracao rapida</span>
            <span className="text-[#FFD400]/40">/</span>
            <span>Gestao centralizada</span>
          </StaggerItem>
          {error ? (
            <StaggerItem className="core-chamfer-outline mt-8 p-5 [--cbo:rgba(239,68,68,.45)]">
              <p className="core-voice-body whitespace-pre-line text-sm text-red-100">{error}</p>
              <HomeButton className="mt-4" href={SUPPORT_URL} variant="secondary"><Headphones className="h-4 w-4" />Suporte</HomeButton>
            </StaggerItem>
          ) : null}
        </StaggerGroup>
        <Reveal delay={0.15}>
          <DashboardMockup />
        </Reveal>
      </div>
      <MetricsStrip stats={stats} />
    </Section>
  );
}

export function MetricsStrip({ stats }: { stats: Array<{ displayOverride?: string; label: string; prefix?: string; suffix?: string; value: number }> }) {
  return (
    <StaggerGroup className="grid gap-y-8 border-y border-[var(--rule)] py-8 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => {
        const decimals = stat.value % 1 === 0 ? 0 : 1;
        return (
          <StaggerItem key={stat.label}>
            <Metric
              decimals={decimals}
              label={stat.label}
              numericValue={stat.displayOverride ? undefined : stat.value}
              prefix={stat.prefix}
              suffix={stat.suffix}
              value={stat.displayOverride ?? `${stat.prefix ?? ""}${formatStatNumber(stat.value, decimals)}${stat.suffix ?? ""}`}
            />
          </StaggerItem>
        );
      })}
    </StaggerGroup>
  );
}

export function PlatformShowcase() {
  return (
    <Section className="py-20 sm:py-24" id="produto">
      <Reveal>
        <SectionHeader eyebrow="Plataforma" subtitle="Gerencie suas operacoes atraves de uma unica plataforma, com dados organizados e acoes claras." title="Tudo centralizado. Sem complicacao." />
      </Reveal>
      <Reveal className="mt-12" delay={0.1}>
        <DashboardMockup large />
      </Reveal>
    </Section>
  );
}

export function FeatureBento({ features, loading }: { features: PublicMarketingFeature[]; loading: boolean }) {
  const marketing = ensureThreeFeatures(loading ? [] : features);
  return (
    <Section className="py-20 sm:py-24" id="recursos">
      <Reveal>
        <SectionHeader eyebrow="Funcionalidades" subtitle="Cards com pesos diferentes para destacar o que realmente organiza a operacao." title="Recursos para operar com controle." />
      </Reveal>
      <StaggerGroup className="mt-12 grid auto-rows-fr gap-4 lg:grid-cols-12">
        {bentoFeatures.map((feature, index) => (
          <StaggerItem className={feature.className} key={feature.title}>
            <GlowCard className="min-h-56 p-7">
              <div className="flex items-start justify-between gap-4">
                <feature.icon className="h-7 w-7 text-[#FFD400]" />
                <span className="core-mono core-voice-rail text-[#5f5f5f]">{String(index + 1).padStart(2, "0")}</span>
              </div>
              <h3 className="core-voice-poster mt-7 text-2xl text-white">{feature.title}</h3>
              <p className="core-voice-body mt-3 max-w-xl text-sm text-[#9b9b9b]">{feature.description}</p>
            </GlowCard>
          </StaggerItem>
        ))}
      </StaggerGroup>
      <StaggerGroup className="mt-4 grid gap-4 md:grid-cols-3">
        {marketing.map((feature) => {
          const Icon = iconForFeature(feature.icon);
          return (
            <StaggerItem key={feature.id}>
              <GlowCard className="p-6">
                <Icon className="h-6 w-6 text-[#FFD400]" />
                <p className="core-voice-rail mt-5 text-[#FFD400]">{feature.category}</p>
                <h3 className="core-voice-poster mt-3 text-lg text-white">{feature.title}</h3>
                <p className="core-voice-body mt-2 text-sm text-[#9b9b9b]">{feature.shortDescription}</p>
              </GlowCard>
            </StaggerItem>
          );
        })}
      </StaggerGroup>
    </Section>
  );
}

export function HowItWorks() {
  return (
    <Section className="py-20 sm:py-24" id="como-funciona">
      <Reveal>
        <SectionHeader eyebrow="Como funciona" subtitle="Um fluxo curto para sair da configuracao inicial e chegar ao controle do ambiente." title="Tres etapas para colocar tudo em operacao." />
      </Reveal>
      <StaggerGroup className="mt-14 grid gap-6 lg:grid-cols-3 lg:gap-0">
        {workflowSteps.map((step, index) => (
          <StaggerItem className="relative min-w-0 lg:px-3" key={step.title}>
            {index < workflowSteps.length - 1 ? <div className="absolute left-[calc(50%+3rem)] right-[-3rem] top-8 hidden h-px bg-gradient-to-r from-[var(--rule-ink)] to-transparent lg:block" /> : null}
            <GlowCard className="relative p-7">
              <span className="core-mono text-5xl font-bold text-[#FFD400]">0{index + 1}</span>
              <h3 className="core-voice-poster mt-8 text-2xl text-white">{step.title}</h3>
              <p className="core-voice-body mt-3 text-sm text-[#9b9b9b]">{step.description}</p>
            </GlowCard>
          </StaggerItem>
        ))}
      </StaggerGroup>
    </Section>
  );
}

export function Benefits() {
  return (
    <Section className="py-20 sm:py-24" id="solucoes">
      <div className="grid gap-10 lg:grid-cols-[.9fr_1.1fr] lg:items-center">
        <Reveal>
          <SectionHeader align="left" eyebrow="Beneficios" subtitle="Menos telas soltas, menos configuracao manual e mais rastreabilidade para cada acao." title="Controle total para operacoes em crescimento." />
        </Reveal>
        <StaggerGroup className="grid gap-3 sm:grid-cols-2">
          {benefitItems.map((item) => (
            <StaggerItem key={item}>
              <GlowCard className="flex h-full items-start gap-3 p-5">
                <Check className="mt-0.5 h-5 w-5 shrink-0 text-[#FFD400]" />
                <p className="core-voice-body text-sm text-[#b5b5b5]">{item}</p>
              </GlowCard>
            </StaggerItem>
          ))}
        </StaggerGroup>
      </div>
    </Section>
  );
}

export function ProductDemo() {
  return (
    <Section className="py-20 sm:py-24" id="demonstracao">
      <div className="grid gap-10 lg:grid-cols-[.8fr_1.2fr] lg:items-center">
        <Reveal>
          <SectionHeader align="left" eyebrow="Controle total" subtitle="Monitoramento de servicos, atividade, usuarios e operacoes em uma interface desenhada para leitura rapida." title="Veja tudo acontecendo em tempo real." />
        </Reveal>
        <Reveal delay={0.1}>
          <GlowCard className="p-6">
            <StaggerGroup className="grid">
              {["Servico conectado", "Nova atividade registrada", "Usuario autenticado", "Sincronizacao concluida"].map((item) => (
                <StaggerItem className="flex items-center justify-between gap-3 border-b border-[var(--rule-soft)] py-4 last:border-b-0" key={item}>
                  <span className="flex min-w-0 items-center gap-3 text-sm font-semibold text-white">
                    <motion.span animate={{ opacity: [1, .35, 1] }} className="h-2 w-2 shrink-0 rounded-full bg-[#FFD400]" transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }} />
                    <span className="truncate">{item}</span>
                  </span>
                  <span className="core-voice-rail text-[#6f6f6f]">agora</span>
                </StaggerItem>
              ))}
            </StaggerGroup>
          </GlowCard>
        </Reveal>
      </div>
    </Section>
  );
}

export function Integrations() {
  return (
    <Section className="py-20 sm:py-24" id="integracoes">
      <Reveal>
        <SectionHeader eyebrow="Integracoes" subtitle="Somente tecnologias e areas existentes no projeto: API, bot Discord, pagamentos, status, logs e banco de dados." title="Conecte suas ferramentas." />
      </Reveal>
      <StaggerGroup className="mx-auto mt-12 grid max-w-5xl gap-4 md:grid-cols-[1fr_auto_1fr] md:items-center">
        <div className="grid gap-4 sm:grid-cols-2">
          {integrationNodes.slice(0, 3).map((node) => <StaggerItem key={node.label}><IntegrationNode {...node} /></StaggerItem>)}
        </div>
        <StaggerItem>
          <motion.div
            animate={{ opacity: [1, 0.76, 1] }}
            className="core-chamfer-outline is-brand core-voice-poster flex h-28 w-full items-center justify-center px-8 text-center text-xl text-black md:h-40 md:w-44"
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          >
            NEXTECH
          </motion.div>
        </StaggerItem>
        <div className="grid gap-4 sm:grid-cols-2">
          {integrationNodes.slice(3).map((node) => <StaggerItem key={node.label}><IntegrationNode {...node} /></StaggerItem>)}
        </div>
      </StaggerGroup>
    </Section>
  );
}

export function Security() {
  return (
    <Section className="py-20 sm:py-24" id="seguranca">
      <div className="grid gap-10 lg:grid-cols-[1fr_.9fr] lg:items-center">
        <Reveal>
          <SectionHeader align="left" eyebrow="Seguranca" subtitle="Permissoes, logs e isolamento por servidor continuam no backend e no banco, sem depender apenas da interface." title="Sua operacao. Sob controle." />
        </Reveal>
        <Reveal delay={0.1}>
          <GlowCard className="p-7">
            <div className="core-chamfer-outline core-screen mx-auto flex aspect-square max-w-64 flex-col items-center justify-center text-center [--cbf:var(--stock-3)] [--cbo:rgba(255,212,0,.3)]">
              <ShieldCheck className="h-16 w-16 text-[#FFD400]" />
              <p className="core-voice-rail mt-5 text-[#7a7a7a]">Escudo</p>
              <p className="core-voice-poster mt-2 text-2xl text-white">Protegido</p>
            </div>
            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              {securityItems.map((item) => (
                <p className="core-voice-body flex items-center gap-3 text-sm text-[#b5b5b5]" key={item}>
                  <Check className="h-4 w-4 shrink-0 text-[#FFD400]" />
                  {item}
                </p>
              ))}
            </div>
          </GlowCard>
        </Reveal>
      </div>
    </Section>
  );
}

export function Pricing({ plans }: { onNavigate: (id: string) => void; plans: Plan[] }) {
  const visiblePlans = plans.filter((plan) => plan.isPublic && plan.isActive).slice(0, 3);
  return (
    <Section className="py-20 sm:py-24" id="planos">
      <Reveal>
        <SectionHeader eyebrow="Planos" subtitle="Os valores abaixo vêm dos planos públicos cadastrados no sistema." title="Escolha o plano correto para sua operacao." />
      </Reveal>
      {visiblePlans.length ? (
        <StaggerGroup className="mt-12 grid gap-4 lg:grid-cols-3">
          {visiblePlans.map((plan) => <StaggerItem key={plan.id}><PlanCard plan={plan} /></StaggerItem>)}
        </StaggerGroup>
      ) : (
        <Reveal>
          <GlowCard className="mx-auto mt-12 max-w-2xl p-7 text-center">
            <p className="core-voice-body text-sm text-[#9b9b9b]">Nenhum plano publico ativo foi encontrado agora. A pagina de planos continua disponivel para consulta.</p>
          </GlowCard>
        </Reveal>
      )}
      <div className="mt-10 text-center">
        <HomeButton href="/planos">Ver todos os planos <ArrowRight className="h-4 w-4" /></HomeButton>
      </div>
    </Section>
  );
}

export function Faq() {
  return (
    <Section className="py-20 sm:py-24" id="faq">
      <Reveal>
        <SectionHeader eyebrow="FAQ" subtitle="Respostas curtas sobre acesso, suporte e funcionamento geral." title="Perguntas frequentes." />
      </Reveal>
      <Reveal className="core-chamfer-outline mx-auto mt-10 max-w-3xl px-6 sm:px-8" delay={0.1}>
        {faqItems.map((item) => <FaqItem key={item.question} {...item} />)}
      </Reveal>
    </Section>
  );
}

export function FinalCta({ onStart, startLabel, verifying }: Pick<ActionProps, "onStart" | "startLabel" | "verifying">) {
  return (
    <Section className="py-20 sm:py-24">
      <Reveal>
        <div className="core-chamfer-outline core-screen px-6 py-16 text-center [--cbo:rgba(255,212,0,.34)] [--chamfer-cut:22px] sm:px-10">
          <p className="core-voice-rail text-[#FFD400]">Pronto para comecar?</p>
          <h2 className="core-voice-poster mx-auto mt-5 max-w-3xl text-balance text-4xl text-white sm:text-5xl">Centralize sua operacao com a NexTech.</h2>
          <div className="mt-9">
            <HomeButton onClick={onStart}>{verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}{startLabel}</HomeButton>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}

export function Footer({ currentYear, onNavigate }: { currentYear: number; onNavigate: (id: string) => void }) {
  return (
    <footer className="core-theme w-full border-t border-[var(--rule)] bg-[var(--stock)] py-14">
      <div className="mx-auto grid w-full max-w-[1560px] gap-8 px-[var(--core-margin)] md:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <button className="core-voice-poster text-left text-2xl text-white" onClick={() => onNavigate("inicio")} type="button">NexTech</button>
          <p className="core-voice-body mt-4 max-w-sm text-sm text-[#8a8a8a]">Uma plataforma para simplificar sua operacao.</p>
        </div>
        <FooterColumn links={[["Plataforma", "produto"], ["Recursos", "recursos"], ["Precos", "planos"]]} onNavigate={onNavigate} title="Produto" />
        <FooterColumn links={[["Sobre", "inicio"], ["Contato", "suporte"]]} onNavigate={onNavigate} title="Empresa" />
        <FooterColumn links={[["Documentacao", "docs"], ["Suporte", "suporte"], ["Status", "status"]]} onNavigate={onNavigate} title="Recursos" />
      </div>
      <div className="core-voice-rail mx-auto mt-12 flex w-full max-w-[1560px] flex-col gap-3 border-t border-[var(--rule-soft)] px-[var(--core-margin)] pt-7 text-[#6f6f6f] md:flex-row md:items-center md:justify-between">
        <span>© {currentYear} NexTech. Todos os direitos reservados.</span>
        <button className="w-fit text-left text-[#8a8a8a] transition-colors hover:text-[#FFD400]" onClick={() => onNavigate("termos")} type="button">Termos e privacidade</button>
      </div>
    </footer>
  );
}

export function ConnectedServers({ state }: { state: ServerState }) {
  const data = state.value;
  if (state.loading) {
    return <Section className="border-y border-[var(--rule)] py-10"><p className="core-voice-rail text-center text-[#7a7a7a]">Carregando servidores conectados...</p></Section>;
  }
  if (state.error || !data?.servers.length) {
    return <Section className="border-y border-[var(--rule)] py-10"><p className="core-voice-rail text-center text-[#7a7a7a]">Servidores conectados serao exibidos quando houver dados publicos disponiveis.</p></Section>;
  }
  return (
    <Section className="border-y border-[var(--rule)] py-10">
      <StaggerGroup className="grid gap-4 md:grid-cols-3 xl:grid-cols-4">
        {data.servers.slice(0, 8).map((server) => <StaggerItem key={server.guildId}><ServerCard server={server} /></StaggerItem>)}
      </StaggerGroup>
    </Section>
  );
}

function IntegrationNode({ icon: Icon, label }: { icon: typeof Bot; label: string }) {
  return (
    <GlowCard className="flex min-h-24 items-center gap-3 p-5">
      <Icon className="h-5 w-5 shrink-0 text-[#FFD400]" />
      <span className="core-voice-caption min-w-0 truncate text-white">{label}</span>
    </GlowCard>
  );
}

function PlanCard({ plan }: { plan: Plan }) {
  const price = plan.promotionalPriceInCents ?? plan.priceInCents;
  const features = plan.entitlements.filter((item) => item.enabled).slice(0, 4);
  return (
    <GlowCard className={`flex min-h-full flex-col p-7 ${plan.isRecommended ? "[--cbo:rgba(255,212,0,.55)]" : ""}`}>
      <div className="flex min-h-8 items-start justify-between gap-3">
        <p className="core-voice-rail text-[#FFD400]">{plan.badge || "Plano"}</p>
        {plan.isRecommended ? <span className="core-chamfer-sm core-voice-rail bg-[#FFD400] px-2.5 py-1.5 text-black">Recomendado</span> : null}
      </div>
      <h3 className="core-voice-poster mt-5 text-2xl text-white">{plan.name}</h3>
      <p className="core-voice-body mt-3 min-h-14 text-sm text-[#9b9b9b]">{plan.shortDescription || plan.description}</p>
      <div className="mt-6 border-y border-[var(--rule-soft)] py-5">
        <span className="core-mono text-4xl font-bold text-white">{formatPrice(price, plan.currency)}</span>
        <span className="core-voice-rail ml-2 text-[#7a7a7a]">{cycleSuffix(plan.billingCycle)}</span>
      </div>
      <ul className="mt-6 grid flex-1 gap-3">
        {features.map((feature) => (
          <li className="core-voice-body flex gap-3 text-sm text-[#b5b5b5]" key={feature.key}>
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
    <GlowCard className="flex min-w-0 items-center gap-4 p-5">
      <div className="core-chamfer-sm flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden bg-[var(--stock-3)]">
        {server.iconUrl ? <img alt="" className="h-full w-full object-cover" loading="lazy" src={server.iconUrl} /> : <Server className="h-5 w-5 text-[#FFD400]" />}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-white">{server.name}</p>
        <p className="core-mono core-voice-rail mt-1.5 truncate text-[#7a7a7a]">{server.memberCount.toLocaleString("pt-BR")} membros</p>
      </div>
    </GlowCard>
  );
}

function FooterColumn({ links, onNavigate, title }: { links: Array<[string, string]>; onNavigate: (id: string) => void; title: string }) {
  return (
    <div>
      <h3 className="core-voice-rail text-white">{title}</h3>
      <div className="mt-5 grid gap-3">
        {links.map(([label, id]) => (
          <button className="w-fit text-left text-sm text-[#8a8a8a] transition-colors hover:text-[#FFD400]" key={`${title}-${label}`} onClick={() => onNavigate(id)} type="button">
            {label === "Status" ? <span className="inline-flex items-center gap-1">{label}<ExternalLink className="h-3 w-3" /></span> : label}
          </button>
        ))}
      </div>
    </div>
  );
}

export { MONITORING_STATUS_URL };
