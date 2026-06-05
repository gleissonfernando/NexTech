import { motion } from "framer-motion";
import { Bot, CheckCircle2, Cog, FileText, LogIn, Radio, ShieldCheck, ShieldHalf, Sparkles, Users } from "lucide-react";
import { Avatar } from "../components/ui/avatar";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import type { AuthResponse } from "../types";

type LoginProps = {
  auth: AuthResponse | null;
  error: string | null;
  onLoginDiscord: () => void;
  onLogout: () => void;
  onVerify: () => void;
  verifying: boolean;
};

const featureCards = [
  { label: "Lives", icon: Radio },
  { label: "Moderacao", icon: ShieldCheck },
  { label: "Automacao", icon: Bot },
  { label: "Logs", icon: FileText },
  { label: "Configuracoes", icon: Cog }
];

export function Login({ auth, error, onLoginDiscord, onLogout, onVerify, verifying }: LoginProps) {
  const isAuthenticated = Boolean(auth);

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#050505] text-white">
      <div className="absolute inset-0 bg-[#050505]" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:44px_44px]" />

      <section className="relative mx-auto grid min-h-screen w-full max-w-7xl items-center gap-8 px-4 py-8 md:px-8 lg:grid-cols-[1.08fr_0.92fr]">
        <motion.div
          animate={{ opacity: 1, x: 0 }}
          className="flex min-h-[620px] flex-col justify-between rounded-lg border border-white/10 bg-white/[0.065] p-5 shadow-glow backdrop-blur-2xl sm:p-7 lg:p-8"
          initial={{ opacity: 0, x: -18 }}
          transition={{ duration: 0.55, ease: "easeOut" }}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950 shadow-glow">
                <Bot className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">Discord Control</p>
                <p className="truncate text-xs text-zinc-500">Premium Dashboard</p>
              </div>
            </div>
            <Badge variant="muted">
              OAuth2
            </Badge>
          </div>

          <div className="py-10 lg:py-14">
            <motion.div
              animate={{ opacity: 1, y: 0 }}
              initial={{ opacity: 0, y: 16 }}
              transition={{ delay: 0.12, duration: 0.55, ease: "easeOut" }}
            >
              <p className="mb-4 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.075] px-3 py-1.5 text-xs font-medium text-zinc-300">
                <Sparkles className="h-3.5 w-3.5" />
                SaaS panel para operacao Discord
              </p>
              <h1 className="max-w-3xl text-4xl font-semibold leading-tight text-white sm:text-5xl lg:text-6xl">
                Gerencie seu bot Discord com velocidade, controle e seguranca.
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-zinc-500">
                Login Discord, verificacao de acesso, telemetria em tempo real e modulos administrativos em um painel dark premium.
              </p>
            </motion.div>
          </div>

          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
            initial={{ opacity: 0, y: 16 }}
            transition={{ delay: 0.22, duration: 0.55, ease: "easeOut" }}
          >
            {featureCards.map((item) => (
              <div key={item.label} className="rounded-lg border border-white/10 bg-[#111111]/70 p-4 backdrop-blur">
                <item.icon className="mb-3 h-5 w-5 text-zinc-300" />
                <p className="truncate text-sm font-medium">{item.label}</p>
              </div>
            ))}
          </motion.div>
        </motion.div>

        <motion.div
          animate={{ opacity: 1, x: 0 }}
          className="rounded-lg border border-white/10 bg-[#111111]/80 p-5 shadow-glow backdrop-blur-2xl sm:p-7"
          initial={{ opacity: 0, x: 18 }}
          transition={{ duration: 0.55, ease: "easeOut" }}
        >
          <div className="mb-7 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-zinc-500">{isAuthenticated ? "Usuario autenticado" : "Acesso obrigatorio"}</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">{isAuthenticated ? "Verificar acesso" : "Entrar com Discord"}</h2>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-white/[0.075]">
              <ShieldHalf className="h-5 w-5 text-zinc-300" />
            </div>
          </div>

          {auth ? (
            <motion.div animate={{ opacity: 1, y: 0 }} initial={{ opacity: 0, y: 10 }} transition={{ duration: 0.35 }}>
              <div className="mb-5 rounded-lg border border-white/10 bg-white/[0.065] p-4">
                <div className="flex items-center gap-4">
                  <Avatar className="h-16 w-16 rounded-lg text-lg" fallback={auth.user.username} src={auth.user.avatar} />
                  <div className="min-w-0">
                    <p className="truncate text-lg font-semibold text-white">{auth.user.username}</p>
                    <p className="truncate text-sm text-zinc-500">{auth.user.tag}</p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-white/10 bg-[#0b0b0b]/80 p-3">
                    <Users className="mb-2 h-4 w-4 text-zinc-300" />
                    <p className="text-2xl font-semibold">{auth.guilds.length}</p>
                    <p className="text-xs text-zinc-500">Servidores</p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-[#0b0b0b]/80 p-3">
                    <CheckCircle2 className="mb-2 h-4 w-4 text-zinc-300" />
                    <p className="text-2xl font-semibold">{auth.permissions.canManageGuilds ? "OK" : "Pendente"}</p>
                    <p className="text-xs text-zinc-500">Permissao</p>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <Button className="h-11" disabled={verifying} onClick={onVerify}>
                  {verifying ? "Verificando..." : "Verificar"}
                </Button>
                <Button className="h-11 border-white/10 text-zinc-100 hover:bg-white/10" onClick={onLogout} variant="outline">
                  Sair
                </Button>
              </div>
            </motion.div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border border-white/10 bg-white/[0.055] p-4">
                <p className="text-sm leading-6 text-zinc-500">
                  O painel exige OAuth2 Discord. Depois do login, a validacao de cargos sera aplicada por middleware; por enquanto, usuarios autenticados podem liberar acesso temporario.
                </p>
              </div>

              <Button className="h-12 w-full" onClick={onLoginDiscord}>
                <LogIn className="h-4 w-4" />
                Entrar com Discord
              </Button>
            </div>
          )}

          {error ? <p className="mt-4 rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-sm text-zinc-200">{error}</p> : null}
        </motion.div>
      </section>
    </main>
  );
}
