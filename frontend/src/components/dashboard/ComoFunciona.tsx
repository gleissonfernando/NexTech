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
          Em 3 passos simples você já está com tudo funcionando.
        </p>
      </header>

      <div className="relative mx-auto mt-12 max-w-5xl">
        <div
          aria-hidden="true"
          className="absolute left-[16.666%] right-[16.666%] top-8 hidden h-px bg-gradient-to-r from-yellow-500/15 via-yellow-400/60 to-yellow-500/15 md:block"
        />

        <div className="grid gap-10 md:grid-cols-3 md:gap-8">
          {steps.map(({ description, icon: Icon, number, title }) => (
            <article className="relative flex flex-col items-center text-center" key={number}>
              <div className="relative z-10 flex h-16 w-16 items-center justify-center rounded-2xl border border-yellow-500/40 bg-[#111108] shadow-[0_0_30px_rgba(234,179,8,0.10)]">
                <Icon aria-hidden="true" className="h-7 w-7 text-yellow-400" strokeWidth={2.2} />
                <span className="absolute -right-2 -top-2 flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-[#050509] bg-yellow-400 px-1 text-[10px] font-extrabold leading-none text-black">
                  {number}
                </span>
              </div>
              <h3 className="mt-6 text-xl font-semibold tracking-tight text-white">{title}</h3>
              <p className="mt-2 max-w-[260px] text-sm leading-6 text-gray-400">{description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
