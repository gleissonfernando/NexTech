import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import {
  Activity, ArrowRight, Bot, Boxes, Braces, Check, CheckCircle2, Cloud,
  Database, Gauge, GitBranch, Globe2, KeyRound, LockKeyhole, Radio,
  Server, ShieldCheck, Sparkles, Webhook, Workflow, Zap
} from "lucide-react";
import { ComoFunciona } from "./ComoFunciona";

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
  { icon: Workflow, title: "Automação inteligente", text: "Reduza tarefas repetitivas com fluxos claros e ações centralizadas." },
  { icon: Bot, title: "Gerenciamento de bots", text: "Acompanhe comandos, permissões, eventos e status em um único painel." },
  { icon: Braces, title: "APIs e integrações", text: "Conecte serviços externos com uma operação organizada e rastreável." },
  { icon: Activity, title: "Monitoramento em tempo real", text: "Visualize eventos importantes e identifique rapidamente o que exige atenção." },
  { icon: ShieldCheck, title: "Segurança e permissões", text: "Controle acessos e funções de acordo com a estrutura da sua organização." },
  { icon: Cloud, title: "Infraestrutura escalável", text: "Organize sua operação para crescer sem perder visibilidade e controle." }
];

const integrations = [
  { icon: Bot, label: "Bots" }, { icon: Webhook, label: "Webhooks" },
  { icon: Braces, label: "API REST" }, { icon: Database, label: "Dados" },
  { icon: GitBranch, label: "Código" }, { icon: Cloud, label: "Nuvem" }
];

export function DashboardHome(props: DashboardHomeProps) {
  const reducedMotion = useReducedMotion();
  const featuredModules = props.modules.slice(0, 6);

  return (
    <div className="nex-tech-home -mx-4 overflow-hidden px-4 pb-8 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <section className="relative isolate overflow-hidden rounded-[1.75rem] border border-violet-400/15 bg-[#070711] px-5 py-12 shadow-[0_35px_100px_rgba(0,0,0,.45)] sm:px-10 sm:py-16 xl:px-14">
        <GlowBackground />
        <div className="relative grid items-center gap-12 xl:grid-cols-[1.02fr_.98fr]">
          <motion.div initial={reducedMotion ? false : { opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .65 }}>
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-1.5 text-xs font-medium text-violet-200">
              <Sparkles className="h-3.5 w-3.5" /> Automação, integrações e gestão em um só lugar
            </div>
            <h1 className="mt-6 max-w-3xl text-4xl font-bold tracking-[-.045em] text-white sm:text-5xl xl:text-6xl">
              Transforme sua operação com a <span className="nex-tech-gradient-text">tecnologia da Nex Tech</span>
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-400 sm:text-lg">
              Centralize bots, serviços e automações em uma plataforma rápida, organizada e preparada para acompanhar seu crescimento.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a className="nex-tech-primary-button" href="#solucoes">Explorar soluções <ArrowRight className="h-4 w-4" /></a>
              <a className="nex-tech-secondary-button" href="#recursos">Conhecer recursos</a>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-xs text-slate-400">
              {["Acesso centralizado", "Visibilidade em tempo real", "Configuração por módulos"].map((item) => (
                <span className="flex items-center gap-2" key={item}><CheckCircle2 className="h-4 w-4 text-violet-400" />{item}</span>
              ))}
            </div>
          </motion.div>
          <PlatformPreview {...props} />
        </div>
      </section>

      <Reveal className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <TrustItem icon={Radio} title="Operação conectada" text={props.botOnline ? "Bot selecionado online" : "Status acompanhado pelo painel"} />
        <TrustItem icon={LockKeyhole} title="Acesso controlado" text="Sessões e permissões centralizadas" />
        <TrustItem icon={Gauge} title="Visão imediata" text={`${props.activeModules} módulos ativos agora`} />
        <TrustItem icon={Server} title="Contexto isolado" text="Configuração por bot e servidor" />
      </Reveal>

      <section className="home-section" id="solucoes">
        <SectionHeading eyebrow="Soluções" title="Tudo o que sua operação precisa" text="Ferramentas que trabalham juntas para reduzir complexidade e ampliar seu controle." />
        <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {solutions.map((item, index) => <SolutionCard index={index} key={item.title} {...item} />)}
        </div>
      </section>

      <section className="home-section" id="recursos">
        <SectionHeading eyebrow="Recursos" title="Controle sem perder simplicidade" text="Uma experiência construída para tornar operações complexas mais fáceis de entender." />
        <div className="mt-10 grid gap-5 xl:grid-cols-3">
          <Feature icon={Boxes} title="Controle completo" text="Bots, servidores e módulos organizados no mesmo ambiente." bullets={["Visão centralizada", "Ações contextuais", "Navegação consistente"]} />
          <Feature icon={Zap} title="Fluxos eficientes" text="Configure recursos com menos etapas e mais clareza." bullets={["Configuração modular", "Estados visíveis", "Rotinas automatizadas"]} />
          <Feature icon={Activity} title="Dados atuais" text="Acompanhe sinais relevantes da sua operação conforme acontecem." bullets={["Status dos serviços", "Atividades recentes", "Indicadores essenciais"]} />
        </div>
      </section>

      <Reveal className="rounded-[1.75rem] border border-white/[.07] bg-white/[.025] p-6 sm:p-8">
        <div className="grid gap-7 sm:grid-cols-2 xl:grid-cols-4">
          <Stat value={props.memberCount} suffix="" label="membros no servidor" />
          <Stat value={props.channelCount} suffix="" label="canais acompanhados" />
          <Stat value={props.activeModules} suffix={`/${props.totalModules}`} label="módulos ativos" />
          <Stat value={props.botOnline ? 100 : 0} suffix="%" label="bot disponível agora" />
        </div>
      </Reveal>

      <ComoFunciona />

      <section className="home-section grid items-center gap-10 xl:grid-cols-2">
        <div>
          <SectionHeading align="left" eyebrow="Integrações" title="Conecte as peças da sua operação" text="A Nex Tech reúne diferentes pontos de contato em um fluxo visual e centralizado." />
          <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {integrations.map(({ icon: ItemIcon, label }) => <div className="flex items-center gap-3 rounded-xl border border-white/[.07] bg-white/[.025] p-3 text-sm text-slate-300" key={label}><ItemIcon className="h-4 w-4 text-violet-400" />{label}</div>)}
          </div>
        </div>
        <IntegrationVisual />
      </section>

      <section className="home-section grid gap-6 xl:grid-cols-[.9fr_1.1fr]">
        <Reveal className="rounded-[1.75rem] border border-emerald-400/15 bg-gradient-to-br from-emerald-400/[.07] to-violet-500/[.05] p-7 sm:p-9">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-300/20 bg-emerald-400/10"><ShieldCheck className="h-7 w-7 text-emerald-300" /></div>
          <h2 className="mt-6 text-2xl font-bold text-white sm:text-3xl">Segurança em todos os níveis</h2>
          <p className="mt-3 leading-7 text-slate-400">Controles pensados para reduzir exposição e manter cada ação no contexto correto.</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">{["Proteção de sessões", "Controle de acesso", "Logs de atividades", "Validação de requisições", "Permissões por função", "Monitoramento contínuo"].map(item => <span className="flex items-center gap-2 text-sm text-slate-300" key={item}><Check className="h-4 w-4 text-emerald-300" />{item}</span>)}</div>
        </Reveal>
        <Reveal className="rounded-[1.75rem] border border-white/[.07] bg-[#090914] p-5 sm:p-7">
          <div className="flex items-center justify-between border-b border-white/[.07] pb-4"><div><p className="text-sm font-semibold text-white">Centro de proteção</p><p className="mt-1 text-xs text-slate-500">Visão operacional</p></div><span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs text-emerald-300">Monitorado</span></div>
          <div className="mt-5 space-y-3">{[[KeyRound,"Sessão autenticada","Acesso verificado"],[ShieldCheck,"Escopo do servidor","Contexto isolado"],[LockKeyhole,"Credenciais privadas","Mantidas no backend"]].map(([ItemIcon,title,text]) => { const C = ItemIcon as Icon; return <div className="flex items-center gap-4 rounded-xl border border-white/[.06] bg-white/[.025] p-4" key={String(title)}><C className="h-5 w-5 text-emerald-300"/><div><p className="text-sm font-medium text-white">{String(title)}</p><p className="mt-1 text-xs text-slate-500">{String(text)}</p></div></div>})}</div>
        </Reveal>
      </section>

      {featuredModules.length ? <section className="home-section"><SectionHeading eyebrow="Seu ambiente" title="Módulos disponíveis" text="Acesse rapidamente as ferramentas liberadas para este bot." /><div className="mt-9 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{featuredModules.map(({ icon: ModuleIcon, ...module }) => <button className="group flex min-h-32 items-start gap-4 rounded-2xl border border-white/[.07] bg-white/[.025] p-5 text-left transition hover:-translate-y-1 hover:border-violet-400/30 hover:bg-violet-400/[.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400" key={module.id} onClick={module.onOpen} type="button"><span className="rounded-xl bg-violet-400/10 p-2.5 text-violet-300"><ModuleIcon className="h-5 w-5" /></span><span><strong className="text-sm text-white">{module.title}</strong><span className="mt-2 block text-xs leading-5 text-slate-500">{module.description}</span></span><ArrowRight className="ml-auto h-4 w-4 text-slate-600 transition group-hover:translate-x-1 group-hover:text-violet-300" /></button>)}</div></section> : null}

      <Reveal className="relative overflow-hidden rounded-[1.75rem] border border-violet-300/15 bg-gradient-to-br from-violet-600/20 via-[#111126] to-blue-500/10 p-8 text-center sm:p-12">
        <div className="absolute inset-0 nex-tech-grid opacity-30" />
        <div className="relative"><p className="text-xs font-semibold uppercase tracking-[.25em] text-violet-300">Continue sua jornada</p><h2 className="mx-auto mt-4 max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl">Leve sua operação para o próximo nível</h2><p className="mx-auto mt-4 max-w-xl text-slate-400">Explore os módulos disponíveis e configure a Nex Tech para o seu fluxo de trabalho.</p><a className="nex-tech-primary-button mt-7 inline-flex" href="#solucoes">Ver possibilidades <ArrowRight className="h-4 w-4" /></a></div>
      </Reveal>
      <footer className="flex flex-col gap-3 px-2 pb-2 pt-8 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between"><p>© {new Date().getFullYear()} Nex Tech. Operação centralizada.</p><span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${props.botOnline ? "bg-emerald-400" : "bg-slate-600"}`} />{props.botOnline ? "Bot conectado" : "Status indisponível"}</span></footer>
    </div>
  );
}

function GlowBackground() { return <div aria-hidden className="pointer-events-none absolute inset-0"><div className="absolute -left-32 -top-40 h-96 w-96 rounded-full bg-violet-600/20 blur-3xl"/><div className="absolute -right-28 top-10 h-80 w-80 rounded-full bg-blue-600/15 blur-3xl"/><div className="nex-tech-grid absolute inset-0 opacity-30"/></div> }

function PlatformPreview(props: DashboardHomeProps) { return <motion.div className="relative" initial={{ opacity: 0, scale: .96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: .7, delay: .15 }}><div className="absolute -inset-4 rounded-[2rem] bg-violet-500/10 blur-2xl"/><div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#090913]/95 shadow-2xl"><div className="flex items-center gap-2 border-b border-white/[.07] px-4 py-3"><i className="h-2.5 w-2.5 rounded-full bg-rose-400/70"/><i className="h-2.5 w-2.5 rounded-full bg-amber-300/70"/><i className="h-2.5 w-2.5 rounded-full bg-emerald-400/70"/><span className="ml-2 text-[10px] text-slate-600">nex-tech / operação</span></div><div className="grid grid-cols-[62px_1fr] sm:grid-cols-[88px_1fr]"><div className="border-r border-white/[.06] p-3"><div className="mx-auto h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500 to-blue-500"/><div className="mt-6 space-y-3">{[1,2,3,4,5].map(i=><div className={`mx-auto h-7 rounded-md ${i===1 ? "bg-violet-400/15" : "bg-white/[.04]"}`} key={i}/>)}</div></div><div className="min-w-0 p-4 sm:p-5"><div className="flex items-center justify-between"><div><p className="text-xs text-slate-500">Servidor atual</p><p className="mt-1 max-w-40 truncate text-sm font-semibold text-white">{props.guildName}</p></div><span className={`rounded-full px-2 py-1 text-[10px] ${props.botOnline ? "bg-emerald-400/10 text-emerald-300" : "bg-slate-400/10 text-slate-400"}`}>{props.botOnline ? "Online" : "Offline"}</span></div><div className="mt-5 grid grid-cols-2 gap-2"><MiniMetric label="Membros" value={compact(props.memberCount)}/><MiniMetric label="Módulos" value={`${props.activeModules}/${props.totalModules}`}/></div><div className="mt-3 rounded-xl border border-white/[.06] bg-white/[.02] p-3"><div className="flex items-end gap-1.5">{[32,48,40,68,54,78,62,88,72,92,84,96].map((height,i)=><motion.i className="flex-1 rounded-t bg-gradient-to-t from-violet-600/30 to-violet-400/80" initial={{height:4}} animate={{height}} transition={{duration:.5,delay:.25+i*.035}} key={i}/>)}</div><div className="mt-3 flex justify-between text-[9px] text-slate-600"><span>Atividade</span><span>Tempo real</span></div></div><div className="mt-3 space-y-2">{["Serviços sincronizados","Permissões verificadas"].map((item,i)=><div className="flex items-center gap-2 rounded-lg bg-white/[.025] px-3 py-2 text-[10px] text-slate-400" key={item}><span className={`h-1.5 w-1.5 rounded-full ${i ? "bg-blue-400" : "bg-emerald-400"}`}/>{item}</div>)}</div></div></div></div></motion.div> }
function MiniMetric({label,value}:{label:string;value:string}) { return <div className="rounded-xl border border-white/[.06] bg-white/[.025] p-3"><p className="text-[9px] text-slate-600">{label}</p><p className="mt-1 text-lg font-semibold text-white">{value}</p></div> }
function TrustItem({icon:Icon,title,text}:{icon:Icon;title:string;text:string}) { return <div className="flex items-center gap-3 rounded-2xl border border-white/[.07] bg-white/[.025] p-4"><span className="rounded-xl bg-violet-400/10 p-2.5 text-violet-300"><Icon className="h-5 w-5"/></span><div><p className="text-sm font-medium text-white">{title}</p><p className="mt-1 text-xs text-slate-500">{text}</p></div></div> }
function SectionHeading({align="center",eyebrow,title,text}:{align?:"left"|"center";eyebrow:string;title:string;text:string}) { return <Reveal className={align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-xl"}><p className="text-xs font-semibold uppercase tracking-[.25em] text-violet-400">{eyebrow}</p><h2 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">{title}</h2><p className="mt-4 leading-7 text-slate-400">{text}</p></Reveal> }
function SolutionCard({icon:Icon,title,text,index}:{icon:Icon;title:string;text:string;index:number}) { return <Reveal delay={index*.05} className="group rounded-2xl border border-white/[.07] bg-gradient-to-br from-white/[.04] to-transparent p-6 transition duration-300 hover:-translate-y-1 hover:border-violet-400/25 hover:shadow-[0_20px_60px_rgba(76,29,149,.15)]"><span className="inline-flex rounded-xl border border-violet-400/15 bg-violet-400/10 p-3 text-violet-300"><Icon className="h-5 w-5"/></span><h3 className="mt-5 font-semibold text-white">{title}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{text}</p></Reveal> }
function Feature({icon:Icon,title,text,bullets}:{icon:Icon;title:string;text:string;bullets:string[]}) { return <Reveal className="rounded-[1.5rem] border border-white/[.07] bg-[#0a0a15] p-6 sm:p-7"><Icon className="h-7 w-7 text-violet-400"/><h3 className="mt-6 text-xl font-semibold text-white">{title}</h3><p className="mt-3 text-sm leading-6 text-slate-400">{text}</p><ul className="mt-6 space-y-3">{bullets.map(item=><li className="flex items-center gap-2 text-sm text-slate-300" key={item}><Check className="h-4 w-4 text-violet-400"/>{item}</li>)}</ul></Reveal> }
function Stat({value,suffix,label}:{value:number;suffix:string;label:string}) { const ref=useRef<HTMLDivElement>(null); const visible=useInView(ref,{once:true,margin:"-50px"}); const reduced=useReducedMotion(); const [shown,setShown]=useState(0); useEffect(()=>{if(!visible)return;if(reduced){setShown(value);return}let frame=0;const started=performance.now();const tick=(now:number)=>{const progress=Math.min((now-started)/900,1);setShown(Math.round(value*(1-Math.pow(1-progress,3))));if(progress<1)frame=requestAnimationFrame(tick)};frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame)},[reduced,value,visible]); return <div ref={ref}><p className="text-3xl font-bold tracking-tight text-white sm:text-4xl">{shown.toLocaleString("pt-BR")}{suffix}</p><p className="mt-2 text-sm text-slate-500">{label}</p></div> }
function IntegrationVisual() { return <Reveal className="relative mx-auto flex min-h-80 w-full max-w-xl items-center justify-center overflow-hidden rounded-[1.75rem] border border-white/[.07] bg-[#090914]"><div className="nex-tech-grid absolute inset-0 opacity-25"/><div className="absolute h-56 w-56 rounded-full border border-violet-400/15"/><div className="absolute h-40 w-40 rounded-full border border-blue-400/15"/>{integrations.map(({icon:Icon,label},i)=>{const angle=(Math.PI*2*i)/integrations.length;const y=Math.sin(angle)*105;return <motion.div className="absolute flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-[#101020] text-violet-300 shadow-lg" style={{x:Math.cos(angle)*105}} animate={{y:[y,y-5,y]}} transition={{duration:3+i*.2,repeat:Infinity,ease:"easeInOut"}} title={label} key={label}><Icon className="h-5 w-5"/></motion.div>})}<div className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-blue-600 shadow-[0_0_45px_rgba(124,58,237,.35)]"><Globe2 className="h-9 w-9 text-white"/></div></Reveal> }
function Reveal({children,className="",delay=0}:{children:ReactNode;className?:string;delay?:number}) { const reduced=useReducedMotion(); return <motion.div className={className} initial={reduced?false:{opacity:0,y:20}} whileInView={{opacity:1,y:0}} viewport={{once:true,amount:.12}} transition={{duration:.55,delay,ease:"easeOut"}}>{children}</motion.div> }
function compact(value:number) { return new Intl.NumberFormat("pt-BR",{notation:"compact",maximumFractionDigits:1}).format(value) }
