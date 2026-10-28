"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useState, type ReactNode } from "react";
import { chooseDestination, editBrief, findDestinations, sendIntake, startPlanning } from "@/client/planner";
import { useRun } from "@/client/runs";
import type { TripData } from "@/client/useTripData";
import { formatDateRange } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import type { TripBrief } from "@/lib/schemas/trip";
import { IconArrowRight, IconCalendar, IconChevronDown, IconHeart, IconMapPin, IconPlane, IconSparkle, IconUsers, IconWallet } from "./icons";
import { ProgressFeed } from "./ProgressFeed";
import { tripGradient } from "./Sidebar";
import { Button, Card, Chip, Collapse, cx, EASE, itemVariants, listVariants, Notice } from "./ui";

const CURRENCIES = ["EUR", "USD", "GBP", "AED", "AUD", "CAD", "CHF", "JPY", "INR", "SGD", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "TRY", "ZAR", "NZD", "MXN", "BRL", "CNY", "HKD", "KRW", "THB"];
const INTERESTS = ["Food", "Beaches", "History", "Museums", "Nature", "Nightlife", "Shopping", "Art", "Hiking", "Family", "Theme parks"];
const EXAMPLES = [
  "Long weekend in Lisbon from London in December, two of us, €1,500, food and history",
  "Somewhere warm with beaches for a week in February, from Dubai, family of four, $6,000",
  "Tokyo for 10 days in April from New York, solo, around $4,000, art and nightlife",
];

const input = "min-h-11 w-full rounded-xl bg-surface-2 px-3 text-sm outline-none ring-1 ring-transparent transition focus:bg-surface focus:ring-accent";

export function IntakeStage({ data }: { data: TripData }) {
  const { trip } = data;
  const run = useRun(trip.id);
  const busy = Boolean(run.job);
  const last = trip.intake.last;
  const brief = trip.brief;
  const [text, setText] = useState(trip.intake.text);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Partial<TripBrief>>(trip.intake.form);
  const [answer, setAnswer] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const destinations = data.options.destinations?.destinations;

  const submit = () => void sendIntake(trip, { text, form }).catch(() => {});
  const answerQ = (a: string) => {
    if (!last?.question) return;
    setAnswer("");
    void sendIntake(trip, { answer: { field: last.question.field, answer: a } }).catch(() => {});
  };
  const setF = (patch: Partial<TripBrief>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <div className="space-y-5">
      <Card initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE }}>
        <label htmlFor="trip-text" className="font-display block text-2xl font-semibold tracking-tight md:text-3xl">
          Where do you want to go, and what are you after?
        </label>
        <p className="mt-1.5 text-sm text-muted">Describe it like you would to a friend. Anything you leave out, we&apos;ll ask about.</p>
        <div className="group relative mt-4">
          <textarea
            id="trip-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="Somewhere warm with beaches and good food, about a week, not too expensive. Flying from London, two of us, around £2,000."
            className="w-full resize-y rounded-2xl bg-surface-2 p-4 text-base leading-relaxed outline-none ring-1 ring-transparent transition placeholder:text-muted/70 focus:bg-surface focus:shadow-glow focus:ring-accent"
          />
        </div>
        <AnimatePresence initial={false}>
          {!text.trim() && !last && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <motion.div variants={listVariants} initial="hidden" animate="show" className="flex flex-wrap gap-2 pb-1 pt-3">
                <span className="self-center text-xs font-medium text-muted">Try:</span>
                {EXAMPLES.map((e) => (
                  <motion.button
                    key={e}
                    type="button"
                    variants={itemVariants}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => setText(e)}
                    className="min-h-11 max-w-full rounded-2xl bg-surface px-3 py-2 text-left text-xs text-muted shadow-sm ring-1 ring-line transition-colors hover:text-ink hover:ring-accent/40"
                  >
                    {e}
                  </motion.button>
                ))}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setShowForm((s) => !s)}
            aria-expanded={showForm}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-medium text-accent transition-colors hover:bg-accent-soft"
          >
            <IconChevronDown className={cx("transition-transform duration-300", showForm && "rotate-180")} size={18} />
            {showForm ? "Hide details form" : "Or fill in details (optional)"}
          </button>
          <Button variant="primary" className="min-h-12 rounded-2xl px-5" onClick={submit} disabled={busy || (!text.trim() && !Object.keys(form).length)}>
            <IconSparkle size={18} /> {last ? "Update" : "Start planning"}
          </Button>
        </div>
        <Collapse open={showForm}>
          <div className="mt-4 grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
            <Field label="Destination">
              <input className={input} value={form.destination?.name ?? ""} onChange={(e) => setF({ destination: e.target.value ? { name: e.target.value } : undefined })} placeholder="e.g. Lisbon" />
            </Field>
            <Field label="Starting point">
              <input className={input} value={form.origin?.name ?? ""} onChange={(e) => setF({ origin: e.target.value ? { name: e.target.value } : undefined })} placeholder="e.g. London" />
            </Field>
            <Field label="Depart">
              <input
                type="date"
                className={input}
                value={form.dates?.type === "fixed" ? form.dates.departDate : ""}
                onChange={(e) => setF({ dates: e.target.value ? { type: "fixed", departDate: e.target.value, returnDate: form.dates?.type === "fixed" ? form.dates.returnDate : e.target.value } : undefined })}
              />
            </Field>
            <Field label="Return">
              <input
                type="date"
                className={input}
                value={form.dates?.type === "fixed" ? form.dates.returnDate : ""}
                onChange={(e) => form.dates?.type === "fixed" && setF({ dates: { ...form.dates, returnDate: e.target.value } })}
              />
            </Field>
            <Field label="Nights (if dates are flexible)">
              <input type="number" min={1} max={60} className={input} value={form.nights ?? ""} onChange={(e) => setF({ nights: e.target.value ? Number(e.target.value) : undefined })} />
            </Field>
            <Field label="Travelers">
              <input type="number" min={1} max={9} className={input} value={form.travelers ?? ""} onChange={(e) => setF({ travelers: e.target.value ? Number(e.target.value) : undefined })} />
            </Field>
            <Field label="Total budget">
              <div className="flex gap-2">
                <input
                  type="number"
                  min={1}
                  className={input}
                  value={form.budget?.amount ?? ""}
                  onChange={(e) => setF({ budget: e.target.value ? { amount: Number(e.target.value), currency: form.budget?.currency ?? "EUR" } : undefined })}
                />
                <select
                  aria-label="Currency"
                  className={cx(input, "w-28")}
                  value={form.budget?.currency ?? "EUR"}
                  onChange={(e) => form.budget && setF({ budget: { ...form.budget, currency: e.target.value } })}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
            </Field>
            <div className="sm:col-span-2">
              <span className="text-xs font-medium text-muted">Interests</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {INTERESTS.map((i) => {
                  const on = form.interests?.includes(i.toLowerCase());
                  return (
                    <Chip
                      key={i}
                      selected={on}
                      onClick={() => setF({ interests: on ? form.interests!.filter((x) => x !== i.toLowerCase()) : [...(form.interests ?? []), i.toLowerCase()] })}
                    >
                      {i}
                    </Chip>
                  );
                })}
              </div>
            </div>
          </div>
        </Collapse>
      </Card>

      <ProgressFeed tripId={trip.id} onRetry={submit} />

      <AnimatePresence>
        {last?.question && !busy && (
          <motion.section
            key={last.question.field}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.4, ease: EASE }}
            className="flex gap-3"
          >
            <span className="bg-accent-gradient mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-accent-ink shadow-glow" aria-hidden>
              <IconSparkle size={18} />
            </span>
            <div className="min-w-0 flex-1 rounded-3xl rounded-tl-md bg-surface p-5 shadow-card ring-1 ring-accent/25">
              <p className="text-base font-medium">{last.question.text}</p>
              <motion.div variants={listVariants} initial="hidden" animate="show" className="mt-3 flex flex-wrap gap-2">
                {last.question.chips.map((c) => (
                  <motion.span key={c} variants={itemVariants}>
                    <Chip onClick={() => answerQ(c)}>{c}</Chip>
                  </motion.span>
                ))}
              </motion.div>
              <form
                className="mt-4 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (answer.trim()) answerQ(answer.trim());
                }}
              >
                <label htmlFor="answer" className="sr-only">
                  Your answer
                </label>
                <input id="answer" className={input} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Or type an answer" />
                <Button type="submit" variant="primary" disabled={!answer.trim()}>
                  Send
                </Button>
              </form>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {brief && (
        <Card initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE, delay: 0.05 }}>
          <h2 className="font-display text-lg font-semibold">Your trip so far</h2>
          <motion.dl variants={listVariants} initial="hidden" animate="show" className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <Tile Icon={IconPlane} label="From">
              {brief.origin?.name ?? "—"}
            </Tile>
            <Tile Icon={IconMapPin} label="To">
              {brief.destination ? `${brief.destination.name}${brief.destination.country ? `, ${brief.destination.country}` : ""}` : brief.vibe ? `Suggest a place: ${brief.vibe}` : "—"}
            </Tile>
            <Tile Icon={IconCalendar} label="When">
              {formatDateRange(brief)}
              {brief.nights ? ` · ${brief.nights} nights` : ""}
            </Tile>
            <Tile Icon={IconUsers} label="Who">
              {brief.travelers ? `${brief.travelers} traveler${brief.travelers > 1 ? "s" : ""}${brief.rooms ? `, ${brief.rooms} room${brief.rooms > 1 ? "s" : ""}` : ""}` : "—"}
            </Tile>
            <Tile Icon={IconWallet} label="Budget">
              {brief.budget ? formatMoney(brief.budget) : "—"}
            </Tile>
            {brief.interests.length > 0 && (
              <Tile Icon={IconHeart} label="Into">
                <span className="capitalize">{brief.interests.join(", ")}</span>
              </Tile>
            )}
          </motion.dl>
          {brief.assumptions.length > 0 && (
            <div className="mt-5">
              <p className="text-xs font-medium text-muted">Assumptions (tap to change)</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {brief.assumptions.map((a) =>
                  editing === a.field ? (
                    <form
                      key={a.field}
                      className="flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        setEditing(null);
                        if (a.field === "rooms" && Number(editValue) > 0) void editBrief(trip, { rooms: Number(editValue) }, "rooms");
                        else if (a.field === "cabin") {
                          const v = editValue.toLowerCase().replace(/\s+/g, "_");
                          if (["economy", "premium_economy", "business", "first"].includes(v)) void editBrief(trip, { cabin: v as TripBrief["cabin"] }, "cabin");
                        } else void sendIntake(trip, { answer: { field: a.field, answer: editValue } }).catch(() => {});
                      }}
                    >
                      <input autoFocus aria-label={a.label} className={cx(input, "w-44")} value={editValue} onChange={(e) => setEditValue(e.target.value)} />
                      <Button type="submit">Save</Button>
                    </form>
                  ) : (
                    <Chip
                      key={a.field}
                      onClick={() => {
                        setEditing(a.field);
                        setEditValue(a.value);
                      }}
                    >
                      <span className="text-muted">{a.label}:</span> {a.value}
                    </Chip>
                  ),
                )}
              </div>
            </div>
          )}
          {last?.ready && !busy && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-6 flex flex-wrap justify-end gap-2">
              {brief.destination ? (
                <Button variant="primary" className="group min-h-12 rounded-2xl px-5" onClick={() => void startPlanning(trip).catch(() => {})}>
                  Find flights, stays and things to do
                  <IconArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
                </Button>
              ) : (
                <Button variant="primary" className="group min-h-12 rounded-2xl px-5" onClick={() => void findDestinations(trip).catch(() => {})}>
                  Suggest destinations that fit
                  <IconArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
                </Button>
              )}
            </motion.div>
          )}
        </Card>
      )}

      {destinations && !brief?.destination && (
        <section className="space-y-4">
          <h2 className="font-display text-xl font-semibold">Places that fit your budget</h2>
          {destinations.problems.map((p) => (
            <Notice key={p} tone="warn">
              {p}
            </Notice>
          ))}
          {destinations.candidates.length === 0 && !destinations.problems.length && (
            <Notice tone="warn" title="No destination fit the budget with real prices.">
              Try a bigger budget, fewer nights, or name a destination.
            </Notice>
          )}
          <motion.div variants={listVariants} initial="hidden" animate="show" className="grid gap-4 sm:grid-cols-3">
            {destinations.candidates.map((c) => (
              <motion.article
                key={c.name}
                variants={itemVariants}
                whileHover={{ y: -4 }}
                className="flex flex-col overflow-hidden rounded-3xl bg-surface shadow-card ring-1 ring-line transition-shadow hover:shadow-pop"
              >
                <div className="relative flex h-28 items-end p-4 text-white" style={{ background: tripGradient(c.name) }}>
                  <div aria-hidden className="absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/15 blur-xl" />
                  <div className="relative">
                    <h3 className="font-display text-2xl font-semibold leading-none drop-shadow-sm">{c.name}</h3>
                    <p className="mt-1 text-xs text-white/85">{c.country}</p>
                  </div>
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <p className="flex-1 text-sm leading-relaxed text-ink/80">{c.why}</p>
                  <p className="mt-3 text-sm">
                    Flight + hotel from <span className="font-semibold">{formatMoney(c.coreCost)}</span>
                    <span className="block text-[11px] text-muted">checked against real prices</span>
                  </p>
                  <Button variant="primary" className="mt-4 rounded-2xl" onClick={() => void chooseDestination(trip, c)}>
                    Choose {c.name}
                  </Button>
                </div>
              </motion.article>
            ))}
          </motion.div>
          {destinations.rejected.length > 0 && (
            <p className="text-xs text-muted">Not shown: {destinations.rejected.map((r) => `${r.name} (${r.reason})`).join("; ")}.</p>
          )}
        </section>
      )}
    </div>
  );
}

function Tile({ Icon, label, children }: { Icon: typeof IconPlane; label: string; children: ReactNode }) {
  return (
    <motion.div variants={itemVariants} className="rounded-2xl bg-surface-2/70 p-3">
      <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
        <Icon size={13} className="text-accent" /> {label}
      </dt>
      <dd className="mt-1 text-sm font-medium leading-snug">{children}</dd>
    </motion.div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
