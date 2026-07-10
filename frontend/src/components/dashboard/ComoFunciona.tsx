import { KeyRound, Rocket, SlidersHorizontal, type LucideIcon } from "lucide-react";

type ComoFuncionaStep = {
  description: string;
  icon: LucideIcon;
  number: `0${1 | 2 | 3}`;
  title: string;
};

const steps: ComoFuncionaStep[] = [
  {
    description: "Entre com Discord e valide seu acesso à plataforma.",
    icon: KeyRound,
    number: "01",
    title: "Obtenha seu Token"
  },
  {
    description: "Escolha módulos, permissões, canais e comportamento do bot.",
    icon: SlidersHorizontal,
    number: "02",
    title: "Configure seu Bot"
  },
  {
    description: "Publique, monitore e ajuste tudo pelo dashboard.",
    icon: Rocket,
    number: "03",
    title: "Pronto para Usar"
  }
];

export function ComoFunciona() {
  return (
    <section aria-labelledby="como-funciona-title" className="home-section">
      <header className="mx-auto max-w-2xl text-center">
        <h2
          className="como-funciona-title text-[1.75rem] leading-tight text-white md:text-[2.5rem]"
          id="como-funciona-title"
        >
          Como Funciona
        </h2>
        <p className="mt-3 text-sm leading-6 text-gray-400 sm:text-base">
          Configure sua operação em poucos passos e mantenha tudo sob controle.
        </p>
      </header>

      <div className="mx-auto mt-10 flex max-w-5xl flex-col items-center justify-center gap-8 md:flex-row md:items-start md:gap-4">
        {steps.map(({ description, icon: Icon, number, title }, index) => (
          <div className="contents" key={number}>
            <article className="flex w-full flex-col items-center text-center md:w-auto md:flex-1">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-yellow-500/30 bg-black shadow-[0_0_24px_rgba(234,179,8,0.08)]">
                <Icon aria-hidden="true" className="h-7 w-7 text-yellow-400" />
              </div>
              <p className="mt-4 text-xs font-bold tracking-[0.18em] text-yellow-400">{number}</p>
              <h3 className="mt-2 text-base font-semibold text-white">{title}</h3>
              <p className="mt-2 max-w-[220px] text-sm leading-6 text-gray-400">{description}</p>
            </article>

            {index < steps.length - 1 ? (
              <div
                aria-hidden="true"
                className="mt-8 hidden h-px max-w-[100px] flex-1 bg-yellow-500/30 md:block"
              />
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
