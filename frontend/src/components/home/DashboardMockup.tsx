import { motion } from "framer-motion";
import { Activity, Bot, CheckCircle2, Database, Gauge, LayoutDashboard, LockKeyhole, Settings2, Users } from "lucide-react";
import { productModules } from "./data";

export function DashboardMockup({ large = false }: { large?: boolean }) {
  return (
    <div className={`core-chamfer-outline relative min-w-0 [--cbf:var(--stock-3)] [--cbo:rgba(255,212,0,.28)] [--chamfer-cut:20px] ${large ? "p-3 sm:p-4" : "p-2 sm:p-3"}`}>
      <div className="core-chamfer-sm overflow-hidden bg-[var(--stock)]">
        <div className="flex h-11 items-center justify-between border-b border-[var(--rule-soft)] px-3 sm:px-4">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#FFD400]" />
            <span className="h-2 w-2 rounded-full bg-white/20" />
            <span className="h-2 w-2 rounded-full bg-white/20" />
          </div>
          <span className="core-chamfer-sm core-voice-rail bg-[#FFD400]/12 px-2.5 py-1.5 text-[#FFD400]">Online</span>
        </div>

        <div className={`grid min-h-[420px] ${large ? "md:min-h-[560px]" : ""} md:grid-cols-[210px_1fr]`}>
          <aside className="hidden border-r border-[var(--rule-soft)] bg-[var(--stock-2)] p-4 md:block">
            <div className="flex items-center gap-3">
              <span className="core-chamfer-sm flex h-10 w-10 items-center justify-center bg-[#FFD400] text-black">
                <Bot className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="core-voice-poster truncate text-sm text-white">NexTech</p>
                <p className="core-voice-rail mt-1 truncate text-[#7a7a7a]">Workspace</p>
              </div>
            </div>
            <nav className="mt-8 grid gap-1" aria-label="Navegacao simulada da dashboard">
              {productModules.map((module, index) => (
                <span
                  className={`core-chamfer-sm flex min-h-10 items-center gap-3 px-3 text-sm font-semibold ${index === 0 ? "bg-[#FFD400] text-black" : "text-[#9b9b9b]"}`}
                  key={module}
                >
                  {index === 0 ? <LayoutDashboard className="h-4 w-4" /> : <span className="h-1 w-1 rounded-full bg-[#FFD400]/50" />}
                  {module}
                </span>
              ))}
            </nav>
          </aside>

          <div className="min-w-0 p-4 sm:p-5 lg:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="core-voice-rail text-[#FFD400]">Dashboard</p>
                <h3 className="core-voice-poster mt-2 text-2xl text-white sm:text-3xl">Operacao centralizada</h3>
              </div>
              <div className="core-chamfer-outline core-voice-rail flex items-center gap-2 px-3 py-2.5 text-[#b5b5b5] [--cbf:var(--stock-2)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#FFD400]" />
                Sincronizado
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <MockMetric icon={Users} label="Usuarios ativos" value="Tempo real" />
              <MockMetric icon={Gauge} label="Resposta" value="Baixa latencia" />
              <MockMetric icon={LockKeyhole} label="Protecao" value="Ativa" />
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
              <div className="core-chamfer-outline p-5">
                <div className="flex items-center justify-between gap-3">
                  <p className="core-voice-caption text-white">Atividade recente</p>
                  <Activity className="h-4 w-4 text-[#FFD400]" />
                </div>
                <div className="mt-4 grid">
                  {["Ticket assumido", "Atualizacao publicada", "Permissao sincronizada", "Plano validado"].map((item) => (
                    <div className="flex items-center gap-3 border-b border-[var(--rule-soft)] py-3 last:border-b-0" key={item}>
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-[#FFD400]" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-white">{item}</p>
                        <p className="core-voice-rail mt-1.5 truncate text-[#6f6f6f]">registrado agora</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4">
                <div className="core-chamfer-outline p-5">
                  <p className="core-voice-caption text-white">Servicos</p>
                  <div className="mt-4 space-y-3">
                    <Bar label="API" value="92%" width="92%" />
                    <Bar label="Bot" value="88%" width="88%" />
                    <Bar label="Jobs" value="74%" width="74%" />
                  </div>
                </div>
                <div className="core-chamfer-outline p-5">
                  <div className="flex items-center gap-3">
                    <Database className="h-5 w-5 shrink-0 text-[#FFD400]" />
                    <div className="min-w-0">
                      <p className="core-voice-caption text-white">Banco de dados</p>
                      <p className="core-voice-rail mt-1.5 text-[#7a7a7a]">configuracoes persistidas</p>
                    </div>
                  </div>
                </div>
                <div className="core-chamfer-outline p-5">
                  <div className="flex items-center gap-3">
                    <Settings2 className="h-5 w-5 shrink-0 text-[#FFD400]" />
                    <div className="min-w-0">
                      <p className="core-voice-caption text-white">Integracoes</p>
                      <p className="core-voice-rail mt-1.5 text-[#7a7a7a]">Discord, API, pagamentos e status</p>
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
    <div className="core-chamfer-outline min-w-0 p-5">
      <Icon className="h-5 w-5 text-[#FFD400]" />
      <p className="core-voice-rail mt-4 truncate text-[#6f6f6f]">{label}</p>
      <p className="mt-2 truncate text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function Bar({ label, value, width }: { label: string; value: string; width: string }) {
  return (
    <div>
      <div className="core-voice-rail mb-2 flex items-center justify-between gap-3">
        <span className="text-[#9b9b9b]">{label}</span>
        <span className="core-mono text-[#6f6f6f]">{value}</span>
      </div>
      <div className="h-1.5 bg-white/[.08]">
        <motion.div
          className="h-full bg-[#FFD400]"
          initial={{ width: 0 }}
          transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
          viewport={{ once: true, margin: "-40px" }}
          whileInView={{ width }}
        />
      </div>
    </div>
  );
}
