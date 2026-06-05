import { useEffect } from "react";
import { ArrowRight, CalendarClock, CheckCircle2, IdCard } from "lucide-react";
import { motion } from "framer-motion";
import { Avatar } from "../components/ui/avatar";
import { Button } from "../components/ui/button";
import type { AuthResponse } from "../types";

type AuthSuccessProps = {
  auth: AuthResponse;
};

export function AuthSuccess({ auth }: AuthSuccessProps) {
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      window.location.assign("/dashboard");
    }, 3000);

    return () => window.clearTimeout(timeout);
  }, []);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#050505] px-4 py-10 text-white">
      <div className="absolute inset-0 bg-[#050505]" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.028)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.028)_1px,transparent_1px)] bg-[size:42px_42px]" />

      <motion.section
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-lg rounded-lg border border-white/10 bg-[#111111]/90 p-6 shadow-[0_28px_90px_rgba(0,0,0,0.7)] backdrop-blur-2xl sm:p-7"
        initial={{ opacity: 0, y: 16 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10">
            <CheckCircle2 className="h-6 w-6 text-emerald-300" />
          </div>
          <h1 className="text-2xl font-semibold text-white">Verificacao concluida</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-500">
            Sua conta Discord foi autenticada com sucesso. Bem-vindo ao painel Ricardinn98.
          </p>
        </div>

        <div className="rounded-lg border border-white/10 bg-[#0b0b0b] p-4">
          <div className="flex items-center gap-4">
            <Avatar className="h-14 w-14 rounded-lg text-base" fallback={auth.user.username} src={auth.user.avatar} />
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-white">{auth.user.username}</p>
              <p className="truncate text-sm text-zinc-500">{auth.user.tag}</p>
              <p className="mt-1 text-xs font-medium text-zinc-500">{auth.access.level === "admin" ? "Acesso administrativo" : "Visualizacao basica"}</p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <InfoRow icon={IdCard} label="Discord ID" value={auth.user.discordId} />
            <InfoRow icon={CalendarClock} label="Ultimo login" value={formatDateTime(auth.user.lastLoginAt)} />
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-zinc-500">Redirecionamento automatico em 3 segundos.</p>
          <Button className="h-11" onClick={() => window.location.assign("/dashboard")}>
            Ir para Dashboard
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </motion.section>
    </main>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof IdCard; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-900 bg-zinc-950/75 p-3">
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        <Icon className="h-3.5 w-3.5" />
        <span>{label}</span>
      </div>
      <p className="mt-1 truncate text-sm font-medium text-zinc-100">{value}</p>
    </div>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}
