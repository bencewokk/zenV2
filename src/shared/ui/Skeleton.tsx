/** Shimmering placeholder block(s) for loading states. */
export function Skeleton({
  width = "100%",
  height = 12,
  className = "",
}: {
  width?: number | string;
  height?: number | string;
  className?: string;
}) {
  return (
    <div
      className={`zen-skeleton ${className}`}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

/** A stack of skeleton rows, each a title + subtitle pair. */
export function SkeletonRows({ count = 6, className = "" }: { count?: number; className?: string }) {
  return (
    <div className={`space-y-3 ${className}`} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton width="70%" height={11} />
          <Skeleton width="45%" height={9} />
        </div>
      ))}
    </div>
  );
}
