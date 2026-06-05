import type { LucideIcon } from "lucide-react";
import { Button } from "../ui/button";

type SocialCardProps = {
  title: string;
  description: string;
  icon: LucideIcon;
  iconClassName?: string;
  count?: string;
  actionLabel: string;
  disabled?: boolean;
  onAction?: () => void;
  children?: React.ReactNode;
};

export function SocialCard({
  actionLabel,
  children,
  count,
  description,
  disabled,
  icon: Icon,
  iconClassName,
  onAction,
  title
}: SocialCardProps) {
  return (
    <section className="rounded-2xl border border-[#36414e] bg-[#29313c] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.28)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_30px_90px_rgba(0,0,0,0.46)]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#252d37] text-white">
            <Icon className={["h-6 w-6", iconClassName].filter(Boolean).join(" ")} />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-xl font-semibold text-white">{title}</h3>
              {count ? <span className="rounded-full bg-[#252d37] px-3 py-1 text-xs font-medium text-[#b8bec8]">{count}</span> : null}
            </div>
            <p className="mt-1 text-sm leading-6 text-[#b8bec8]">{description}</p>
          </div>
        </div>

        <Button
          className="h-9 bg-[#1684ff] px-4 text-xs text-white hover:bg-[#1684ff]/90"
          disabled={disabled}
          onClick={onAction}
          type="button"
        >
          {actionLabel}
        </Button>
      </div>

      {children ? <div className="mt-5">{children}</div> : null}
    </section>
  );
}
