import { Activity, Bot, CheckCircle2, Database, Gauge, LayoutDashboard, LockKeyhole, Settings2, Users } from "lucide-react";
import { productModules } from "./data";

export function DashboardMockup({ large = false }: { large?: boolean }) {
  return (
    <div className={`relative min-w-0 rounded-lg border border-[#FFD400]/18 bg-[#0A0A0A] shadow-[0_28px_90px_rgba(0,0,0,.55),0_0_42px_rgba(255,212,0,.09)] ${large ? "p-3 sm:p-4" : "p-2 sm:p-3"}`}>
      <div className="absolute -inset-px -z-10 rounded-lg bg-[radial-gradient(circle_at_70%_0%,rgba(255,212,0,.18),transparent_34%)]" />
      <div className="overflow-hidden rounded-md border border-white/[.07] bg-[#080808]">
        <div className="flex h-11 items-center justify-between border-b border-white/[.07] px-3 sm:px-4">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#FFD400]" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
          </div>
          <span className="rounded-md border border-[#FFD400]/20 bg-[#FFD400]/10 px-2.5 py-1 text-[10px] font-black uppercase text-[#FFD400]">Online</span>
        </div>

        <div className={`grid min-h-[420px] ${large ? "md:min-h-[560px]" : ""} md:grid-cols-[210px_1fr]`}>
          <aside className="hidden border-r border-white/[.07] bg-[#0D0D0D] p-4 md:block">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#FFD400] text-black">
                <Bot className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-white">NexTech</p>
                <p className="truncate text-xs text-[#999999]">Workspace</p>
              </div>
            </div>
            <nav className="mt-8 grid gap-2" aria-label="Navegacao simulada da dashboard">
              {productModules.map((module, index) => (
                <span
                  className={`flex min-h-10 items-center gap-3 rounded-md px-3 text-sm font-semibold ${index === 0 ? "bg-[#FFD400] text-black" : "text-[#B8B8B8]"}`}
                  key={module}
                >
                  {index === 0 ? <LayoutDashboard className="h-4 w-4" /> : <span className="h-1.5 w-1.5 rounded-full bg-[#FFD400]/50" />}
                  {module}
                </span>
              ))}
            </nav>
          </aside>

          <div className="min-w-0 p-4 sm:p-5 lg:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase text-[#FFD400]">Dashboard</p>
                <h3 className="mt-1 text-2xl font-black text-white sm:text-3xl">Operacao centralizada</h3>
              </div>
              <div className="flex items-center gap-2 rounded-md border border-white/10 bg-[#111111] px-3 py-2 text-xs font-bold text-[#D4D4D4]">
                <span className="h-2 w-2 rounded-full bg-[#FFD400]" />
                Sincronizado
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <MockMetric icon={Users} label="Usuarios ativos" value="Tempo real" />
              <MockMetric icon={Gauge} label="Resposta" value="Baixa latencia" />
              <MockMetric icon={LockKeyhole} label="Protecao" value="Ativa" />
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
              <div className="rounded-lg border border-white/[.07] bg-[#111111] p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-bold text-white">Atividade recente</p>
                  <Activity className="h-4 w-4 text-[#FFD400]" />
                </div>
                <div className="mt-5 grid gap-3">
                  {["Ticket assumido", "Atualizacao publicada", "Permissao sincronizada", "Plano validado"].map((item) => (
                    <div className="flex items-center gap-3 rounded-md border border-white/[.06] bg-black/25 p-3" key={item}>
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-[#FFD400]" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-white">{item}</p>
                        <p className="truncate text-xs text-[#777777]">registrado agora</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4">
                <div className="rounded-lg border border-white/[.07] bg-[#111111] p-4">
                  <p className="text-sm font-bold text-white">Servicos</p>
                  <div className="mt-4 space-y-3">
                    <Bar label="API" value="92%" width="92%" />
                    <Bar label="Bot" value="88%" width="88%" />
                    <Bar label="Jobs" value="74%" width="74%" />
                  </div>
                </div>
                <div className="rounded-lg border border-white/[.07] bg-[#111111] p-4">
                  <div className="flex items-center gap-3">
                    <Database className="h-5 w-5 text-[#FFD400]" />
                    <div>
                      <p className="text-sm font-bold text-white">Banco de dados</p>
                      <p className="text-xs text-[#999999]">configuracoes persistidas</p>
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border border-white/[.07] bg-[#111111] p-4">
                  <div className="flex items-center gap-3">
                    <Settings2 className="h-5 w-5 text-[#FFD400]" />
                    <div>
                      <p className="text-sm font-bold text-white">Integracoes</p>
                      <p className="text-xs text-[#999999]">Discord, API, pagamentos e status</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MockMetric({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/[.07] bg-[#111111] p-4">
      <Icon className="h-5 w-5 text-[#FFD400]" />
      <p className="mt-4 truncate text-xs font-black uppercase text-[#777777]">{label}</p>
      <p className="mt-1 truncate text-sm font-bold text-white">{value}</p>
    </div>
  );
}

function Bar({ label, value, width }: { label: string; value: string; width: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold text-[#B8B8B8]">{label}</span>
        <span className="text-[#777777]">{value}</span>
      </div>
      <div className="h-2 rounded-full bg-white/10">
        <div className="h-full rounded-full bg-[#FFD400]" style={{ width }} />
      </div>
    </div>
  );
}
