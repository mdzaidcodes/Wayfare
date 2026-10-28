"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useLiveQuery } from "dexie-react-hooks";
import { useRef, useState } from "react";
import { db, type TripRow } from "@/client/db";
import { useSyncStatus, type SyncStatus } from "@/client/sync";
import { deleteTrip, exportAll, importAll, renameTrip, restoreTrip } from "@/client/trips";
import { formatDateRange, STATUS_LABEL } from "@/lib/format";
import { Logo } from "./Logo";
import { IconChevronLeft, IconChevronRight, IconDownload, IconPencil, IconPlus, IconTrash, IconUpload } from "./icons";
import { useToast } from "./Toast";
import { Button, cx, Dialog, EASE, IconButton, SPRING } from "./ui";

/** A stable, pleasant gradient per trip, so each one is recognisable at a glance. */
const HUES = [172, 200, 24, 340, 262, 140, 42, 214];
export function tripGradient(seed: string): string {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const a = HUES[h % HUES.length];
  const b = (a + 38) % 360;
  return `linear-gradient(135deg, hsl(${a} 62% 52%), hsl(${b} 70% 60%))`;
}

const STATUS_DOT: Record<TripRow["status"], string> = { planning: "bg-muted", ready: "bg-ok", in_progress: "bg-accent" };

export function Sidebar({
  selectedId,
  onSelect,
  onNew,
  collapsed,
  onToggleCollapsed,
  mobile,
}: {
  selectedId?: string;
  onSelect: (id: string | undefined) => void;
  onNew: () => void;
  collapsed: boolean;
  onToggleCollapsed?: () => void;
  mobile?: boolean;
}) {
  const trips = useLiveQuery(() => db().trips.orderBy("createdAt").reverse().toArray(), []);
  const [confirm, setConfirm] = useState<TripRow | null>(null);
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const doDelete = async (t: TripRow) => {
    setConfirm(null);
    const snap = await deleteTrip(t.id);
    if (selectedId === t.id) onSelect(undefined);
    toast({
      message: `Deleted “${t.name}”.`,
      ms: 6000,
      action: snap ? { label: "Undo", run: () => void restoreTrip(snap).then(() => onSelect(t.id)) } : undefined,
    });
  };

  const doExport = async () => {
    const blob = await exportAll();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wayfare-trips-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ message: "Exported all trips. Keep the file somewhere safe." });
  };

  const doImport = async (file: File) => {
    try {
      const r = await importAll(await file.text());
      toast({ message: `Imported ${r.imported} trip${r.imported === 1 ? "" : "s"}${r.skipped ? `, skipped ${r.skipped} damaged` : ""}.` });
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : "Import failed." });
    }
  };

  if (collapsed && !mobile) {
    return (
      <motion.nav
        aria-label="Trips"
        initial={{ width: 288 }}
        animate={{ width: 72 }}
        transition={{ duration: 0.3, ease: EASE }}
        className="glass flex h-full flex-col items-center gap-2 border-r border-line py-3"
      >
        <IconButton label="Expand sidebar" onClick={onToggleCollapsed}>
          <IconChevronRight />
        </IconButton>
        <IconButton label="New trip" onClick={onNew} className="bg-accent-gradient text-accent-ink shadow-glow hover:bg-transparent">
          <IconPlus />
        </IconButton>
        <div className="mt-2 flex flex-1 flex-col items-center gap-2 overflow-y-auto">
          {trips?.map((t) => (
            <IconButton
              key={t.id}
              label={t.name}
              onClick={() => onSelect(t.id)}
              className={cx("text-white ring-offset-2 ring-offset-surface", t.id === selectedId && "ring-2 ring-accent")}
              style={{ background: tripGradient(t.id) }}
            >
              <span className="text-sm font-semibold">{t.name.slice(0, 1).toUpperCase()}</span>
            </IconButton>
          ))}
        </div>
      </motion.nav>
    );
  }

  return (
    <nav aria-label="Trips" className="glass flex h-full w-full flex-col md:w-72 md:border-r md:border-line">
      <div className="flex items-center gap-2 px-4 pt-4">
        <Logo className="flex-1" />
        {!mobile && (
          <IconButton label="Collapse sidebar" onClick={onToggleCollapsed}>
            <IconChevronLeft />
          </IconButton>
        )}
      </div>
      <div className="px-3 pt-4">
        <Button variant="primary" className="w-full rounded-2xl" onClick={onNew}>
          <IconPlus /> New trip
        </Button>
      </div>
      <p className="px-5 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-wider text-muted">Your trips</p>
      <ul className="thin-scrollbar flex-1 space-y-1 overflow-y-auto px-2 pb-3">
        {trips === undefined && (
          <li className="space-y-2 px-2 py-1">
            {[0, 1].map((i) => (
              <div key={i} className="skeleton h-14 rounded-2xl" />
            ))}
          </li>
        )}
        {trips?.length === 0 && (
          <motion.li initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="px-3 py-8 text-center text-sm text-muted">
            No trips yet. Start with <span className="font-medium text-ink">New trip</span>.
          </motion.li>
        )}
        <AnimatePresence initial={false}>
          {trips?.map((t) => (
            <TripItem key={t.id} trip={t} selected={t.id === selectedId} onSelect={() => onSelect(t.id)} onDelete={() => setConfirm(t)} />
          ))}
        </AnimatePresence>
      </ul>
      <div className="flex gap-2 border-t border-line p-3">
        <Button variant="ghost" className="flex-1" onClick={doExport} disabled={!trips?.length}>
          <IconDownload size={18} /> Export
        </Button>
        <Button variant="ghost" className="flex-1" onClick={() => fileRef.current?.click()}>
          <IconUpload size={18} /> Import
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void doImport(f);
            e.target.value = "";
          }}
        />
      </div>
      <SaveNote />
      <Dialog
        open={Boolean(confirm)}
        title={`Delete “${confirm?.name ?? ""}”?`}
        onClose={() => setConfirm(null)}
        actions={
          <>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => confirm && void doDelete(confirm)}>
              Delete
            </Button>
          </>
        }
      >
        Its options, choices, itinerary and checklist are removed from this browser. You can undo for a few seconds.
      </Dialog>
    </nav>
  );
}

function TripItem({ trip, selected, onSelect, onDelete }: { trip: TripRow; selected: boolean; onSelect: () => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(trip.name);
  const save = async () => {
    await renameTrip(trip.id, name);
    setEditing(false);
  };
  return (
    <motion.li
      layout
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -16, height: 0 }}
      transition={SPRING}
      className="group relative rounded-2xl"
    >
      {selected && <motion.span layoutId="trip-active" transition={SPRING} className="absolute inset-0 rounded-2xl bg-surface shadow-card ring-1 ring-line" />}
      <div className="relative flex items-center gap-1 pr-1">
        {editing ? (
          <form
            className="flex-1 p-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <label className="sr-only" htmlFor={`rename-${trip.id}`}>
              Trip name
            </label>
            <input
              id={`rename-${trip.id}`}
              autoFocus
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void save()}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setName(trip.name);
                  setEditing(false);
                }
              }}
              className="min-h-11 w-full rounded-xl bg-surface px-3 text-sm outline-none ring-2 ring-accent"
            />
          </form>
        ) : (
          <button
            type="button"
            onClick={onSelect}
            aria-current={selected ? "page" : undefined}
            className={cx("flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-2xl px-2 py-2 text-left transition-colors", !selected && "hover:bg-surface/60")}
          >
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-semibold text-white shadow-sm"
              style={{ background: tripGradient(trip.id) }}
              aria-hidden
            >
              {(trip.brief?.destination?.name ?? trip.name).slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{trip.name}</span>
              <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[trip.status])} aria-hidden />
                <span className="truncate">
                  {STATUS_LABEL[trip.status]} · {trip.brief?.dates ? formatDateRange(trip.brief) : (trip.brief?.destination?.name ?? "Destination not set")}
                </span>
              </span>
            </span>
          </button>
        )}
        {!editing && (
          <span className="flex transition-opacity md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
            <IconButton
              label={`Rename ${trip.name}`}
              className="text-muted hover:text-ink"
              onClick={() => {
                setName(trip.name);
                setEditing(true);
              }}
            >
              <IconPencil size={16} />
            </IconButton>
            <IconButton label={`Delete ${trip.name}`} onClick={onDelete} className="text-muted hover:text-danger">
              <IconTrash size={16} />
            </IconButton>
          </span>
        )}
      </div>
    </motion.li>
  );
}

const SAVE_NOTE: Record<SyncStatus, string> = {
  unknown: "Trips are saved in this browser.",
  off: "Trips are saved in this browser only. Export them so clearing browser data can’t lose them.",
  saved: "Trips are saved to your database.",
  saving: "Saving to your database…",
  offline: "Offline. Changes are kept here and saved to your database when you’re back online.",
  error: "Couldn’t reach the database. Changes are kept here and retried.",
};

function SaveNote() {
  const status = useSyncStatus();
  return (
    <p role="status" className={cx("px-5 pb-4 text-[11px] leading-relaxed", status === "error" ? "text-warn" : "text-muted")}>
      {SAVE_NOTE[status]}
    </p>
  );
}
