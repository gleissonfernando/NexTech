import { AnimatePresence, motion, useInView, useMotionValue, useReducedMotion, useSpring, useTransform, type Variants } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

export function HomeShell({ children }: { children: ReactNode }) {
  return (
    <main className="nextech-home relative min-h-screen w-full overflow-x-clip bg-[#050505] text-white">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_72%_8%,rgba(255,212,0,.10),transparent_32%),radial-gradient(circle_at_16%_46%,rgba(255,212,0,.05),transparent_30%),#050505]" />
      {children}
    </main>
  );
}

export function Section({
  children,
  className = "",
  id
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section className={`w-full ${className}`} id={id}>
      <div className="mx-auto w-full max-w-[1480px] px-5 sm:px-6 lg:px-10 xl:px-12">
        {children}
      </div>
    </section>
  );
}

export function SectionHeader({
  align = "center",
  eyebrow,
  subtitle,
  title
}: {
  align?: "center" | "left";
  eyebrow?: string;
  subtitle: string;
  title: string;
}) {
  return (
    <div className={align === "center" ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
      {eyebrow ? <p className="mb-4 text-xs font-black uppercase text-[#FFD400]">{eyebrow}</p> : null}
      <h2 className="text-balance text-3xl font-black leading-tight text-white sm:text-4xl lg:text-5xl">{title}</h2>
      <p className="mt-4 text-pretty text-base leading-7 text-[#A3A3A3] sm:text-lg">{subtitle}</p>
    </div>
  );
}

export function HomeButton({
  children,
  className = "",
  href,
  onClick,
  variant = "primary"
}: {
  children: ReactNode;
  className?: string;
  href?: string;
  onClick?: () => void;
  variant?: "primary" | "secondary";
}) {
  const classes = variant === "primary"
    ? "border-[#FFD400] bg-[#FFD400] text-black hover:bg-[#FFE36A] focus-visible:ring-[#FFD400]/50"
    : "border-white/10 bg-[#111111] text-white hover:border-[#FFD400]/35 hover:bg-[#171717] focus-visible:ring-white/25";
  const shared = `inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border px-5 text-sm font-black transition duration-200 focus-visible:outline-none focus-visible:ring-4 ${classes} ${className}`;

  if (href) {
    return (
      <motion.a className={shared} href={href} whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}>
        {children}
      </motion.a>
    );
  }

  return (
    <motion.button className={shared} onClick={onClick} type="button" whileHover={{ y: -2 }} whileTap={{ scale: 0.97 }}>
      {children}
    </motion.button>
  );
}

export function GlowCard({
  children,
  className = ""
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      className={`rounded-lg border border-white/[.07] bg-[#111111] shadow-[0_18px_60px_rgba(0,0,0,.28)] transition duration-300 hover:border-[#FFD400]/25 hover:shadow-[0_18px_70px_rgba(0,0,0,.35),0_0_30px_rgba(255,212,0,.08)] ${className}`}
      whileHover={{ y: -6 }}
    >
      {children}
    </motion.div>
  );
}

export function Metric({
  label,
  value,
  numericValue,
  prefix = "",
  suffix = "",
  decimals = 0
}: {
  label: string;
  value: string;
  numericValue?: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
}) {
  return (
    <div className="min-w-0 border-l border-white/10 px-4 first:border-l-0 sm:px-6">
      {typeof numericValue === "number" ? (
        <CountUp className="truncate text-2xl font-black text-white sm:text-3xl" decimals={decimals} prefix={prefix} suffix={suffix} value={numericValue} />
      ) : (
        <p className="truncate text-2xl font-black text-white sm:text-3xl">{value}</p>
      )}
      <p className="mt-1 truncate text-xs font-bold uppercase text-[#999999]">{label}</p>
    </div>
  );
}

/** Conta de 0 até `value` quando entra na viewport, uma unica vez. */
function CountUp({
  className,
  decimals,
  prefix,
  suffix,
  value
}: {
  className?: string;
  decimals: number;
  prefix: string;
  suffix: string;
  value: number;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-40px" });
  const reduceMotion = useReducedMotion();
  const motionValue = useMotionValue(0);
  const spring = useSpring(motionValue, { damping: 24, stiffness: 90 });
  const [display, setDisplay] = useState(() => formatCountUp(0, decimals));

  useEffect(() => {
    if (!isInView) return;

    if (reduceMotion) {
      setDisplay(formatCountUp(value, decimals));
      return;
    }

    motionValue.set(value);
  }, [decimals, isInView, motionValue, reduceMotion, value]);

  useEffect(() => {
    if (reduceMotion) return;

    return spring.on("change", (latest) => {
      setDisplay(formatCountUp(latest, decimals));
    });
  }, [spring, decimals, reduceMotion]);

  return (
    <p className={className} ref={ref}>
      {prefix}
      {display}
      {suffix}
    </p>
  );
}

function formatCountUp(value: number, decimals: number) {
  return value.toLocaleString("pt-BR", { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
}

export function FaqItem({ answer, question }: { answer: string; question: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-white/10">
      <button
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 py-5 text-left text-base font-bold text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#FFD400]/30"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span>{question}</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.25 }}>
          <ChevronDown className="h-5 w-5 shrink-0 text-[#FFD400]" />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            style={{ overflow: "hidden" }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
          >
            <p className="pb-5 text-sm leading-7 text-[#A3A3A3]">{answer}</p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

const revealVariants: Variants = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } }
};

/** Fade + slide-up disparado quando o elemento entra na viewport (uma vez). */
export function Reveal({
  children,
  className,
  delay = 0
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial="hidden"
      transition={{ delay }}
      variants={revealVariants}
      viewport={{ once: true, margin: "-80px" }}
      whileInView="visible"
    >
      {children}
    </motion.div>
  );
}

const staggerContainerVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } }
};

const staggerItemVariants: Variants = {
  hidden: { opacity: 0, y: 22 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } }
};

/** Container que revela os StaggerItem filhos em sequencia ao entrar na viewport. */
export function StaggerGroup({ children, className }: { children: ReactNode; className?: string }) {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial="hidden"
      variants={staggerContainerVariants}
      viewport={{ once: true, margin: "-60px" }}
      whileInView="visible"
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={staggerItemVariants}>
      {children}
    </motion.div>
  );
}
