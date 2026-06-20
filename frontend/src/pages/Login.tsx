import { motion } from "framer-motion";
import { Bot, CheckCircle2, LogIn } from "lucide-react";
import { Avatar } from "../components/ui/avatar";
import { Button } from "../components/ui/button";
import type { AccessValidationResult, AuthResponse } from "../types";

const ACCESS_DENIED_MESSAGE = "Sem acesso ao painel. Se seu usuario foi liberado agora, saia e entre novamente pelo Discord.";

type LoginProps = {
  accessValidation: AccessValidationResult | null;
  auth: AuthResponse | null;
  checkingAccess: boolean;
  error: string | null;
  onLoginDiscord: () => void;
  onLogout: () => void;
  onVerify: () => void;
  verifying: boolean;
};

export function Login({
  accessValidation,
  auth,
  checkingAccess,
  error,
  onLoginDiscord,
  onLogout,
  onVerify,
  verifying
}: LoginProps) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#050505] px-4 py-10 text-white">
      <div className="absolute inset-0 bg-[#050505]" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.028)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.028)_1px,transparent_1px)] bg-[size:42px_42px]" />

      <motion.section
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-md rounded-lg border border-white/10 bg-[#111111]/90 p-6 shadow-[0_28px_90px_rgba(0,0,0,0.7)] backdrop-blur-2xl sm:p-7"
        initial={{ opacity: 0, y: 16 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        <div className="mb-7 flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950">
            <Bot className="h-6 w-6 text-zinc-200" />
          </div>
          <h1 className="text-2xl font-semibold text-white">Painel de OrviteK Bots</h1>
          <p className="mt-2 text-sm text-zinc-500">{auth ? "Confirme seu acesso ao painel." : "Verifique sua conta Discord para acessar o painel."}</p>
        </div>

        {auth ? (
          <div className="space-y-5">
            <div className="rounded-lg border border-white/10 bg-[#0b0b0b] p-4">
              <div className="flex items-center gap-4">
                <Avatar className="h-14 w-14 rounded-lg text-base" fallback={auth.user.username} src={auth.user.avatarUrl ?? auth.user.avatar} />
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-white">{auth.user.username}</p>
                  <p className="truncate text-sm text-zinc-500">{auth.user.tag}</p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {auth.guilds.length} servidores encontrados
                  </p>
                </div>
              </div>
            </div>

            {checkingAccess || accessValidation ? (
              <div className="rounded-lg border border-white/10 bg-[#0b0b0b] p-3 text-sm text-zinc-300">
                {checkingAccess ? (
                  "Checando se seu usuario pode acessar o site..."
                ) : accessValidation?.allowed ? (
                  "Acesso liberado para o site. Clique em Verificar para entrar."
                ) : (
                  <div className="space-y-2">
                    <p>{ACCESS_DENIED_MESSAGE}</p>
                    {accessValidation?.rejectionReasons?.length ? (
                      <div className="space-y-1 text-xs leading-5 text-zinc-500">
                        {accessValidation.rejectionReasons.map((reason) => (
                          <p key={reason}>{reason}</p>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <Button className="h-11" disabled={verifying} onClick={onVerify}>
                {verifying ? "Verificando..." : "Verificar"}
              </Button>
              <Button className="h-11 border-white/10 text-zinc-100" onClick={onLogout} variant="outline">
                Sair
              </Button>
            </div>
          </div>
        ) : (
          <Button className="h-12 w-full" onClick={onLoginDiscord}>
            <LogIn className="h-4 w-4" />
            Verificar com Discord
          </Button>
        )}

        {error ? <p className="mt-4 rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-sm text-zinc-200">{error}</p> : null}
      </motion.section>
    </main>
  );
}
