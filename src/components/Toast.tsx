"use client";
import { AnimatePresence, motion } from "framer-motion";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
  ms: number;
}

const Ctx = createContext<(t: Omit<Toast, "id" | "ms"> & { ms?: number }) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const n = useRef(0);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const show = useCallback(
    (t: Omit<Toast, "id" | "ms"> & { ms?: number }) => {
      const id = ++n.current;
      const toast = { ms: 6000, ...t, id };
      setToasts((xs) => [...xs.slice(-2), toast]);
      setTimeout(() => dismiss(id), toast.ms);
    },
    [dismiss],
  );
  return (
    <Ctx.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 24, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
              className="pointer-events-auto flex min-h-12 w-full max-w-md items-center gap-3 rounded-2xl bg-ink/95 px-4 py-2 text-sm text-bg shadow-pop backdrop-blur"
            >
              <span className="flex-1">{t.message}</span>
              {t.action && (
                <button
                  type="button"
                  className="min-h-11 rounded-xl bg-bg/15 px-3 font-semibold transition-colors hover:bg-bg/25"
                  onClick={() => {
                    t.action!.run();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
