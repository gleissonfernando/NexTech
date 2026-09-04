import { ArrowLeft } from "lucide-react";
import { HomeShell, InkRule, Reveal, Section, StaggerGroup, StaggerItem } from "../components/home/HomeUi";

const clauses = [
  {
    title: "Credenciais e acessos",
    text: "O contratante é o único responsável pela guarda do token do bot, senhas, chaves de API e acessos administrativos do servidor. A NexTech não responde por vazamentos, invasões ou usos indevidos decorrentes do compartilhamento dessas credenciais com terceiros."
  },
  {
    title: "Uso da plataforma",
    text: "O contratante responde pelo uso que faz da plataforma e pelas ações executadas por sua equipe, incluindo banimentos, remoção de membros, limpeza de mensagens, envio de anúncios e demais ações administrativas realizadas pelo painel ou pelo bot."
  },
  {
    title: "Conteúdo publicado",
    text: "Textos, imagens, painéis, regras e qualquer conteúdo configurado pelo contratante são de sua inteira responsabilidade. É vedado utilizar a plataforma para conteúdo ilegal, discriminatório, fraudulento ou que viole os Termos de Serviço e as Diretrizes da Comunidade do Discord."
  },
  {
    title: "Conformidade com terceiros",
    text: "A operação depende de serviços de terceiros: Discord, hospedagem, gateways de pagamento e APIs externas. Punições aplicadas por essas plataformas ao servidor ou à aplicação do contratante, inclusive suspensões por abuso, cabem a quem realizou a configuração ou a ação."
  },
  {
    title: "Disponibilidade",
    text: "A NexTech mantém boas práticas de operação e monitoramento, mas não garante disponibilidade ininterrupta. Instabilidades causadas por indisponibilidade do Discord, de provedores de hospedagem, de rede ou de APIs externas não geram obrigação de indenização."
  },
  {
    title: "Dados e backups",
    text: "Os dados de configuração são armazenados para viabilizar o funcionamento dos módulos contratados. O contratante deve manter cópias próprias de informações críticas e comunicar imediatamente qualquer inconsistência identificada."
  },
  {
    title: "Privacidade e LGPD",
    text: "Os dados tratados são utilizados exclusivamente para a prestação do serviço contratado. O contratante declara possuir base legal para os dados que insere na plataforma e é responsável por informar seus membros sobre as regras do servidor."
  },
  {
    title: "Limitação de responsabilidade",
    text: "A responsabilidade da NexTech limita-se ao serviço efetivamente contratado. Não abrange lucros cessantes, perdas indiretas, alterações feitas por terceiros no ambiente do contratante ou uso da plataforma em desacordo com este termo."
  }
];

const metadata = [
  ["Documento", "Termo de responsabilidade"],
  ["Referência", "NT-TR-01"],
  ["Natureza", "Somente leitura"],
  ["Aplica-se a", "Contratante e sua equipe"]
];

const duties = [
  "Token e acessos em sigilo",
  "Cargos e permissões com cautela",
  "Termos do Discord respeitados",
  "Conteúdo do servidor sob sua conta",
  "Incidentes comunicados à equipe",
  "Contato e cobrança atualizados"
];

export function ResponsibilityTermPage() {
  return (
    <HomeShell>
      <header className="core-theme sticky top-0 z-50 w-full border-b border-[var(--rule)] bg-black/70 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[1560px] items-center justify-between gap-4 px-[var(--core-margin)] py-4">
          <a className="flex items-center gap-3" href="/">
            <span className="core-chamfer-sm flex h-9 w-9 items-center justify-center overflow-hidden bg-[var(--stock-2)]">
              <img alt="NexTech" className="h-full w-full object-cover" src="/brand/nextech.png" />
            </span>
            <span className="core-voice-poster text-lg text-white">NexTech</span>
          </a>
          <a
            className="core-voice-rail core-chamfer-outline core-press inline-flex min-h-11 items-center gap-2 px-5 text-white transition-colors [--cbf:var(--stock-2)]"
            href="/"
          >
            <ArrowLeft className="h-3.5 w-3.5" />Voltar
          </a>
        </div>
      </header>

      <Section className="pb-10 pt-16 sm:pt-24">
        <Reveal>
          <div className="flex items-center gap-3">
            <span className="core-voice-rail text-[#FFD400]">Doc · NT-TR-01</span>
            <InkRule className="w-24" />
            <span className="core-voice-rail text-[#6f6f6f]">Somente leitura</span>
          </div>
          <h1 className="core-voice-poster mt-7 max-w-[900px] text-balance text-[clamp(2.75rem,5.6vw,5rem)] text-white">
            Termo de responsabilidade
          </h1>
          <p className="core-voice-body mt-6 max-w-[720px] text-pretty text-base text-[#9b9b9b] sm:text-lg">
            Uma leitura direta de quem responde pelo quê durante a operação da plataforma NexTech — bots, painéis e integrações. Sem formulário, sem aceite: esta página existe para ser lida.
          </p>
        </Reveal>
      </Section>

      <Section className="pb-14">
        <Reveal>
          <div className="grid gap-px border-y border-[var(--rule)] bg-[var(--rule-soft)] sm:grid-cols-2 lg:grid-cols-4">
            {metadata.map(([label, value]) => (
              <div className="bg-[var(--stock)] px-5 py-6" key={label}>
                <p className="core-voice-rail text-[#6f6f6f]">{label}</p>
                <p className="core-voice-body mt-3 text-sm text-white">{value}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </Section>

      <Section className="pb-16">
        <StaggerGroup className="border-t border-[var(--rule)]">
          {clauses.map((clause, index) => (
            <StaggerItem key={clause.title}>
              <article className="grid gap-4 border-b border-[var(--rule-soft)] py-9 md:grid-cols-[7rem_minmax(0,1fr)] md:gap-10 lg:grid-cols-[9rem_minmax(0,1fr)]">
                <p className="core-mono text-[2.25rem] leading-none text-[#FFD400]/85">
                  {String(index + 1).padStart(2, "0")}
                </p>
                <div className="max-w-[900px]">
                  <h2 className="core-voice-poster text-xl text-white sm:text-2xl">{clause.title}</h2>
                  <p className="core-voice-body mt-4 text-pretty text-[15px] text-[#9b9b9b] sm:text-base">{clause.text}</p>
                </div>
              </article>
            </StaggerItem>
          ))}
        </StaggerGroup>
      </Section>

      <Section className="pb-20">
        <Reveal>
          <div className="core-screen border border-[var(--rule)] px-6 py-10 sm:px-10">
            <span className="core-voice-rail text-[#FFD400]">Resumo do que cabe ao contratante</span>
            <ul className="mt-7 grid gap-x-10 gap-y-4 md:grid-cols-2 lg:grid-cols-3">
              {duties.map((item) => (
                <li className="core-voice-body flex items-baseline gap-3 border-b border-[var(--rule-soft)] pb-4 text-sm text-[#c9c9c9]" key={item}>
                  <span className="core-mono text-[11px] text-[#FFD400]/70">—</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </Section>

      <Section className="pb-24">
        <Reveal>
          <div className="border-t border-[var(--rule)] pt-8">
            <p className="core-voice-body max-w-[820px] text-sm text-[#8a8a8a]">
              Esta página poderá ser atualizada sempre que necessário para refletir mudanças nos serviços, na infraestrutura ou na legislação aplicável. É um documento informativo: não possui aceite, checkbox, assinatura eletrônica ou confirmação de leitura, e complementa — sem substituir — os Termos de Serviço.
            </p>
            <a className="core-voice-rail mt-6 inline-flex text-[#8a8a8a] transition-colors hover:text-[#FFD400]" href="/termos">
              Ler os Termos de Serviço →
            </a>
          </div>
        </Reveal>
      </Section>
    </HomeShell>
  );
}
