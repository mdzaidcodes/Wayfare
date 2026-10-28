"use client";
import { animate, AnimatePresence, motion, useReducedMotion, type HTMLMotionProps, type Variants } from "framer-motion";
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { IconAlert, IconCheck, IconInfo } from "./icons";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

// ---------- Motion presets ----------

export const EASE = [0.22, 1, 0.36, 1] as const;
export const SPRING = { type: "spring", stiffness: 420, damping: 34, mass: 0.8 } as const;

/** Parent of a staggered list: children with `itemVariants` rise in one after another. */
export const listVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.045, delayChildren: 0.04 } },
};
export const itemVariants: Variants = {
  hidden: { opacity: 0, y: 14, filter: "blur(4px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.45, ease: EASE } },
};

/** Height-animated show/hide. Clips only while animating, so focus rings at the edges stay visible. */
export function Collapse({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0, overflow: "hidden" }}
          animate={{ height: "auto", opacity: 1, transitionEnd: { overflow: "visible" } }}
          exit={{ height: 0, opacity: 0, overflow: "hidden" }}
          transition={{ height: { duration: 0.35, ease: EASE }, opacity: { duration: 0.25 } }}
          className={className}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** A number that counts smoothly to its new value. */
export function AnimatedNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (reduce) {
      from.current = value;
      const raf = requestAnimationFrame(() => setShown(value));
      return () => cancelAnimationFrame(raf);
    }
    const c = animate(from.current, value, {
      duration: 0.7,
      ease: EASE,
      onUpdate: (v) => setShown(v),
    });
    from.current = value;
    return () => c.stop();
  }, [value, reduce]);
  // Whole units while counting, the exact amount once it lands.
  return <span className="tabular-nums">{format(shown === value ? value : Math.round(shown))}</span>;
}

// ---------- Buttons ----------

type Variant = "primary" | "secondary" | "ghost" | "danger" | "soft";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent-gradient text-accent-ink shadow-glow hover:brightness-110 disabled:opacity-50 disabled:shadow-none",
  secondary: "bg-surface text-ink ring-1 ring-line-strong shadow-sm hover:bg-surface-2 disabled:opacity-50",
  ghost: "text-ink hover:bg-surface-2 disabled:opacity-50",
  soft: "bg-accent-soft text-accent hover:brightness-105 disabled:opacity-50",
  danger: "bg-danger text-white hover:brightness-110 disabled:opacity-50",
};

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onAnimationStart" | "onDrag" | "onDragStart" | "onDragEnd"> & { variant?: Variant };

export function Button({ variant = "secondary", className, children, ...p }: ButtonProps) {
  return (
    <motion.button
      type="button"
      whileTap={p.disabled ? undefined : { scale: 0.97 }}
      transition={SPRING}
      {...p}
      className={cx(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium transition-[filter,background-color,box-shadow] disabled:cursor-not-allowed",
        VARIANTS[variant],
        className,
      )}
    >
      {children}
    </motion.button>
  );
}

export function IconButton({ label, className, children, ...p }: ButtonProps & { label: string }) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      whileTap={{ scale: 0.92 }}
      transition={SPRING}
      {...p}
      className={cx("inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink transition-colors hover:bg-surface-2 disabled:opacity-40", className)}
    >
      {children}
    </motion.button>
  );
}

export function Chip({ selected, className, children, ...p }: ButtonProps & { selected?: boolean }) {
  return (
    <motion.button
      type="button"
      aria-pressed={selected}
      whileTap={{ scale: 0.95 }}
      whileHover={{ y: -1 }}
      transition={SPRING}
      {...p}
      className={cx(
        "inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm transition-colors",
        selected ? "bg-accent-soft text-accent ring-1 ring-accent/40" : "bg-surface text-ink shadow-sm ring-1 ring-line hover:ring-line-strong",
        className,
      )}
    >
      {selected && (
        <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={SPRING} className="-ml-1">
          <IconCheck size={14} />
        </motion.span>
      )}
      {children}
    </motion.button>
  );
}

export function Badge({ tone = "neutral", children, className }: { tone?: "neutral" | "ok" | "warn" | "danger" | "accent" | "sun"; children: ReactNode; className?: string }) {
  const tones = {
    neutral: "bg-surface-2 text-muted",
    ok: "bg-ok-soft text-ok",
    warn: "bg-warn-soft text-warn",
    danger: "bg-danger-soft text-danger",
    accent: "bg-accent-soft text-accent",
    sun: "bg-sun-soft text-sun",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", tones[tone], className)}>{children}</span>;
}

// ---------- Checkbox ----------

/**
 * Animated checkbox. A real (transparent) input sits on top, so keyboard, screen readers and forms
 * behave natively; the box and tick underneath are decoration.
 */
export function Checkbox({ checked, onChange, label, size = "md" }: { checked: boolean; onChange: () => void; label: string; size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-6 w-6 rounded-lg" : "h-[22px] w-[22px] rounded-md";
  return (
    <span className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center">
      <motion.span
        aria-hidden
        className={cx("flex items-center justify-center ring-2 transition-colors", box, checked ? "bg-accent-gradient ring-transparent" : "bg-surface ring-line-strong")}
        animate={{ scale: checked ? [1, 0.85, 1.08, 1] : 1 }}
        transition={{ duration: 0.35, ease: EASE }}
      >
        <svg viewBox="0 0 24 24" className="h-[70%] w-[70%]" fill="none" stroke="var(--accent-ink)" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
          <motion.path d="M5 12.5l4.5 4.5L19 7.5" initial={false} animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }} transition={{ duration: 0.3, ease: EASE }} />
        </svg>
      </motion.span>
      <input type="checkbox" checked={checked} onChange={onChange} aria-label={label} className="absolute inset-0 cursor-pointer opacity-0" />
    </span>
  );
}

// ---------- Overlays and notices ----------

export function Dialog({
  open,
  title,
  children,
  onClose,
  actions,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  onClose: () => void;
  actions: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      className="m-auto w-[min(92vw,26rem)] rounded-3xl bg-surface p-0 text-ink shadow-pop ring-1 ring-line backdrop:bg-black/40 backdrop:backdrop-blur-sm"
    >
      {open && (
        <motion.div initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={SPRING} className="p-6">
          <h2 className="font-display text-xl font-semibold">{title}</h2>
          {children && <div className="mt-2 text-sm text-muted">{children}</div>}
          <div className="mt-6 flex flex-wrap justify-end gap-2">{actions}</div>
        </motion.div>
      )}
    </dialog>
  );
}

export function Notice({ tone = "info", title, children, action }: { tone?: "info" | "warn" | "danger" | "ok"; title?: string; children?: ReactNode; action?: ReactNode }) {
  const tones = {
    info: "bg-surface ring-line shadow-sm",
    warn: "bg-warn-soft ring-warn/20",
    danger: "bg-danger-soft ring-danger/25",
    ok: "bg-ok-soft ring-ok/25",
  };
  const iconTone = { info: "text-accent", warn: "text-warn", danger: "text-danger", ok: "text-ok" }[tone];
  const Icon = tone === "info" || tone === "ok" ? IconInfo : IconAlert;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE }}
      role={tone === "danger" ? "alert" : "status"}
      className={cx("flex gap-3 rounded-2xl p-4 text-sm ring-1", tones[tone])}
    >
      <Icon size={18} className={cx("mt-0.5 shrink-0", iconTone)} />
      <div className="min-w-0 flex-1">
        {title && <div className="font-medium">{title}</div>}
        {children && <div className={cx(title && "mt-1", "text-ink/75")}>{children}</div>}
        {action && <div className="mt-3 flex flex-wrap gap-2">{action}</div>}
      </div>
    </motion.div>
  );
}

/** Small "working" line: a pulsing dot and what is happening. */
export function Working({ children }: { children: ReactNode }) {
  return (
    <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} aria-live="polite" className="flex items-center gap-2.5 text-sm text-muted">
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inset-0 animate-ping rounded-full bg-accent/50" />
        <span className="relative h-2.5 w-2.5 rounded-full bg-accent" />
      </span>
      {children}
    </motion.p>
  );
}

export function Card({ className, children, ...p }: HTMLMotionProps<"section">) {
  return (
    <motion.section className={cx("rounded-3xl bg-surface p-5 shadow-card ring-1 ring-line md:p-6", className)} {...p}>
      {children}
    </motion.section>
  );
}
