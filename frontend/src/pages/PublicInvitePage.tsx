import { AlertTriangle, ArrowLeft, ExternalLink, Globe2, MonitorUp, ShieldCheck, Sparkles, Users } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { getPublicNexTechInvitePage, recordPublicNexTechInviteClick } from "../lib/api";
import type { PublicNexTechInvitePage as PublicInvite } from "../types";

type Props = {
  code: string;
};

const DEFAULT_BACKGROUND = "/invite-nextech-default.png";
const DEFAULT_LOGO = "/invite-nextech-default.png";

export function PublicInvitePage({ code }: Props) {
  const [page, setPage] = useState<PublicInvite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    getPublicNexTechInvitePage(code)
      .then((data) => {
        if (!mounted) return;
        setPage(data);
        setError(data.valid ? null : "Convite inválido ou expirado.");
        updateMeta(data);
      })
      .catch(() => {
        if (!mounted) return;
        setError("Convite inválido ou expirado.");
        setPage(null);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [code]);

  const backgroundUrl = page?.config.backgroundImageUrl || DEFAULT_BACKGROUND;
  const serverName = page?.discord?.name || page?.invite.name || "Servidor Discord";
  const description = page?.discord?.description || page?.invite.description || "Entre no servidor oficial usando uma experiência personalizada da NexTech.";
  const logoUrl = page?.config.logoUrl || page?.discord?.iconUrl || DEFAULT_LOGO;
  const primaryColor = page?.config.primaryColor || "#FFD500";
  const theme = page?.config.theme ?? "nextech";

  async function openInvite() {
    if (!page) return;
    setRedirecting(true);
    await recordPublicNexTechInviteClick(code, "official").catch(() => null);
    window.location.assign(page.redirectUrl);
  }

  if (loading) {
    return <InviteShell backgroundUrl={backgroundUrl} effect="zoom" overlay="black"><div className="h-12 w-12 animate-spin rounded-full border-2 border-[#FFD500]/20 border-t-[#FFD500]" /></InviteShell>;
  }

  if (error || !page) {
    return (
      <InviteShell backgroundUrl={backgroundUrl} effect="fixed" overlay="black">
        <div className="w-full max-w-md rounded-2xl border border-red-400/20 bg-black/70 p-6 text-center shadow-2xl backdrop-blur-xl">
          <AlertTriangle className="mx-auto h-10 w-10 text-red-300" />
          <h1 className="mt-4 text-2xl font-black text-white">Convite inválido ou expirado.</h1>
          <p className="mt-2 text-sm font-medium text-zinc-300">Verifique o link recebido ou solicite um novo convite à equipe do servidor.</p>
          <button className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/15 px-4 text-sm font-bold text-white transition hover:bg-white/10" onClick={() => window.history.back()} type="button">
            <ArrowLeft className="h-4 w-4" /> Voltar
          </button>
        </div>
      </InviteShell>
    );
  }

  return (
    <InviteShell backgroundUrl={backgroundUrl} effect={page.config.backgroundEffect} overlay={page.config.overlayStyle} videoUrl={page.config.backgroundVideoUrl}>
      <div className={`invite-page invite-page--${theme} w-full max-w-5xl px-4 py-8`}>
        <div className="mx-auto grid min-h-[78vh] w-full items-center gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <section className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#FFD500]/25 bg-[#FFD500]/10 px-3 py-1 text-xs font-black uppercase tracking-[0.2em] text-[#FFEA70]">
              <Sparkles className="h-3.5 w-3.5" /> NexTech Invite
            </div>
            <h1 className="mt-5 max-w-3xl text-4xl font-black leading-none text-white sm:text-6xl">
              {page.config.showServerName ? serverName : "Convite exclusivo"}
            </h1>
            {page.config.showServerDescription ? <p className="mt-5 max-w-2xl text-base font-semibold leading-7 text-zinc-200 sm:text-lg">{description}</p> : null}
            <div className="mt-6 flex flex-wrap gap-3">
              {page.config.showOnlineCount ? <Metric icon={MonitorUp} label="online" value={formatNumber(page.discord?.approximatePresenceCount)} /> : null}
              {page.config.showMemberCount ? <Metric icon={Users} label="membros" value={formatNumber(page.discord?.approximateMemberCount)} /> : null}
              {page.config.showInviteCode ? <Metric icon={Globe2} label="convite" value={page.discord?.code || page.invite.code} /> : null}
            </div>
          </section>

          <aside className="rounded-2xl border border-white/12 bg-black/58 p-5 text-center shadow-[0_30px_90px_rgba(0,0,0,0.6)] backdrop-blur-2xl">
            <div className="mx-auto grid h-28 w-28 place-items-center overflow-hidden rounded-3xl border border-[#FFD500]/30 bg-black shadow-[0_0_46px_rgba(255,213,0,0.28)]">
              <img alt="" className="h-full w-full object-cover" src={logoUrl} />
            </div>
            <h2 className="mt-4 text-2xl font-black text-white">{serverName}</h2>
            {page.config.showVerificationBadges ? (
              <div className="mt-3 flex flex-wrap justify-center gap-2 text-xs font-black">
                {page.discord?.verified ? <span className="rounded-full border border-sky-300/30 bg-sky-400/10 px-3 py-1 text-sky-100">Verificado</span> : null}
                {page.discord?.partnered ? <span className="rounded-full border border-violet-300/30 bg-violet-400/10 px-3 py-1 text-violet-100">Parceiro</span> : null}
                <span className="rounded-full border border-emerald-300/30 bg-emerald-400/10 px-3 py-1 text-emerald-100"><ShieldCheck className="mr-1 inline h-3.5 w-3.5" /> Seguro</span>
              </div>
            ) : null}
            <div className="mt-6 grid gap-3">
              <button className="inline-flex h-12 items-center justify-center gap-2 rounded-xl px-4 text-sm font-black text-black shadow-[0_0_34px_rgba(255,213,0,0.28)] transition hover:translate-y-[-1px]" disabled={redirecting} onClick={() => void openInvite()} style={{ backgroundColor: primaryColor }} type="button">
                <ExternalLink className="h-4 w-4" /> {redirecting ? "Entrando..." : "Entrar no servidor"}
              </button>
            </div>
            <p className="mt-4 text-xs font-semibold text-zinc-500">O Discord pode solicitar confirmação antes de concluir a entrada.</p>
          </aside>
        </div>
      </div>
      {page.config.particleStyle !== "none" ? <Particles styleName={page.config.particleStyle} /> : null}
    </InviteShell>
  );
}

function InviteShell({ backgroundUrl, children, effect, overlay, videoUrl }: { backgroundUrl: string; children: ReactNode; effect: string; overlay: string; videoUrl?: string | null }) {
  const bgStyle = useMemo(() => ({ backgroundImage: `url("${backgroundUrl}")` }), [backgroundUrl]);
  return (
    <main className="relative grid min-h-screen overflow-hidden bg-black text-white">
      {videoUrl ? <video className="absolute inset-0 h-full w-full object-cover opacity-70" autoPlay loop muted playsInline src={videoUrl} /> : <div className={`absolute inset-0 bg-cover bg-center invite-bg--${effect}`} style={bgStyle} />}
      <div className={`absolute inset-0 invite-overlay--${overlay}`} />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(255,213,0,0.22),transparent_34%),linear-gradient(90deg,rgba(0,0,0,0.8),transparent_45%,rgba(0,0,0,0.7))]" />
      <div className="relative z-10 grid place-items-center">{children}</div>
    </main>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/12 bg-black/45 px-4 py-3 backdrop-blur-xl">
      <p className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-[#FFEA70]"><Icon className="h-4 w-4" /> {label}</p>
      <p className="mt-1 text-lg font-black text-white">{value}</p>
    </div>
  );
}

function Particles({ styleName }: { styleName: string }) {
  return <div className={`pointer-events-none absolute inset-0 z-[1] invite-particles invite-particles--${styleName}`} />;
}

function formatNumber(value: number | null | undefined) {
  return typeof value === "number" ? new Intl.NumberFormat("pt-BR").format(value) : "-";
}

function updateMeta(page: PublicInvite) {
  const title = `${page.discord?.name || page.invite.name} | Convite NexTech`;
  document.title = title;
  setMeta("description", page.discord?.description || page.invite.description || "Convite personalizado NexTech para Discord.");
  setMeta("og:title", title, "property");
  setMeta("og:description", page.discord?.description || page.invite.description || "Entre no servidor pelo convite oficial.");
  setMeta("og:image", page.config.backgroundImageUrl || page.config.logoUrl || DEFAULT_BACKGROUND, "property");
  setMeta("twitter:card", "summary_large_image");
}

function setMeta(name: string, content: string, attr: "name" | "property" = "name") {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attr, name);
    document.head.appendChild(element);
  }
  element.content = content;
}
