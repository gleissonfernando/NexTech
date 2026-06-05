import * as React from "react";
import { cn } from "../../lib/utils";

type BadgeProps = React.HTMLAttributes<HTMLDivElement> & {
  variant?: "default" | "success" | "warning" | "danger" | "muted";
};

const variants = {
  default: "border-zinc-600 bg-zinc-900 text-white",
  success: "border-zinc-600 bg-zinc-900 text-zinc-100",
  warning: "border-zinc-700 bg-zinc-950 text-zinc-300",
  danger: "border-zinc-700 bg-zinc-900 text-zinc-200",
  muted: "border-zinc-800 bg-zinc-950 text-zinc-400"
};

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex min-h-6 items-center rounded-md border px-2.5 py-1 text-xs font-medium",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
