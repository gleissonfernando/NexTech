import { Bot, LogIn, Radio, ShieldCheck } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";

type LoginProps = {
  error: string | null;
  onLoginDiscord: () => void;
  onLoginDevelopment: () => void;
};

export function Login({ error, onLoginDiscord, onLoginDevelopment }: LoginProps) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <section className="grid w-full max-w-5xl gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="flex min-h-[420px] flex-col justify-between rounded-lg border border-white/10 bg-[#1e1f22]/88 p-7 shadow-glow backdrop-blur">
          <div>
            <div className="mb-8 flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Bot className="h-6 w-6" />
            </div>
            <h1 className="text-4xl font-semibold text-foreground sm:text-5xl">Painel Discord</h1>
            <p className="mt-4 max-w-md text-base leading-7 text-muted-foreground">
              Acesso administrativo para servidores conectados ao bot.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-white/10 bg-muted/60 p-3">
              <Radio className="mb-3 h-5 w-5 text-cyan-300" />
              <p className="text-sm font-medium">Lives</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-muted/60 p-3">
              <ShieldCheck className="mb-3 h-5 w-5 text-emerald-300" />
              <p className="text-sm font-medium">Moderacao</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-muted/60 p-3">
              <Bot className="mb-3 h-5 w-5 text-amber-300" />
              <p className="text-sm font-medium">Automacao</p>
            </div>
          </div>
        </div>

        <Card className="flex min-h-[420px] flex-col justify-center p-7">
          <div className="mb-8">
            <p className="text-sm font-medium text-muted-foreground">OAuth2</p>
            <h2 className="mt-2 text-2xl font-semibold">Entrar com Discord</h2>
          </div>

          <div className="space-y-3">
            <Button className="w-full" onClick={onLoginDiscord}>
              <LogIn className="h-4 w-4" />
              Entrar
            </Button>
            <Button className="w-full" onClick={onLoginDevelopment} variant="outline">
              <Bot className="h-4 w-4" />
              Modo dev
            </Button>
          </div>

          {error ? <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/15 p-3 text-sm">{error}</p> : null}
        </Card>
      </section>
    </main>
  );
}
