import type { ScoringTier } from "@/lib/baseball/scoring";
import { tierConfig } from "@/lib/baseball/scoring";

/** Per-tier colors. Names and points come from scoring.ts; only styling lives here. */
export const TIER_STYLES: Record<ScoringTier, { badge: string; text: string }> = {
  strikeout: { badge: "bg-cream-200 text-ink-muted", text: "text-ink-muted" },
  bunt: { badge: "bg-cream-300 text-ink", text: "text-ink" },
  single: { badge: "bg-single-100 text-single-600", text: "text-single-600" },
  double: { badge: "bg-double-100 text-double-600", text: "text-double-600" },
  triple: { badge: "bg-triple-100 text-triple-600 ring-1 ring-triple-400", text: "text-triple-600" },
  plakata: { badge: "bg-stitch-600 text-cream-50", text: "text-stitch-600" },
};

interface TierBadgeProps {
  tier: ScoringTier;
  size?: "sm" | "lg";
  /** Play the Plákata celebration (round result only). */
  celebrate?: boolean;
  className?: string;
}

export function TierBadge({ tier, size = "sm", celebrate = false, className = "" }: TierBadgeProps) {
  const { label } = tierConfig(tier);
  const sizing =
    size === "lg"
      ? "px-4 py-1.5 font-display text-2xl font-semibold tracking-[0.08em] sm:text-3xl"
      : "px-2.5 py-0.5 text-[11px] font-semibold tracking-[0.12em]";
  const party = celebrate && tier === "plakata";
  return (
    <span className={`relative inline-flex ${className}`}>
      <span
        data-tier={tier}
        className={`inline-flex items-center rounded-full uppercase ${sizing} ${TIER_STYLES[tier].badge} ${
          party ? "animate-glow" : ""
        }`}
      >
        {label}
      </span>
      {party && (
        <span aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 animate-homer-x">
          <span className="block size-2.5 rounded-full bg-cream-50 shadow ring-1 ring-stitch-400 animate-homer-y" />
        </span>
      )}
    </span>
  );
}
