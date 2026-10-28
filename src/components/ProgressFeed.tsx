"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { cancelRun } from "@/client/planner";
import { clearError, useRun } from "@/client/runs";
import { IconAlert, IconCheck, IconSparkle } from "./icons";
import { Button, EASE, Notice, SPRING } from "./ui";

/** Named steps as they happen. No generic spinner: every line says what is being done. */
export function ProgressFeed({ tripId, onRetry, compact }: { tripId: string; onRetry?: () => void; compact?: boolean }) {
  const run = useRun(tripId);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!run.job) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [run.job]);

  if (run.error) {
    return (
      <Notice
        tone="danger"
        title={run.error.message}
        action={
          <>
            {onRetry && (
              <Button
                variant="primary"
                onClick={() => {
                  clearError(tripId);
                  onRetry();
                }}
              >
                Try again
              </Button>
            )}
            <Button onClick={() => clearError(tripId)}>Dismiss</Button>
          </>
        }
      >
        {run.error.nextStep}
      </Notice>
    );
  }
  const steps = compact ? run.steps.slice(-3) : run.steps.slice(-7);
  const secs = run.startedAt && now ? Math.max(0, Math.round((now - run.startedAt) / 1000)) : 0;
  return (
    <AnimatePresence>
      {run.job && (
        <motion.section
          key="progress"
          aria-live="polite"
          aria-label="Progress"
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.98 }}
          transition={{ duration: 0.35, ease: EASE }}
          className="relative overflow-hidden rounded-3xl bg-surface shadow-card ring-1 ring-line"
        >
          <div className="h-[3px] w-full bg-surface-2">
            <div className="shimmer-line h-full w-full" />
          </div>
          <div className="p-5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-3">
                <span className="bg-accent-gradient relative flex h-9 w-9 items-center justify-center rounded-xl text-accent-ink shadow-glow">
                  <motion.span animate={{ rotate: [0, 18, -12, 0], scale: [1, 1.12, 1] }} transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}>
                    <IconSparkle size={18} />
                  </motion.span>
                </span>
                <span>
                  <span className="block text-sm font-semibold">Working on it</span>
                  <span className="block text-xs tabular-nums text-muted">{secs}s elapsed</span>
                </span>
              </span>
              <Button variant="ghost" onClick={() => cancelRun(tripId)}>
                Cancel
              </Button>
            </div>
            <ol className="relative mt-4 space-y-2.5">
              <AnimatePresence initial={false} mode="popLayout">
                {steps.map((s, i) => {
                  const last = i === steps.length - 1;
                  return (
                    <motion.li
                      layout
                      key={s.id ?? `${s.at}-${s.message}`}
                      initial={{ opacity: 0, y: 10, filter: "blur(3px)" }}
                      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.35, ease: EASE }}
                      className="flex items-start gap-3 text-sm"
                    >
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
                        {s.warning ? (
                          <IconAlert size={16} className="text-warn" />
                        ) : last ? (
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent/25 border-t-accent" aria-hidden />
                        ) : (
                          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={SPRING} className="flex h-5 w-5 items-center justify-center rounded-full bg-ok-soft text-ok">
                            <IconCheck size={12} />
                          </motion.span>
                        )}
                      </span>
                      <span className={last ? "font-medium text-ink" : "text-muted"}>{s.message}</span>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ol>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
