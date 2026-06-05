import * as React from "react";
import { cn } from "../../lib/utils";

type BadgeProps = React.HTMLAttributes<HTMLDivElement> & {
  variant?: "default" | "success" | "warning" | "danger" | "muted";
};

const variants = {
  default: "border-primary/30 bg-primary/15 text-primary-foreground",
  success: "border-secondary/30 bg-secondary/15 text-emerald-200",
  warning: "border-amber-400/30 bg-amber-400/15 text-amber-100",
  danger: "border-destructive/30 bg-destructive/15 text-red-100",
  muted: "border-border bg-muted text-muted-foreground"
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
