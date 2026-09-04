import { AnimatePresence, motion, useInView, useMotionValue, useReducedMotion, useSpring, type Variants } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import "./core-theme.css";

export function HomeShell({ children }: { children: ReactNode }) {
  return (
    <main className="core-theme relative min-h-screen w-full overflow-x-clip bg-[#060606] text-white">
      <div aria-hidden className="core-mesh" />
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
      <div className="mx-auto w-full max-w-[1560px] px-[var(--core-margin)]">
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
      {eyebrow ? (
        <div className={`mb-5 flex items-center gap-3 ${align === "center" ? "justify-center" : ""}`}>
          <span className="core-voice-rail text-[#FFD400]">{eyebrow}</span>
          <InkRule className={align === "center" ? "hidden" : "w-16"} />
        </div>
      ) : null}
      <h2 className="core-voice-poster text-balance text-3xl text-white sm:text-4xl lg:text-[3.25rem]">{title}</h2>
      <p className="core-voice-body mt-5 text-pretty text-base text-[#9b9b9b] sm:text-lg">{subtitle}</p>
    </div>
  );
}

/** Fio de 1px que se "desenha" da esquerda para a direita ao entrar na tela. */
export function InkRule({ className = "" }: { className?: string }) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.span
      className={`block h-px bg-[var(--rule-ink)] ${className}`}
      initial={reduceMotion ? undefined : { clipPath: "inset(0 100% 0 0)" }}
      transition={{ duration: 0.95, ease: [0.16, 1, 0.3, 1] }}
      viewport={{ once: true, margin: "-60px" }}
      whileInView={reduceMotion ? undefined : { clipPath: "inset(0 0% 0 0)" }}
    />
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
  const brand = variant === "primary";
  const shared = [
    "core-voice-caption core-chamfer-outline core-press",
    brand ? "is-brand text-black" : "text-white hover:text-white",
    "inline-flex min-h-12 items-center justify-center gap-2 px-6 transition-colors duration-200",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFD400]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#060606]",
    className
  ].join(" ");

  if (href) {
    return (
      <motion.a className={shared} href={href} whileTap={{ y: 1 }}>
        {children}
      </motion.a>
    );
  }

  return (
    <motion.button className={shared} onClick={onClick} type="button" whileTap={{ y: 1 }}>
      {children}
    </motion.button>
  );
}

/** Painel chanfrado com fio de 1px — substitui o antigo card arredondado com sombra. */
export function GlowCard({
  children,
  className = ""
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.div className={`core-chamfer-outline ${className}`} whileHover={{ y: -4 }}>
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
    <div className="min-w-0 border-l border-[var(--rule-soft)] px-4 first:border-l-0 sm:px-6">
      {typeof numericValue === "number" ? (
        <CountUp className="core-mono truncate text-2xl font-bold text-white sm:text-[2rem]" decimals={decimals} prefix={prefix} suffix={suffix} value={numericValue} />
      ) : (
        <p className="core-mono truncate text-2xl font-bold text-white sm:text-[2rem]">{value}</p>
      )}
      <p className="core-voice-rail mt-2.5 truncate text-[#8a8a8a]">{label}</p>
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
    <div className="border-b border-[var(--rule-soft)] last:border-b-0">
      <button
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 py-5 text-left text-base font-semibold text-white transition-colors hover:text-[#FFD400] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FFD400]/50"
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
            <p className="core-voice-body pb-5 text-sm text-[#9b9b9b]">{answer}</p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

const revealVariants: Variants = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.62, ease: [0.16, 1, 0.3, 1] } }
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
  hidden: { opacity: 0, y: 18 },
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
