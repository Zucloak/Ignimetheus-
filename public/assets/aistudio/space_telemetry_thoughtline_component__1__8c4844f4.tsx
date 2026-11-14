import * as ReactModule from "react";

// Align with UMD window.React when running inside a React 18 preview runtime
// to prevent React 19 vs. React 18 element $$typeof symbol mismatches, while
// falling back to the standard ESM React module in Vite / AI Studio builds.
const React =
  (typeof window !== "undefined" &&
    (window as unknown as { React?: typeof ReactModule }).React) ||
  ReactModule;

const { useEffect, useMemo, useRef, useState } = React;

/**
 * Safely renders strings, numbers, or valid React elements while preventing
 * raw non-element objects from throwing a React child invariant error.
 */
function toSafeReactNode(value: unknown): ReactModule.ReactNode {
  if (value === null || value === undefined || typeof value === "boolean") {
    return null;
  }
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }
  if (React.isValidElement(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, idx) => (
      <React.Fragment key={idx}>{toSafeReactNode(item)}</React.Fragment>
    ));
  }
  return null;
}

/**
 * Represents a single reasoning step inside the AI Safety Officer's
 * telemetry analysis trace.
 */
export interface ThoughtStep {
  id: string;
  label: ReactModule.ReactNode;
  detail?: ReactModule.ReactNode;
  status?: "pending" | "active" | "complete";
}

export interface ThoughtLineProps {
  /** Whether the local WebLLM or Verified Telemetry Engine is actively reasoning */
  isThinking?: boolean;
  /** Optional custom header label while active (defaults to "Analyzing chamber telemetry") */
  activeLabel?: ReactModule.ReactNode;
  /** Optional custom header label once settled (defaults to "Thought for {duration}s") */
  settledLabel?: ReactModule.ReactNode;
  /** Ordered reasoning trace steps displayed beneath the header while active or expanded */
  steps?: ThoughtStep[];
  /** Interval in ms for auto-advancing step states when explicit statuses are not provided */
  stepIntervalMs?: number;
  /** Whether the trace starts expanded once settled (defaults to false, folding automatically) */
  defaultExpanded?: boolean;
  /** Optional callback triggered when the user toggles the reasoning trace disclosure */
  onToggleExpand?: (expanded: boolean) => void;
  /** Optional container class overrides */
  className?: string;
}

/**
 * Default microgravity combustion reasoning steps used when no custom steps are supplied.
 */
const DEFAULT_TELEMETRY_STEPS: ThoughtStep[] = [
  {
    id: "step-atmos",
    label: "Sampling chamber O2 partial pressure & effective LOI bounds",
    detail: "Evaluating pressure-adjusted flammability threshold in base SI",
  },
  {
    id: "step-flow",
    label: "Computing Extinction-Proximity Index (Da*) blow-off & radiative quench regimes",
    detail: "Checking forced HVAC boundary-layer residence time vs. gravity vector",
  },
  {
    id: "step-psi",
    label: "Cross-referencing NASA PSI experimental flight datasets",
    detail: "Aligning spread rate against Saffire-II, BASS-II, and NASA-STD-6001",
  },
  {
    id: "step-protocol",
    label: "Synthesizing ECLSS damper & suppressant protocol",
    detail: "Grounding recommendations in live thermocouple & marker telemetry",
  },
];

type Point2D = [number, number];

const MORPH_SAMPLES = 64;
const CENTER: Point2D = [12, 12];

/**
 * Computes exact radial distances from (12, 12) to any closed star-shaped polygon
 * across uniform angles so distinct solid space icons can morph vertex-for-vertex.
 */
function sampleClosedShapeRadii(vertices: Point2D[], samples = MORPH_SAMPLES): number[] {
  const radii: number[] = [];
  const count = vertices.length;

  for (let i = 0; i < samples; i++) {
    const theta = (i / samples) * Math.PI * 2 - Math.PI / 2;
    const dx = Math.cos(theta);
    const dy = Math.sin(theta);
    let minT = 7.5;

    for (let j = 0; j < count; j++) {
      const [ax, ay] = vertices[j];
      const [bx, by] = vertices[(j + 1) % count];
      const ex = bx - ax;
      const ey = by - ay;
      const denom = dx * ey - dy * ex;

      if (Math.abs(denom) < 1e-6) continue;

      const ox = ax - CENTER[0];
      const oy = ay - CENTER[1];
      const t = (ox * ey - oy * ex) / denom;
      const u = (ox * dy - oy * dx) / denom;

      if (t > 0 && u >= -1e-4 && u <= 1 + 1e-4 && t < minT) {
        minT = t;
      }
    }

    radii.push(minT);
  }

  return radii;
}

// 1. Zero-Gravity Flame Teardrop (solid laminar combustion plume)
const FLAME_DROP_VERTICES: Point2D[] = [
  [12, 2.4],
  [14.4, 6.2],
  [17.4, 10.6],
  [18.2, 14.4],
  [16.6, 17.8],
  [12, 19.4],
  [7.4, 17.8],
  [5.8, 14.4],
  [6.6, 10.6],
  [9.6, 6.2],
];

// 2. Launch Vehicle Rocket (delta-finned ascent rocket & nozzle)
const ROCKET_VERTICES: Point2D[] = [
  [12, 2.0],
  [14.2, 6.8],
  [14.4, 13.5],
  [18.2, 17.8],
  [14.2, 17.2],
  [13.6, 19.8],
  [10.4, 19.8],
  [9.8, 17.2],
  [5.8, 17.8],
  [9.6, 13.5],
  [9.8, 6.8],
];

// 3. Orbital Spacecraft Capsule (solid conical reentry/crew module)
const ORBITAL_CAPSULE_VERTICES: Point2D[] = [
  [9.8, 3.6],
  [14.2, 3.6],
  [16.2, 8.6],
  [19.2, 15.2],
  [16.4, 18.2],
  [12, 19.2],
  [7.6, 18.2],
  [4.8, 15.2],
  [7.8, 8.6],
];

// 4. Solar-Winged Orbital Satellite (spacecraft bus + deployed solar arrays)
const SATELLITE_VERTICES: Point2D[] = [
  [12, 6.8],
  [14.8, 8.2],
  [15.4, 9.6],
  [21.6, 9.6],
  [21.6, 14.4],
  [15.4, 14.4],
  [14.8, 15.8],
  [12, 17.2],
  [9.2, 15.8],
  [8.6, 14.4],
  [2.4, 14.4],
  [2.4, 9.6],
  [8.6, 9.6],
  [9.2, 8.2],
];

// 5. Hexagonal Space Telescope Mirror (JWST-inspired primary mirror segment)
const HEX_MIRROR_VERTICES: Point2D[] = Array.from({ length: 6 }, (_, idx) => {
  const angle = (idx / 6) * Math.PI * 2 - Math.PI / 2;
  return [CENTER[0] + Math.cos(angle) * 7.6, CENTER[1] + Math.sin(angle) * 7.6] as Point2D;
});

// 6. Ringed Gas Giant (Saturn-inspired planetoid with equatorial ring blades)
const RINGED_PLANET_VERTICES: Point2D[] = [
  [12, 6.2],
  [16.2, 8.2],
  [17.4, 10.4],
  [22.2, 11.4],
  [17.2, 13.2],
  [16.0, 15.8],
  [12, 17.8],
  [8.0, 15.8],
  [6.8, 13.2],
  [1.8, 12.6],
  [6.6, 10.4],
  [7.8, 8.2],
];

// 7. Astrometric Pulsar Star (solid 4-point celestial beacon)
const PULSAR_STAR_VERTICES: Point2D[] = [
  [12, 2.2],
  [14.1, 9.9],
  [21.8, 12],
  [14.1, 14.1],
  [12, 21.8],
  [9.9, 14.1],
  [2.2, 12],
  [9.9, 9.9],
];

// 8. Delta-Wing Spaceplane / Orbital Shuttle
const DELTA_ORBITER_VERTICES: Point2D[] = [
  [12, 2.2],
  [13.8, 7.2],
  [15.2, 10.5],
  [20.6, 15.8],
  [14.2, 16.4],
  [13.4, 19.2],
  [10.6, 19.2],
  [9.8, 16.4],
  [3.4, 15.8],
  [8.8, 10.5],
  [10.2, 7.2],
];

const SPACE_MORPH_KEYFRAMES: number[][] = [
  sampleClosedShapeRadii(FLAME_DROP_VERTICES),
  sampleClosedShapeRadii(ROCKET_VERTICES),
  sampleClosedShapeRadii(ORBITAL_CAPSULE_VERTICES),
  sampleClosedShapeRadii(SATELLITE_VERTICES),
  sampleClosedShapeRadii(HEX_MIRROR_VERTICES),
  sampleClosedShapeRadii(RINGED_PLANET_VERTICES),
  sampleClosedShapeRadii(PULSAR_STAR_VERTICES),
  sampleClosedShapeRadii(DELTA_ORBITER_VERTICES),
];

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Solid, continuously morphing aerospace emblem.
 * Smoothly transforms vertex-by-vertex through 8 solid space-themed silhouettes
 * (0g Flame Plume -> Launch Rocket -> Crew Capsule -> Solar Satellite ->
 * Hex Space Mirror -> Ringed Planet -> Pulsar -> Delta Spaceplane)
 * in a continuous loop rather than rendering a static hollow icon.
 */
function OrbitalTelemetryGlyph({ active }: { active: boolean }) {
  const [phase, setPhase] = useState<number>(0);

  useEffect(() => {
    let frameId = 0;
    let lastTime = performance.now();

    const animate = (now: number) => {
      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;
      // Cycles smoothly through all 8 space transformations continuously (faster while thinking)
      const speed = active ? 1.45 : 0.72;
      setPhase((prev) => (prev + dt * speed) % SPACE_MORPH_KEYFRAMES.length);
      frameId = window.requestAnimationFrame(animate);
    };

    frameId = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frameId);
  }, [active]);

  const { pathData, moonPos, moonScale, tiltDeg } = useMemo(() => {
    const total = SPACE_MORPH_KEYFRAMES.length;
    const currentIndex = Math.floor(phase) % total;
    const nextIndex = (currentIndex + 1) % total;
    const localProgress = phase - Math.floor(phase);

    // Hold briefly at each recognizable space silhouette before smoothly morphing
    const holdRatio = 0.2;
    const morphT =
      localProgress < holdRatio
        ? 0
        : easeInOutCubic((localProgress - holdRatio) / (1 - holdRatio));

    const fromRadii = SPACE_MORPH_KEYFRAMES[currentIndex];
    const toRadii = SPACE_MORPH_KEYFRAMES[nextIndex];

    const points: Point2D[] = [];
    for (let i = 0; i < MORPH_SAMPLES; i++) {
      const theta = (i / MORPH_SAMPLES) * Math.PI * 2 - Math.PI / 2;
      const r = fromRadii[i] + (toRadii[i] - fromRadii[i]) * morphT;
      points.push([
        CENTER[0] + Math.cos(theta) * r,
        CENTER[1] + Math.sin(theta) * r,
      ]);
    }

    // Build smooth closed quadratic midpoint spline through interpolated points
    let d = "";
    for (let i = 0; i < MORPH_SAMPLES; i++) {
      const p0 = points[i];
      const p1 = points[(i + 1) % MORPH_SAMPLES];
      const midX = (p0[0] + p1[0]) / 2;
      const midY = (p0[1] + p1[1]) / 2;
      if (i === 0) {
        const prev = points[MORPH_SAMPLES - 1];
        d += `M ${((prev[0] + p0[0]) / 2).toFixed(2)} ${((prev[1] + p0[1]) / 2).toFixed(2)} `;
      }
      d += `Q ${p0[0].toFixed(2)} ${p0[1].toFixed(2)} ${midX.toFixed(2)} ${midY.toFixed(2)} `;
    }
    d += "Z";

    // Helper for smooth per-shape attitude/satellite weighting
    const weightOf = (idx: number) =>
      currentIndex === idx ? 1 - morphT : nextIndex === idx ? morphT : 0;

    // Solid orbiting moon/telemetry beacon emphasizes during Ringed Planet, Satellite & Capsule states
    const orbitAngle = phase * Math.PI * 1.35 - Math.PI / 4;
    const orbitalWeight = weightOf(5) + weightOf(3) * 0.7 + weightOf(2) * 0.6;
    const mScale = 0.28 + Math.min(1, orbitalWeight) * 0.85;
    const orbitR = 9.4;

    // Dynamic aerospace pitch/roll attitude during flight & celestial phases
    const tilt =
      weightOf(1) * 16 + // Launch rocket ascent pitch
      weightOf(2) * -14 + // Capsule reentry attitude
      weightOf(3) * -22 + // Solar satellite orbital roll
      weightOf(5) * -18 + // Ringed gas giant axial tilt
      weightOf(6) * 45 + // Pulsar rotation
      weightOf(7) * 24; // Delta orbiter bank angle

    return {
      pathData: d,
      moonPos: [
        CENTER[0] + Math.cos(orbitAngle) * orbitR,
        CENTER[1] + Math.sin(orbitAngle) * orbitR,
      ] as Point2D,
      moonScale: mScale,
      tiltDeg: tilt,
    };
  }, [phase]);

  return (
    <span
      className="relative inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center"
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className="h-[18px] w-[18px] overflow-visible"
      >
        <defs>
          <linearGradient
            id="space-solid-morph-grad"
            x1="4"
            y1="3"
            x2="20"
            y2="21"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor={active ? "#FFFFFF" : "#E4E4E7"} />
            <stop offset="55%" stopColor={active ? "#D4D4D8" : "#A1A1AA"} />
            <stop offset="100%" stopColor={active ? "#71717A" : "#52525B"} />
          </linearGradient>
        </defs>

        {/* Solid continuously morphing aerospace silhouette */}
        <g transform={`rotate(${tiltDeg.toFixed(2)} 12 12)`}>
          <path d={pathData} fill="url(#space-solid-morph-grad)" />
        </g>

        {/* Solid orbiting satellite / moon mass */}
        <circle
          cx={moonPos[0].toFixed(2)}
          cy={moonPos[1].toFixed(2)}
          r={(1.8 * moonScale).toFixed(2)}
          fill={active ? "#F4F4F5" : "#A1A1AA"}
        />
      </svg>
    </span>
  );
}

/**
 * Antigravity-styled ThoughtLine component for the Flame in Freefall AI Safety Officer.
 * Features a breathing orbital telemetry glyph, live tabular-nums elapsed timer,
 * shimmer header label, progressive step trace, and smooth folding disclosure on completion.
 */
export function ThoughtLine({
  isThinking = false,
  activeLabel = "Analyzing chamber telemetry",
  settledLabel,
  steps = DEFAULT_TELEMETRY_STEPS,
  stepIntervalMs = 850,
  defaultExpanded = false,
  onToggleExpand,
  className = "",
}: ThoughtLineProps) {
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [autoStepIndex, setAutoStepIndex] = useState<number>(0);
  const [isExpanded, setIsExpanded] = useState<boolean>(isThinking || defaultExpanded);
  const startTimeRef = useRef<number | null>(null);

  // Manage live chronometer and automatic expansion/folding on state transitions
  useEffect(() => {
    if (isThinking) {
      startTimeRef.current = performance.now();
      setElapsedMs(0);
      setAutoStepIndex(0);
      setIsExpanded(true);

      const timerId = window.setInterval(() => {
        if (startTimeRef.current !== null) {
          setElapsedMs(performance.now() - startTimeRef.current);
        }
      }, 100);

      return () => window.clearInterval(timerId);
    } else {
      // Fold the reasoning trace smoothly once analysis settles
      setIsExpanded(defaultExpanded);
    }
  }, [isThinking, defaultExpanded]);

  // Progress through reasoning steps automatically if caller did not supply explicit statuses
  useEffect(() => {
    if (!isThinking || steps.length === 0) return;

    const hasExplicitStatus = steps.some((step) => step.status !== undefined);
    if (hasExplicitStatus) return;

    const stepTimerId = window.setInterval(() => {
      setAutoStepIndex((prev) => (prev < steps.length - 1 ? prev + 1 : prev));
    }, stepIntervalMs);

    return () => window.clearInterval(stepTimerId);
  }, [isThinking, steps, stepIntervalMs]);

  // Resolve effective status for each reasoning step
  const resolvedSteps = useMemo(() => {
    return steps.map((step, index) => {
      if (step.status) return step;
      if (!isThinking) return { ...step, status: "complete" as const };
      if (index < autoStepIndex) return { ...step, status: "complete" as const };
      if (index === autoStepIndex) return { ...step, status: "active" as const };
      return { ...step, status: "pending" as const };
    });
  }, [steps, isThinking, autoStepIndex]);

  // Format elapsed time cleanly with fixed 1-decimal tabular precision
  const formattedSeconds = useMemo(() => {
    const clampedSeconds = Math.max(0.1, elapsedMs / 1000);
    return clampedSeconds.toFixed(1);
  }, [elapsedMs]);

  const headerText = isThinking
    ? toSafeReactNode(activeLabel)
    : settledLabel !== undefined
      ? toSafeReactNode(settledLabel)
      : `Thought for ${formattedSeconds}s`;

  const handleToggle = () => {
    if (isThinking) return;
    const next = !isExpanded;
    setIsExpanded(next);
    onToggleExpand?.(next);
  };

  return (
    <div
      className={`select-none text-xs text-[#A1A1AA] ${className}`}
      role="region"
      aria-label="AI Safety Officer reasoning trace"
    >
      {/* Inline shimmer keyframes scoped cleanly without external CSS dependencies */}
      <style>{`
        @keyframes thoughtline-shimmer {
          0% { background-position: 200% center; }
          100% { background-position: -200% center; }
        }
        .thoughtline-shimmer-text {
          background: linear-gradient(
            90deg,
            #71717A 0%,
            #F4F4F5 45%,
            #71717A 90%
          );
          background-size: 200% auto;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: thoughtline-shimmer 2.4s linear infinite;
        }
      `}</style>

      {/* Reasoning Header Row */}
      <button
        type="button"
        onClick={handleToggle}
        disabled={isThinking}
        className={`group inline-flex items-center gap-2 rounded-md py-1 text-left transition-colors ${
          isThinking
            ? "cursor-default"
            : "cursor-pointer hover:text-[#F4F4F5]"
        }`}
      >
        <OrbitalTelemetryGlyph active={isThinking} />

        <span
          className={`font-medium tracking-tight transition-all duration-300 ${
            isThinking
              ? "thoughtline-shimmer-text"
              : "text-[#A1A1AA] group-hover:text-[#E4E4E7]"
          }`}
        >
          {headerText}
        </span>

        {/* Live monotonic timer while thinking */}
        {isThinking && (
          <span className="font-mono text-[11px] tabular-nums text-[#71717A]">
            {formattedSeconds}s
          </span>
        )}

        {/* Subtle disclosure chevron once settled */}
        {!isThinking && resolvedSteps.length > 0 && (
          <svg
            viewBox="0 0 16 16"
            fill="none"
            className={`h-3.5 w-3.5 text-[#52525B] transition-transform duration-200 group-hover:text-[#A1A1AA] ${
              isExpanded ? "rotate-180" : "rotate-0"
            }`}
            aria-hidden="true"
          >
            <path
              d="M4 6L8 10L12 6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>

      {/* Collapsible Reasoning Trace Tree */}
      {resolvedSteps.length > 0 && (
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
            isExpanded
              ? "grid-rows-[1fr] opacity-100"
              : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="overflow-hidden">
            <ol className="ml-[7px] mt-1.5 space-y-2 border-l border-[#27272A] pl-4 pb-1">
              {resolvedSteps.map((step) => {
                if (step.status === "pending" && isThinking) return null;

                const isStepActive = step.status === "active";
                return (
                  <li
                    key={step.id}
                    className="relative flex flex-col gap-0.5 transition-opacity duration-200"
                  >
                    {/* Node alignment dot along the vertical hairline */}
                    <span
                      className={`absolute -left-[20.5px] top-[5px] h-1.5 w-1.5 rounded-full transition-colors ${
                        isStepActive
                          ? "bg-[#F4F4F5] ring-2 ring-[#27272A]"
                          : "bg-[#52525B]"
                      }`}
                      aria-hidden="true"
                    />

                    <span
                      className={`text-xs leading-snug ${
                        isStepActive
                          ? "font-medium text-[#E4E4E7]"
                          : "text-[#A1A1AA]"
                      }`}
                    >
                      {toSafeReactNode(step.label)}
                    </span>

                    {step.detail !== undefined && step.detail !== null && (
                      <span className="font-mono text-[11px] leading-tight text-[#71717A]">
                        {toSafeReactNode(step.detail)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}

export default ThoughtLine;