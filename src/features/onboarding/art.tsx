/**
 * Inline SVG illustrations for the walkthrough. Themed with the app's CSS variables
 * so they track light/dark and accent changes. viewBox is a uniform 240×140.
 */

const VB = "0 0 240 140";
const ACCENT = "var(--accent)";
const DIM = "var(--text-dim)";
const BORDER = "var(--border)";
const BG = "var(--bg-elev)";

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox={VB} width="240" height="140" role="img" className="zen-anim-fade">
      {children}
    </svg>
  );
}

/** Concentric zen rings around a calm dot — the brand mood. */
export function ArtWelcome() {
  return (
    <Frame>
      {[44, 32, 20].map((r, i) => (
        <circle
          key={r}
          cx="120"
          cy="70"
          r={r}
          fill="none"
          stroke={i === 2 ? ACCENT : BORDER}
          strokeWidth={i === 2 ? 2 : 1.5}
          opacity={0.5 + i * 0.2}
        />
      ))}
      <circle cx="120" cy="70" r="6" fill={ACCENT} />
      <circle cx="120" cy="70" r="56" fill="none" stroke={ACCENT} strokeWidth="1" strokeDasharray="3 8" opacity="0.4" />
    </Frame>
  );
}

/** A chat bubble with a spark — the AI assistant. */
export function ArtAI() {
  return (
    <Frame>
      <rect x="44" y="34" width="120" height="62" rx="14" fill={BG} stroke={BORDER} strokeWidth="1.5" />
      <path d="M70 96 l0 16 l16 -16 Z" fill={BG} stroke={BORDER} strokeWidth="1.5" />
      <rect x="60" y="52" width="76" height="6" rx="3" fill={DIM} opacity="0.6" />
      <rect x="60" y="66" width="54" height="6" rx="3" fill={DIM} opacity="0.4" />
      {/* spark */}
      <g stroke={ACCENT} strokeWidth="3" strokeLinecap="round">
        <path d="M176 44 v20" />
        <path d="M166 54 h20" />
        <path d="M178 74 v10" />
        <path d="M173 79 h10" />
      </g>
    </Frame>
  );
}

/** A calendar and an envelope — Google Calendar + Mail. */
export function ArtGoogle() {
  return (
    <Frame>
      {/* calendar */}
      <rect x="40" y="40" width="74" height="64" rx="10" fill={BG} stroke={BORDER} strokeWidth="1.5" />
      <rect x="40" y="40" width="74" height="16" rx="10" fill={ACCENT} opacity="0.85" />
      <line x1="56" y1="36" x2="56" y2="48" stroke={DIM} strokeWidth="3" strokeLinecap="round" />
      <line x1="98" y1="36" x2="98" y2="48" stroke={DIM} strokeWidth="3" strokeLinecap="round" />
      {[66, 84].map((y) =>
        [52, 70, 88].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="3.5" fill={DIM} opacity="0.5" />)
      )}
      {/* envelope */}
      <rect x="128" y="52" width="74" height="52" rx="10" fill={BG} stroke={BORDER} strokeWidth="1.5" />
      <path d="M128 60 l37 26 l37 -26" fill="none" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </Frame>
  );
}

/** A focus-timer ring beside a stack of source cards — Deep Work. */
export function ArtDeepWork() {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <Frame>
      {/* timer ring */}
      <circle cx="74" cy="70" r={r} fill="none" stroke={BORDER} strokeWidth="6" />
      <circle
        cx="74"
        cy="70"
        r={r}
        fill="none"
        stroke={ACCENT}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * 0.32}
        transform="rotate(-90 74 70)"
      />
      <text x="74" y="75" textAnchor="middle" fill="var(--text)" fontSize="15" fontWeight="600">50</text>
      {/* stacked source cards */}
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={132 + i * 6}
          y={46 + i * 16}
          width="68"
          height="14"
          rx="4"
          fill={BG}
          stroke={i === 0 ? ACCENT : BORDER}
          strokeWidth="1.5"
        />
      ))}
      <rect x="138" y="50" width="30" height="6" rx="3" fill={DIM} opacity="0.6" />
    </Frame>
  );
}

/** A tidy grid of tiles — the "everything you can do" overview. */
export function ArtGallery() {
  const tiles = [
    [70, 46], [120, 46], [170, 46],
    [70, 78], [120, 78], [170, 78],
  ];
  return (
    <Frame>
      {tiles.map(([x, y], i) => (
        <rect
          key={i}
          x={x - 18}
          y={y - 12}
          width="36"
          height="24"
          rx="6"
          fill={i === 0 ? "var(--accent-dim)" : BG}
          stroke={i === 0 ? ACCENT : BORDER}
          strokeWidth="1.5"
        />
      ))}
      <circle cx="70" cy="46" r="3.5" fill={ACCENT} />
    </Frame>
  );
}

/** Stacked memory cards feeding into a node — what Zen remembers about you. */
export function ArtMemory() {
  return (
    <Frame>
      {/* memory cards */}
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x="36" y={44 + i * 20} width="92" height="16" rx="5" fill={BG} stroke={i === 0 ? ACCENT : BORDER} strokeWidth="1.5" />
          <circle cx="46" cy={52 + i * 20} r="3" fill={i === 0 ? ACCENT : DIM} opacity={0.7} />
          <rect x="54" y={49 + i * 20} width={i === 1 ? 50 : 64} height="6" rx="3" fill={DIM} opacity="0.5" />
        </g>
      ))}
      {/* connector to the "brain" node */}
      <path d="M128 70 C 150 70, 158 70, 172 70" fill="none" stroke={ACCENT} strokeWidth="1.5" strokeDasharray="3 5" opacity="0.6" />
      <circle cx="186" cy="70" r="18" fill="none" stroke={ACCENT} strokeWidth="2" />
      <circle cx="186" cy="70" r="6" fill={ACCENT} opacity="0.8" />
      <circle cx="186" cy="70" r="11" fill="none" stroke={ACCENT} strokeWidth="1" opacity="0.4" />
    </Frame>
  );
}

/** A graded checklist with a mastery bar — Study & Quiz. */
export function ArtStudyQuiz() {
  const rows = [
    { y: 42, ok: true },
    { y: 66, ok: true },
    { y: 90, ok: false },
  ];
  return (
    <Frame>
      <rect x="40" y="30" width="120" height="84" rx="12" fill={BG} stroke={BORDER} strokeWidth="1.5" />
      {rows.map((row) => (
        <g key={row.y}>
          <circle
            cx="58"
            cy={row.y}
            r="7"
            fill="none"
            stroke={row.ok ? "var(--ok)" : DIM}
            strokeWidth="2"
          />
          {row.ok ? (
            <path
              d={`M54.5 ${row.y} l2.5 2.5 l4 -5`}
              fill="none"
              stroke="var(--ok)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : (
            <text x="58" y={row.y + 4} textAnchor="middle" fill={DIM} fontSize="10" fontWeight="700">?</text>
          )}
          <rect x="74" y={row.y - 3} width={row.ok ? 64 : 48} height="6" rx="3" fill={DIM} opacity="0.5" />
        </g>
      ))}
      {/* mastery bar */}
      <rect x="176" y="42" width="24" height="72" rx="6" fill={BG} stroke={BORDER} strokeWidth="1.5" />
      <rect x="180" y="74" width="16" height="36" rx="4" fill={ACCENT} />
      <text x="188" y="36" textAnchor="middle" fill={DIM} fontSize="9">mastery</text>
    </Frame>
  );
}
