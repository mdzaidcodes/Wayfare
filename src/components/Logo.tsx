import { IconPlane } from "./icons";
import { cx } from "./ui";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2", className)}>
      <span className="bg-accent-gradient flex h-8 w-8 items-center justify-center rounded-xl text-accent-ink shadow-glow">
        <IconPlane size={16} />
      </span>
      <span className="font-display text-xl font-semibold tracking-tight">Wayfare</span>
    </span>
  );
}
