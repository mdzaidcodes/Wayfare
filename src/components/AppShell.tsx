"use client";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { startSync } from "@/client/sync";
import { createTrip } from "@/client/trips";
import type { CapabilityReport } from "@/server/capabilities";
import { IconAlert, IconArrowRight, IconBed, IconCalendar, IconChevronDown, IconClose, IconMenu, IconPlane, IconTicket, IconWallet } from "./icons";
import { Logo } from "./Logo";
import { Sidebar } from "./Sidebar";
import { ToastProvider } from "./Toast";
import { TripView } from "./TripView";
import { Button, Collapse, cx, EASE, IconButton, itemVariants, listVariants } from "./ui";

function readHash(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const m = window.location.hash.match(/trip=([\w-]+)/);
  return m?.[1];
}

export function AppShell({ report }: { report: CapabilityReport | null }) {
  const [tripId, setTripId] = useState<string | undefined>(undefined);
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [online, setOnline] = useState(true);
  const [showLimited, setShowLimited] = useState(false);

  useEffect(() => {
    startSync();
    const sync = () => setTripId(readHash());
    // Read browser-only state after mount (the first render also runs on the server).
    const raf = requestAnimationFrame(() => {
      sync();
      try {
        setCollapsed(localStorage.getItem("wayfare.sidebar") === "collapsed");
      } catch {}
      setOnline(navigator.onLine);
    });
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("hashchange", sync);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
    }
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const select = useCallback((id: string | undefined) => {
    history.replaceState(null, "", id ? `#trip=${id}` : location.pathname);
    setTripId(id);
    setDrawer(false);
  }, []);

  const newTrip = useCallback(async () => {
    const t = await createTrip();
    select(t.id);
  }, [select]);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("wayfare.sidebar", c ? "open" : "collapsed");
      } catch {}
      return !c;
    });
  };

  const limited = report?.capabilities.filter((c) => c.status !== "active") ?? [];

  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <div className="ambient flex h-dvh overflow-hidden">
          <div className="hidden md:block">
            <Sidebar selectedId={tripId} onSelect={select} onNew={() => void newTrip()} collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
          </div>

          <AnimatePresence>
            {drawer && (
              <>
                <motion.div
                  className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] md:hidden"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setDrawer(false)}
                />
                <motion.div
                  role="dialog"
                  aria-modal="true"
                  aria-label="Trips"
                  className="fixed inset-y-0 left-0 z-50 w-[86vw] max-w-sm overflow-hidden rounded-r-3xl shadow-pop md:hidden"
                  initial={{ x: "-100%" }}
                  animate={{ x: 0 }}
                  exit={{ x: "-100%" }}
                  transition={{ type: "spring", stiffness: 380, damping: 38 }}
                >
                  <div className="absolute right-3 top-3 z-10">
                    <IconButton label="Close trips" onClick={() => setDrawer(false)}>
                      <IconClose />
                    </IconButton>
                  </div>
                  <Sidebar selectedId={tripId} onSelect={select} onNew={() => void newTrip()} collapsed={false} mobile />
                </motion.div>
              </>
            )}
          </AnimatePresence>

          <main className="thin-scrollbar flex min-w-0 flex-1 flex-col overflow-y-auto">
            <header className="glass sticky top-0 z-20 flex items-center gap-2 border-b border-line px-2 py-1.5 md:hidden">
              <IconButton label="Open trips" onClick={() => setDrawer(true)}>
                <IconMenu />
              </IconButton>
              <Logo />
            </header>
            {report?.demoData && (
              <div className="bg-gradient-to-r from-demo to-[#a24bd6] px-4 py-1.5 text-center text-xs font-semibold tracking-wide text-white">
                DEMO DATA — fixtures may be shown. Not real prices.
              </div>
            )}
            <AnimatePresence>
              {!online && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden bg-warn-soft text-center text-sm text-warn"
                >
                  <p className="px-4 py-2">You&apos;re offline. Saved trips and itineraries still work; searches need a connection.</p>
                </motion.div>
              )}
            </AnimatePresence>
            {limited.length > 0 && (
              <div className="px-4 pt-3 md:px-8">
                <div className="mx-auto max-w-6xl">
                  <button
                    type="button"
                    onClick={() => setShowLimited((v) => !v)}
                    aria-expanded={showLimited}
                    className={cx(
                      "inline-flex min-h-9 items-center gap-2 rounded-full px-3 text-left text-xs font-medium ring-1 transition-colors",
                      report?.canPlan ? "bg-warn-soft text-warn ring-warn/20" : "bg-danger-soft text-danger ring-danger/25",
                    )}
                  >
                    <IconAlert size={14} className="shrink-0" />
                    {report?.canPlan ? `${limited.length} data source${limited.length > 1 ? "s" : ""} not set up. Some results will be limited.` : "Planning is unavailable: no OpenAI key is set."}
                    <IconChevronDown size={14} className={cx("shrink-0 transition-transform", showLimited && "rotate-180")} />
                  </button>
                  <Collapse open={showLimited}>
                    <ul className="mt-2 space-y-1 rounded-2xl bg-surface p-4 text-sm shadow-sm ring-1 ring-line">
                      {limited.map((c) => (
                        <li key={c.id}>
                          <span className="font-medium">{c.name}:</span> {c.impact} {c.envVar && <span className="text-muted">(set {c.envVar} in .env.local)</span>}
                        </li>
                      ))}
                    </ul>
                  </Collapse>
                </div>
              </div>
            )}
            <AnimatePresence mode="wait">
              {tripId ? (
                <motion.div
                  key={tripId}
                  className="flex flex-1 flex-col"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.35, ease: EASE }}
                >
                  <TripView tripId={tripId} />
                </motion.div>
              ) : (
                <motion.div key="welcome" className="flex flex-1 flex-col" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <Welcome onNew={() => void newTrip()} />
                </motion.div>
              )}
            </AnimatePresence>
          </main>
        </div>
      </ToastProvider>
    </MotionConfig>
  );
}

const FEATURES = [
  { Icon: IconWallet, title: "Real prices, within budget", body: "Every option is checked against your budget before you see it." },
  { Icon: IconPlane, title: "Compare booking sites", body: "See the price on each site, then book where you like." },
  { Icon: IconCalendar, title: "A plan you can tick off", body: "Your picks become a day-by-day itinerary that works offline." },
];

// A gentle arc from one city to another, with a plane flying along it.
const ROUTE = "M 20 120 C 120 10, 300 10, 400 100";

function Welcome({ onNew }: { onNew: () => void }) {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-6 py-14">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="animate-float absolute -right-24 -top-24 h-96 w-96 rounded-full bg-accent/20 blur-3xl" />
        <div className="animate-float-slow absolute -bottom-32 -left-24 h-96 w-96 rounded-full bg-sun/15 blur-3xl" />
      </div>

      <motion.div variants={listVariants} initial="hidden" animate="show" className="relative mx-auto flex max-w-2xl flex-col items-center text-center">
        <motion.svg variants={itemVariants} viewBox="0 0 420 140" className="mb-4 h-24 w-72 md:h-28 md:w-80" aria-hidden>
          <motion.path
            d={ROUTE}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={2}
            strokeDasharray="6 8"
            strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.6 }}
            transition={{ duration: 1.6, ease: EASE, delay: 0.3 }}
          />
          <circle cx="20" cy="120" r="6" fill="var(--accent)" />
          <circle cx="20" cy="120" r="12" fill="var(--accent)" opacity={0.15} />
          <circle cx="400" cy="100" r="6" fill="var(--sun)" />
          <circle cx="400" cy="100" r="12" fill="var(--sun)" opacity={0.18} />
          <motion.g
            style={{ offsetPath: `path("${ROUTE}")`, offsetRotate: "auto" }}
            initial={{ offsetDistance: "0%", opacity: 0 }}
            animate={{ offsetDistance: "100%", opacity: [0, 1, 1, 0] }}
            transition={{ duration: 3.2, ease: "easeInOut", delay: 0.4, repeat: Infinity, repeatDelay: 1.4 }}
          >
            <path d="M-9 -2 L4 -2 L9 0 L4 2 L-9 2 Z M-3 -2 L-7 -8 L-4 -8 L2 -2 Z M-3 2 L-7 8 L-4 8 L2 2 Z" fill="var(--ink)" />
          </motion.g>
        </motion.svg>

        <motion.span
          variants={itemVariants}
          className="inline-flex items-center gap-2 rounded-full bg-surface/70 px-3 py-1 text-xs font-medium text-muted shadow-sm ring-1 ring-line backdrop-blur"
        >
          <IconPlane size={14} className="text-accent" /> Flights <span aria-hidden>·</span>
          <IconBed size={14} className="text-accent" /> Stays <span aria-hidden>·</span>
          <IconTicket size={14} className="text-accent" /> Things to do
        </motion.span>
        <motion.h1 variants={itemVariants} className="font-display mt-5 text-4xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
          Plan a whole trip <span className="text-gradient">from one sentence.</span>
        </motion.h1>
        <motion.p variants={itemVariants} className="mt-5 max-w-lg text-base text-muted md:text-lg">
          Real flights, hotels and things to do, all within your budget. You choose where to book, and Wayfare turns your picks into a day-by-day plan.
        </motion.p>
        <motion.div variants={itemVariants}>
          <Button variant="primary" className="group mt-8 min-h-12 rounded-2xl px-6 text-base" onClick={onNew}>
            Start a new trip
            <IconArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
          </Button>
        </motion.div>

        <motion.ul variants={listVariants} className="mt-14 grid w-full gap-3 text-left sm:grid-cols-3">
          {FEATURES.map(({ Icon, title, body }) => (
            <motion.li key={title} variants={itemVariants} whileHover={{ y: -3 }} className="rounded-2xl bg-surface/80 p-4 shadow-card ring-1 ring-line backdrop-blur">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <Icon size={18} />
              </span>
              <p className="mt-3 text-sm font-semibold">{title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">{body}</p>
            </motion.li>
          ))}
        </motion.ul>
      </motion.div>
    </div>
  );
}
