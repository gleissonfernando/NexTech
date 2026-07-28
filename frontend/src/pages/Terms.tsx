import { ArrowLeft, BadgeCheck, Banknote, Clock3, FileText, RefreshCw, ShieldCheck, Wrench } from "lucide-react";
import { Button } from "../components/ui/button";

const sections = [
  {
    icon: Wrench,
    title: "Serviços Prestados",
    text: "A NexTech desenvolve soluções digitais personalizadas, incluindo bots para Discord, websites, landing pages, sistemas web, dashboards, APIs, integrações, automações, painéis administrativos e outros projetos sob encomenda. Cada projeto segue o escopo previamente definido com o cliente."
  },
  {
    icon: Banknote,
    title: "Pagamento Restante",
    text: "Após o início do projeto, o valor restante será pago conforme as condições combinadas entre a NexTech e o cliente. As condições podem variar conforme o tipo, porte e complexidade do desenvolvimento."
  },
  {
    icon: Clock3,
    title: "Prazos",
    text: "Os prazos informados são estimativas e podem sofrer alterações por mudanças solicitadas pelo cliente, aumento de complexidade, novas funcionalidades, atraso no envio de informações necessárias ou fatores externos."
  },
  {
    icon: RefreshCw,
    title: "Alterações no Projeto",
    text: "Alterações significativas após aprovação do escopo podem gerar custos adicionais e impactar o prazo de entrega. Toda mudança relevante precisa ser avaliada antes da execução."
  },
  {
    icon: BadgeCheck,
    title: "Garantia",
    text: "A garantia cobre correção de problemas diretamente relacionados ao código entregue pela NexTech. Não inclui novas funcionalidades, mudanças de layout, alteração de escopo, integrações não contratadas, modificações de terceiros ou problemas causados por serviços externos."
  },
  {
    icon: ShieldCheck,
    title: "Responsabilidades",
    text: "A NexTech é responsável apenas pelo desenvolvimento contratado. Não nos responsabilizamos por indisponibilidade do Discord, alterações em APIs externas, hospedagens de terceiros, provedores externos, modificações realizadas pelo cliente ou indisponibilidade de plataformas externas."
  },
  {
    icon: FileText,
    title: "Cancelamento",
    text: "Cada solicitação de cancelamento será analisada individualmente. Caso o desenvolvimento já tenha sido iniciado, o pagamento inicial de 40% corresponde aos custos iniciais do serviço prestado e não é reembolsável."
  },
  {
    icon: ShieldCheck,
    title: "Privacidade",
    text: "As informações fornecidas pelos clientes são utilizadas apenas para a prestação dos serviços contratados. A NexTech adota boas práticas de segurança para proteger os dados armazenados."
  }
];

const customProjects = ["Bots personalizados", "Websites", "Sistemas Web", "Dashboards", "APIs", "Integrações", "Automações", "Projetos sob encomenda"];

export function TermsPage() {
  return (
    <main className="min-h-screen bg-[#050505] text-white">
      <div className="fixed inset-0 -z-10 bg-[#050505]" />
      <header className="border-b border-[#FFD500]/15 bg-black/55 px-4 py-4 backdrop-blur-xl sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <a className="flex items-center gap-2" href="/">
            <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg border border-[#FFD500]/30 bg-[#050505]">
              <img alt="NexTech" className="h-full w-full object-cover" src="/brand/nextech.png" />
            </span>
            <span className="text-xl font-black text-[#FFD500]">Nex Tech</span>
          </a>
          <Button asChild variant="outline">
            <a href="/"><ArrowLeft className="h-4 w-4" />Voltar</a>
          </Button>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="max-w-4xl">
          <span className="inline-flex rounded-full border border-[#FFD500]/25 bg-[#FFD500]/10 px-4 py-2 text-sm font-bold text-[#FFEA70]">Página informativa</span>
          <h1 className="mt-6 text-4xl font-black leading-tight text-white sm:text-6xl">Termos de Serviço</h1>
          <p className="mt-5 text-base leading-8 text-[#B3B3B3] sm:text-lg">
            Bem-vindo à página de Termos da NexTech. Aqui você encontrará informações referentes às condições de prestação de serviços, desenvolvimento de projetos, garantias, responsabilidades, formas de pagamento e políticas adotadas pela empresa.
          </p>
        </div>

        <div className="mt-10 rounded-lg border border-[#FFD500]/35 bg-[#FFD500]/10 p-6 shadow-[0_24px_80px_rgba(255,213,0,0.08)]">
          <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#FFD500]">Pagamento inicial</p>
              <p className="mt-3 text-6xl font-black text-white">40%</p>
              <p className="mt-2 text-sm font-semibold text-[#FFEA70]">obrigatório para projetos personalizados</p>
            </div>
            <div className="space-y-4 text-sm leading-7 text-zinc-100">
              <p>Para qualquer projeto desenvolvido sob encomenda, é necessário um pagamento inicial correspondente a 40% do valor total do projeto.</p>
              <p>Esse pagamento confirma oficialmente a contratação, reserva a agenda da equipe, inicia o planejamento, viabiliza o levantamento de requisitos e permite o começo do desenvolvimento.</p>
              <p className="font-bold text-white">Sem a confirmação desse pagamento, o desenvolvimento não será iniciado.</p>
              <div className="flex flex-wrap gap-2">
                {customProjects.map((item) => <span className="rounded-full border border-[#FFD500]/20 bg-black/35 px-3 py-1 text-xs font-semibold text-[#FFEA70]" key={item}>{item}</span>)}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {sections.map((section) => (
            <article className="rounded-lg border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl" key={section.title}>
              <section.icon className="h-6 w-6 text-[#FFD500]" />
              <h2 className="mt-4 text-xl font-black text-white">{section.title}</h2>
              <p className="mt-3 text-sm leading-7 text-[#B3B3B3]">{section.text}</p>
            </article>
          ))}
        </div>

        <div className="mt-8 rounded-lg border border-white/10 bg-white/[0.04] p-6">
          <h2 className="text-2xl font-black text-white">Atualizações dos Termos</h2>
          <p className="mt-3 text-sm leading-7 text-[#B3B3B3]">
            Esta página poderá ser atualizada sempre que necessário para refletir mudanças nos serviços, processos internos ou políticas da NexTech. Esta página é apenas informativa e não possui aceite, checkbox, assinatura eletrônica ou confirmação de leitura.
          </p>
        </div>
      </section>
    </main>
  );
}
