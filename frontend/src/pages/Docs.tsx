import {
  ArrowLeft, Bot, BookOpen, Boxes, ChevronRight, CircleHelp, Code2,
  KeyRound, Menu, Search, ShieldCheck, Terminal, X
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

type NavigationGroup = { group: string; items: readonly (readonly [string, string])[] };

const navigation: readonly NavigationGroup[] = [
  { group: "Introdução", items: [["Visão geral", "visao-geral"], ["Primeiros passos", "primeiros-passos"]] },
  { group: "Dashboard", items: [["Acesso com Discord", "acesso"], ["Bots e servidores", "bots-servidores"], ["Módulos", "modulos"], ["Permissões", "permissoes"]] },
  { group: "Desenvolvedores", items: [["Integrações seguras", "integracoes"], ["Tratamento de erros", "erros"]] }
];

export function DocsPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState("visao-geral");
  const visibleNavigation = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    if (!normalized) return navigation;
    return navigation.map((section) => ({
      ...section,
      items: section.items.filter(([label]) => label.toLocaleLowerCase("pt-BR").includes(normalized))
    })).filter((section) => section.items.length);
  }, [query]);

  useEffect(() => {
    const sections = navigation.flatMap((group) => group.items).map(([, id]) => document.getElementById(id)).filter(Boolean) as HTMLElement[];
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.find((entry) => entry.isIntersecting);
      if (visible?.target.id) setActiveId(visible.target.id);
    }, { rootMargin: "-20% 0px -65%", threshold: 0 });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  function navigate(id: string) {
    setMenuOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <main className="min-h-screen bg-[#080808] text-zinc-100">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-[#FFD500]/15 bg-[#090909]/95 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[90rem] items-center gap-4 px-4 sm:px-6">
          <a className="flex items-center gap-2" href="/">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#FFD500]/30 bg-[#FFD500]/10 text-[#FFD500]"><Bot className="h-5 w-5" /></span>
            <strong className="text-lg text-[#FFD500]">Orvitek</strong><span className="hidden text-sm text-zinc-500 sm:inline">/ Documentação</span>
          </a>
          <div className="ml-auto hidden max-w-sm flex-1 items-center gap-2 rounded-lg border border-white/10 bg-white/[.035] px-3 md:flex">
            <Search className="h-4 w-4 text-zinc-500" /><input aria-label="Buscar na documentação" className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-zinc-600" onChange={(event) => setQuery(event.target.value)} placeholder="Buscar na documentação..." value={query} />
          </div>
          <a className="hidden items-center gap-2 rounded-lg border border-[#FFD500]/25 px-3 py-2 text-sm text-[#FFEA70] transition hover:bg-[#FFD500]/10 sm:flex" href="/"><ArrowLeft className="h-4 w-4" />Voltar ao site</a>
          <button aria-label={menuOpen ? "Fechar menu" : "Abrir menu"} className="ml-auto rounded-lg border border-white/10 p-2 md:hidden" onClick={() => setMenuOpen((current) => !current)} type="button">{menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
        </div>
      </header>

      <div className="mx-auto flex max-w-[90rem] pt-16">
        <aside className={`${menuOpen ? "fixed inset-x-0 bottom-0 top-16 z-40 block" : "hidden"} w-72 shrink-0 overflow-y-auto border-r border-white/[.07] bg-[#090909] p-5 md:sticky md:top-16 md:block md:h-[calc(100vh-4rem)]`}>
          <div className="mb-5 flex items-center gap-2 rounded-lg border border-white/10 bg-white/[.035] px-3 md:hidden"><Search className="h-4 w-4 text-zinc-500" /><input aria-label="Buscar na documentação" className="h-10 w-full bg-transparent text-sm outline-none" onChange={(event) => setQuery(event.target.value)} placeholder="Buscar..." value={query} /></div>
          <DocsNavigation activeId={activeId} groups={visibleNavigation} onNavigate={navigate} />
        </aside>

        <article className="min-w-0 flex-1 px-5 py-12 sm:px-8 lg:px-14">
          <div className="mx-auto max-w-4xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#FFD500]/20 bg-[#FFD500]/10 px-3 py-1.5 text-xs text-[#FFEA70]"><BookOpen className="h-3.5 w-3.5" />Documentação oficial</div>
            <h1 className="mt-5 text-4xl font-black tracking-tight text-white sm:text-5xl">Documentação Orvitek</h1>
            <p className="mt-5 max-w-3xl text-lg leading-8 text-zinc-400">Aprenda a acessar a plataforma, organizar seus bots e configurar módulos com segurança.</p>

            <DocsSection icon={BookOpen} id="visao-geral" title="Visão geral">
              <p>A Orvitek centraliza a administração de bots Discord, servidores, módulos e permissões. Cada configuração é vinculada ao bot e ao servidor selecionados para evitar alterações no contexto errado.</p>
              <Callout icon={ShieldCheck} title="Documentação segura">Esta página nunca exibe tokens, chaves privadas, IDs pessoais ou variáveis do ambiente de produção.</Callout>
            </DocsSection>

            <DocsSection icon={Terminal} id="primeiros-passos" title="Primeiros passos">
              <Step number="1" title="Entre com Discord">Use o botão Dashboard no site e conclua a autenticação oficial do Discord.</Step>
              <Step number="2" title="Selecione o bot e o servidor">Confira sempre o contexto exibido no topo antes de alterar qualquer módulo.</Step>
              <Step number="3" title="Configure somente o necessário">Ative recursos liberados para sua operação e revise canais e permissões antes de publicar painéis.</Step>
            </DocsSection>

            <DocsSection icon={KeyRound} id="acesso" title="Acesso com Discord">
              <p>O login utiliza OAuth2. A senha da sua conta Discord não passa pela Orvitek. Depois da autenticação, a plataforma valida se sua conta possui acesso à organização e aos servidores disponíveis.</p>
              <SafeCode title="Fluxo de acesso" code={`Site Orvitek\n  → Discord OAuth2\n  → validação da sessão\n  → seleção do bot\n  → dashboard autorizado`} />
            </DocsSection>

            <DocsSection icon={Bot} id="bots-servidores" title="Bots e servidores">
              <p>As configurações são isoladas por Bot ID e servidor. Alterar o bot selecionado muda o contexto de todos os módulos exibidos na dashboard.</p>
              <ul className="mt-4 space-y-2">{["Confirme o nome e o avatar do bot.", "Confirme o servidor selecionado.", "Verifique se o bot está online.", "Não reutilize tokens entre aplicações."].map((item) => <ListItem key={item}>{item}</ListItem>)}</ul>
            </DocsSection>

            <DocsSection icon={Boxes} id="modulos" title="Módulos">
              <p>Os módulos disponíveis dependem do plano, da liberação administrativa e das permissões do bot. Exemplos incluem moderação, tickets, logs, cursos, FiveM, RH e integrações sociais.</p>
              <Callout icon={CircleHelp} title="Um módulo não aparece?">Verifique a liberação do bot, o servidor selecionado e o status da licença. Reiniciar o bot só é necessário quando a própria interface solicitar.</Callout>
            </DocsSection>

            <DocsSection icon={ShieldCheck} id="permissoes" title="Permissões">
              <p>A Orvitek respeita as permissões do Discord e os cargos configurados em cada módulo. Para administrar cargos ou mensagens, o cargo do bot precisa estar acima dos cargos gerenciados.</p>
              <SafeCode title="Checklist" code={`✓ Ver canal\n✓ Enviar mensagens\n✓ Incorporar links\n✓ Ler histórico\n✓ Gerenciar cargos (quando necessário)`} />
            </DocsSection>

            <DocsSection icon={Code2} id="integracoes" title="Integrações seguras">
              <p>Credenciais privadas devem existir apenas no backend ou no ambiente protegido da hospedagem. Nunca coloque segredos em componentes React, variáveis públicas do Vite ou exemplos enviados ao navegador.</p>
              <SafeCode title="Exemplo conceitual" code={`// Navegador: solicita uma ação ao seu backend\nawait client.post("/api/recurso", { acao: "executar" });\n\n// Backend: usa a credencial protegida no servidor\nconst segredo = process.env.SEGREDO_PRIVADO;`} />
              <Callout icon={KeyRound} title="Use placeholders">Em tutoriais e capturas, represente credenciais como &lt;SEU_TOKEN&gt;. Nunca cole o valor real.</Callout>
            </DocsSection>

            <DocsSection icon={CircleHelp} id="erros" title="Tratamento de erros">
              <p>Se uma interação falhar, confirme primeiro se o bot está online, se possui acesso ao canal e se o módulo está liberado. Registre o horário da falha para localizar o evento nos logs sem compartilhar credenciais.</p>
            </DocsSection>
          </div>
        </article>
      </div>
    </main>
  );
}

function DocsNavigation({ activeId, groups, onNavigate }: { activeId: string; groups: readonly NavigationGroup[]; onNavigate: (id: string) => void }) { return <nav aria-label="Documentação" className="space-y-6">{groups.map((group) => <div key={group.group}><p className="mb-2 px-3 text-xs font-bold uppercase tracking-[.18em] text-zinc-600">{group.group}</p><div className="space-y-1">{group.items.map(([label,id]) => <button className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition ${activeId===id ? "bg-[#FFD500]/10 text-[#FFEA70]" : "text-zinc-400 hover:bg-white/[.04] hover:text-white"}`} key={id} onClick={() => onNavigate(id)} type="button">{label}<ChevronRight className="h-3.5 w-3.5" /></button>)}</div></div>)}</nav> }
function DocsSection({ children, icon: Icon, id, title }: { children: ReactNode; icon: typeof BookOpen; id: string; title: string }) { return <section className="scroll-mt-24 border-b border-white/[.07] py-12 text-sm leading-7 text-zinc-400" id={id}><div className="mb-5 flex items-center gap-3"><span className="rounded-lg border border-[#FFD500]/20 bg-[#FFD500]/10 p-2 text-[#FFD500]"><Icon className="h-5 w-5" /></span><h2 className="text-2xl font-bold text-white">{title}</h2></div>{children}</section> }
function Step({ children, number, title }: { children: ReactNode; number: string; title: string }) { return <div className="mt-4 flex gap-4 rounded-xl border border-white/[.07] bg-white/[.025] p-4"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#FFD500] text-xs font-black text-black">{number}</span><div><h3 className="font-semibold text-white">{title}</h3><p className="mt-1">{children}</p></div></div> }
function Callout({ children, icon: Icon, title }: { children: ReactNode; icon: typeof BookOpen; title: string }) { return <div className="mt-6 flex gap-3 rounded-xl border border-[#FFD500]/20 bg-[#FFD500]/[.06] p-4"><Icon className="mt-0.5 h-5 w-5 shrink-0 text-[#FFD500]" /><div><strong className="text-zinc-100">{title}</strong><p className="mt-1">{children}</p></div></div> }
function SafeCode({ code, title }: { code: string; title: string }) { return <div className="mt-6 overflow-hidden rounded-xl border border-white/10 bg-black"><div className="border-b border-white/[.07] px-4 py-2 text-xs text-zinc-500">{title}</div><pre className="overflow-x-auto p-4 text-sm leading-6 text-[#FFEA70]"><code>{code}</code></pre></div> }
function ListItem({ children }: { children: ReactNode }) { return <li className="flex gap-2"><span className="text-[#FFD500]">✓</span><span>{children}</span></li> }
