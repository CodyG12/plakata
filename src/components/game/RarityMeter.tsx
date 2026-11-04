interface RarityMeterProps {
  score: number;
  className?: string;
}

/** 0–100 bar with "common" → "rare" ends. */
export function RarityMeter({ score, className = "" }: RarityMeterProps) {
  return (
    <div className={className}>
      <div
        className="relative h-2.5 overflow-hidden rounded-full bg-navy-800"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={score}
        aria-label="Estimated rarity"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-cream-300 via-stitch-400 to-stitch-500 transition-[width] duration-700 ease-out"
          style={{ width: `${Math.max(score, 2)}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] font-medium uppercase tracking-[0.16em] text-navy-400">
        <span>Common</span>
        <span>Rare</span>
      </div>
    </div>
  );
}
