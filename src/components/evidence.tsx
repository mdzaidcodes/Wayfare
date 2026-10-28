"use client";
import { useState } from "react";
import type { Conversion } from "@/lib/money";
import { formatMoney } from "@/lib/money";
import { PRICE_MAY_DIFFER, type BookingLink } from "@/lib/booking-links";
import type { Money, Photo } from "@/lib/schemas/common";
import type { EvidenceRecord } from "@/lib/schemas/evidence";
import { fetchedLabel } from "@/lib/format";
import { IconChevronLeft, IconChevronRight, IconExternal, IconImageOff } from "./icons";
import { cx } from "./ui";

export function SourceBadge({ record, className }: { record: EvidenceRecord; className?: string }) {
  return (
    <span
      className={cx("inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-muted", className)}
      title={`Fetched ${new Date(record.fetchedAt).toLocaleString()} from ${record.source}`}
    >
      <span className="relative flex h-1.5 w-1.5" aria-hidden>
        <span className={cx("relative h-1.5 w-1.5 rounded-full", record.demo ? "bg-demo" : "bg-ok")} />
      </span>
      {record.demo ? "DEMO DATA" : "Live"} · {record.source} · {fetchedLabel(record.fetchedAt)}
    </span>
  );
}

export function NotProvided({ what }: { what?: string }) {
  return <span className="text-muted italic">{what ? `${what}: ` : ""}Not provided by source</span>;
}

/** A price with "as of" time and, when converted, the rate and date used. */
export function PriceLine({ money, conversion, asOf, label, estimate }: { money?: Money; conversion?: Conversion; asOf: string; label?: string; estimate?: boolean }) {
  if (!money) return <NotProvided what={label ?? "Price"} />;
  return (
    <span className="inline-flex flex-col">
      <span className="text-xl font-semibold tabular-nums tracking-tight">
        {money.amount === 0 && !estimate ? "Free" : formatMoney(money)}
        {label && <span className="ml-1 text-xs font-normal text-muted">{label}</span>}
      </span>
      <span className="text-[11px] text-muted">
        as of {fetchedLabel(asOf)}
        {conversion?.converted && (
          <>
            {" "}
            · from {formatMoney(conversion.original)} at {conversion.rate.toFixed(4)} ({conversion.rateOrigin ?? "reference rate"}, {conversion.rateDate})
          </>
        )}
      </span>
    </span>
  );
}

export function PhotoImg({ photo, alt, className, sizes, iconOnly }: { photo?: Photo; alt: string; className?: string; sizes?: string; iconOnly?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (!photo || failed) {
    // Thumbnails draw their own placeholder underneath.
    if (iconOnly) return null;
    return (
      <div className={cx("flex flex-col items-center justify-center gap-1 bg-surface-2 text-xs text-muted", className)} role="img" aria-label={`${alt}: no photo available`}>
        <IconImageOff />
        No photo available
      </div>
    );
  }
  return (
    <figure className={cx("relative overflow-hidden", !iconOnly && "bg-surface-2", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- provider photos, sized by the provider */}
      <img
        src={photo.url}
        alt={alt}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        sizes={sizes}
        onError={() => setFailed(true)}
        className="h-full w-full object-cover"
      />
      {photo.attribution && (
        <figcaption className="absolute bottom-1 right-1 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white">Photo: {photo.attribution}</figcaption>
      )}
    </figure>
  );
}

/** Swipeable gallery of real provider photos. */
export function Gallery({ photos, alt }: { photos: Photo[]; alt: string }) {
  const [i, setI] = useState(0);
  if (!photos.length) return <PhotoImg alt={alt} className="aspect-[16/10] w-full" />;
  const go = (d: number) => setI((x) => (x + d + photos.length) % photos.length);
  return (
    <div className="relative">
      <div
        className="scroll-snap-x no-scrollbar flex aspect-[16/10] w-full overflow-x-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          setI(Math.round(el.scrollLeft / el.clientWidth));
        }}
        aria-roledescription="carousel"
        aria-label={`${alt} photos`}
      >
        {photos.map((p, k) => (
          <PhotoImg key={p.url} photo={p} alt={`${alt}, photo ${k + 1} of ${photos.length}`} className="h-full w-full shrink-0" />
        ))}
      </div>
      {photos.length > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous photo"
            onClick={(e) => {
              go(-1);
              const el = e.currentTarget.parentElement!.firstElementChild as HTMLElement;
              el.scrollTo({ left: ((i - 1 + photos.length) % photos.length) * el.clientWidth, behavior: "smooth" });
            }}
            className="absolute left-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white md:flex"
          >
            <IconChevronLeft />
          </button>
          <button
            type="button"
            aria-label="Next photo"
            onClick={(e) => {
              go(1);
              const el = e.currentTarget.parentElement!.firstElementChild as HTMLElement;
              el.scrollTo({ left: ((i + 1) % photos.length) * el.clientWidth, behavior: "smooth" });
            }}
            className="absolute right-2 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white md:flex"
          >
            <IconChevronRight />
          </button>
          <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1" aria-hidden>
            {photos.map((p, k) => (
              <span key={p.url} className={cx("h-1.5 w-1.5 rounded-full", k === i ? "bg-white" : "bg-white/50")} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function BookButton({ link, primary }: { link: BookingLink; primary?: boolean }) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={cx(
        "group inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-3.5 text-sm font-medium transition-[transform,filter,background-color] active:scale-[0.97]",
        primary ? "bg-accent-gradient text-accent-ink shadow-glow hover:brightness-110" : "bg-surface shadow-sm ring-1 ring-line-strong hover:bg-surface-2",
      )}
    >
      {link.label}
      <IconExternal size={15} className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      <span className="sr-only">(opens {link.site} in a new tab)</span>
    </a>
  );
}

export function PriceDisclaimer() {
  return <p className="text-[11px] text-muted">{PRICE_MAY_DIFFER}</p>;
}
