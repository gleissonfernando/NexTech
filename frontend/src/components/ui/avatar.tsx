import * as React from "react";
import { cn } from "../../lib/utils";

type AvatarProps = React.HTMLAttributes<HTMLDivElement> & {
  src?: string | null;
  fallback: string;
};

export function Avatar({ src, fallback, className, ...props }: AvatarProps) {
  return (
    <div
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-sm font-semibold text-foreground",
        className
      )}
      {...props}
    >
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : fallback.slice(0, 2).toUpperCase()}
    </div>
  );
}
