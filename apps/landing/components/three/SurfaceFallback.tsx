export function SurfaceFallback() {
  const verticalGuides = [110, 170, 230, 290, 350, 410, 470, 530];
  const horizontalGuides = [96, 148, 200, 252, 304];
  const contourRows = [
    "70,298 142,264 216,242 288,218 364,196 444,166 522,140 584,126",
    "70,320 142,286 216,262 288,240 364,214 444,184 522,156 584,140",
    "70,344 142,308 216,286 288,262 364,238 444,208 522,182 584,166",
    "70,366 142,334 216,310 288,290 364,266 444,240 522,216 584,200",
  ];

  return (
    <div className="relative h-[30rem] overflow-hidden rounded-[2rem] border border-white/6 bg-[linear-gradient(180deg,_rgba(255,255,255,0.03),_rgba(10,11,15,0.88)),_#0f1013]">
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(circle_at_24%_18%,_rgba(215,122,82,0.22),_transparent_22%),_radial-gradient(circle_at_76%_24%,_rgba(243,240,232,0.08),_transparent_20%)]"
      />

      <div className="absolute left-5 top-5 z-10">
        <p className="font-[var(--font-mono)] text-[11px] uppercase tracking-[0.34em] text-zinc-500">
          Volatility surface preview
        </p>
        <p className="mt-2 text-sm text-zinc-300">
          Static view for tests, no-WebGL clients, and reduced motion.
        </p>
      </div>

      <svg
        aria-label="Volatility surface preview"
        className="absolute inset-0 h-full w-full"
        role="img"
        viewBox="0 0 640 420"
      >
        <defs>
          <linearGradient id="surface-fill" x1="0%" x2="0%" y1="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(215,122,82,0.34)" />
            <stop offset="100%" stopColor="rgba(215,122,82,0.02)" />
          </linearGradient>
        </defs>

        <rect
          fill="rgba(255,255,255,0.02)"
          height="300"
          rx="26"
          width="520"
          x="60"
          y="84"
        />

        {horizontalGuides.map((y) => (
          <line
            key={`h-${y}`}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="1"
            x1="60"
            x2="580"
            y1={y}
            y2={y}
          />
        ))}

        {verticalGuides.map((x) => (
          <line
            key={`v-${x}`}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="1"
            x1={x}
            x2={x}
            y1="84"
            y2="384"
          />
        ))}

        <path
          d="M70 366 L142 334 L216 310 L288 290 L364 266 L444 240 L522 216 L584 200 L584 384 L70 384 Z"
          fill="url(#surface-fill)"
        />

        {contourRows.map((row) => (
          <polyline
            key={row}
            fill="none"
            points={row}
            stroke="#d77a52"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.2"
          />
        ))}

        <polyline
          fill="none"
          points="70,278 142,238 216,208 288,176 364,142 444,116 522,96 584,92"
          stroke="rgba(243,240,232,0.24)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.6"
        />
      </svg>

      <div className="pointer-events-none absolute bottom-5 left-5 z-10 font-[var(--font-mono)] text-[11px] uppercase tracking-[0.34em] text-zinc-500">
        Tenor progression
      </div>
      <div className="pointer-events-none absolute bottom-5 right-5 z-10 font-[var(--font-mono)] text-[11px] uppercase tracking-[0.34em] text-zinc-500">
        Delta buckets
      </div>
    </div>
  );
}
