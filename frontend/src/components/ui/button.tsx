import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex h-10 max-w-full min-w-0 items-center justify-center gap-2 overflow-hidden rounded-lg px-4 text-sm font-semibold leading-none transition duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-[#FFD500] text-black shadow-[0_0_28px_rgba(255,213,0,0.28)] hover:-translate-y-0.5 hover:scale-[1.03] hover:bg-[#FFEA70] hover:shadow-[0_0_38px_rgba(255,234,112,0.42)]",
        secondary: "border border-[#FFD500]/25 bg-[#161616] text-white hover:-translate-y-0.5 hover:border-[#FFD500]/45 hover:bg-[#1d1d1d]",
        ghost: "text-zinc-400 hover:bg-[#FFD500]/10 hover:text-[#FFEA70]",
        outline: "border border-[#FFD500]/25 bg-transparent text-zinc-100 hover:-translate-y-0.5 hover:border-[#FFD500]/55 hover:bg-[#FFD500]/10 hover:text-[#FFEA70]",
        destructive: "bg-zinc-700 text-white hover:bg-zinc-600"
      },
      size: {
        default: "h-10 px-4",
        sm: "h-9 px-3",
        icon: "h-10 w-10 px-0"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";

    return <Comp ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />;
  }
);

Button.displayName = "Button";
