import * as React from "react";
import { cn } from "../../lib/utils";

type AvatarProps = React.HTMLAttributes<HTMLDivElement> & {
  src?: string | null;
  fallback: string;
};

export function Avatar({ src, fallback, className, ...props }: AvatarProps) {
  const [failed, setFailed] = React.useState(false);
  const initials = fallback
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();

  React.useEffect(() => {
    setFailed(false);
  }, [src]);

  return (
    <div
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted text-sm font-semibold text-foreground",
        className
      )}
      {...props}
    >
      {src && !failed ? (
        <img src={src} alt="" className="h-full w-full object-cover" onError={() => setFailed(true)} />
      ) : (
        initials || "DC"
      )}
    </div>
  );
}
