import React, { useEffect, useId, useMemo, useRef, useState } from 'react';

function toSafeReactNode(value: unknown): React.ReactNode {
  if (value === null || value === undefined || typeof value === 'boolean') {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number') {
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

export interface ThoughtStep {
  id: string;
  label: React.ReactNode;
  detail?: React.ReactNode;
  status?: 'pending' | 'active' | 'complete';
}

export interface ThoughtLineProps {
  isThinking?: boolean;
  activeLabel?: React.ReactNode;
  settledLabel?: React.ReactNode;
  settledDurationS?: number;
  steps?: ThoughtStep[];
  stepIntervalMs?: number;
  defaultExpanded?: boolean;
  onToggleExpand?: (expanded: boolean) => void;
  className?: string;
  testId?: string;
}

const DEFAULT_TELEMETRY_STEPS: ThoughtStep[] = [
  {
    id: 'step-atmos',
    label: 'Sampling chamber O2 partial pressure & effective LOI bounds',
    detail: 'Evaluating pressure-adjusted flammability threshold in base SI',
  },
  {
    id: 'step-flow',
    label: 'Computing Extinction-Proximity Index (Da*) blow-off & radiative quench regimes',
    detail: 'Checking forced HVAC boundary-layer residence time vs. gravity vector',
  },
  {
    id: 'step-psi',
    label: 'Cross-referencing NASA PSI experimental flight datasets',
    detail: 'Aligning spread rate against Saffire-II, BASS-II, and NASA-STD-6001',
  },
  {
    id: 'step-protocol',
    label: 'Synthesizing ECLSS damper & suppressant protocol',
    detail: 'Grounding recommendations in live thermocouple & marker telemetry',
  },
];

type Point2D = [number, number];

const MORPH_SAMPLES = 64;
const CENTER: Point2D = [12, 12];

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

// 1. Zero-Gravity Flame Teardrop
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

// 2. Launch Vehicle Rocket
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

// 3. Orbital Spacecraft Capsule
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

// 4. Solar-Winged Orbital Satellite
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

// 5. Hexagonal Space Telescope Mirror
const HEX_MIRROR_VERTICES: Point2D[] = Array.from({ length: 6 }, (_, idx) => {
  const angle = (idx / 6) * Math.PI * 2 - Math.PI / 2;
  return [CENTER[0] + Math.cos(angle) * 7.6, CENTER[1] + Math.sin(angle) * 7.6] as Point2D;
});

// 6. Ringed Gas Giant
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

// 7. Astrometric Pulsar Star
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

function OrbitalTelemetryGlyph({ active }: { active: boolean }) {
  const gradId = useId();
  const [phase, setPhase] = useState<number>(0);

  useEffect(() => {
    if (!active) {
      setPhase(0);
      return undefined;
    }

    let frameId = 0;
    let lastTime = performance.now();

    const animate = (now: number) => {
      const dt = Math.max(0, Math.min(0.1, (now - lastTime) / 1000));
      lastTime = now;
      const speed = 1.45;
      setPhase((prev) => {
        const total = SPACE_MORPH_KEYFRAMES.length;
        const next = prev + dt * speed;
        return ((next % total) + total) % total;
      });
      frameId = window.requestAnimationFrame(animate);
    };

    frameId = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frameId);
  }, [active]);

  const { pathData, moonPos, moonScale, tiltDeg } = useMemo(() => {
    const total = SPACE_MORPH_KEYFRAMES.length;
    const safePhase = Number.isFinite(phase) ? ((phase % total) + total) % total : 0;
    const currentIndex = Math.floor(safePhase) % total;
    const nextIndex = (currentIndex + 1) % total;
    const localProgress = safePhase - Math.floor(safePhase);

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

    let d = '';
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
    d += 'Z';

    const weightOf = (idx: number) =>
      currentIndex === idx ? 1 - morphT : nextIndex === idx ? morphT : 0;

    const orbitAngle = phase * Math.PI * 1.35 - Math.PI / 4;
    const orbitalWeight = weightOf(5) + weightOf(3) * 0.7 + weightOf(2) * 0.6;
    const mScale = 0.28 + Math.min(1, orbitalWeight) * 0.85;
    const orbitR = 9.4;

    const tilt =
      weightOf(1) * 16 +
      weightOf(2) * -14 +
      weightOf(3) * -22 +
      weightOf(5) * -18 +
      weightOf(6) * 45 +
      weightOf(7) * 24;

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
      <svg viewBox="0 0 24 24" fill="none" className="h-[18px] w-[18px] overflow-visible">
        <defs>
          <linearGradient id={gradId} x1="4" y1="3" x2="20" y2="21" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={active ? '#FFFFFF' : '#E4E4E7'} />
            <stop offset="55%" stopColor={active ? '#D4D4D8' : '#A1A1AA'} />
            <stop offset="100%" stopColor={active ? '#71717A' : '#52525B'} />
          </linearGradient>
        </defs>

        <g transform={`rotate(${tiltDeg.toFixed(2)} 12 12)`}>
          <path d={pathData} fill={`url(#${gradId})`} />
        </g>

        {active && (
          <circle
            cx={moonPos[0].toFixed(2)}
            cy={moonPos[1].toFixed(2)}
            r={(1.8 * moonScale).toFixed(2)}
            fill="#F4F4F5"
          />
        )}
      </svg>
    </span>
  );
}

export function ThoughtLine({
  isThinking = false,
  activeLabel = 'Analyzing chamber telemetry',
  settledLabel,
  settledDurationS,
  steps = DEFAULT_TELEMETRY_STEPS,
  stepIntervalMs = 850,
  defaultExpanded = false,
  onToggleExpand,
  className = '',
  testId = 'safety-thought-line',
}: ThoughtLineProps) {
  const [elapsedMs, setElapsedMs] = useState<number>(0);
  const [autoStepIndex, setAutoStepIndex] = useState<number>(0);
  const [isExpanded, setIsExpanded] = useState<boolean>(isThinking || defaultExpanded);
  const startTimeRef = useRef<number | null>(null);

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
    }
    setIsExpanded(defaultExpanded);
    return undefined;
  }, [isThinking, defaultExpanded]);

  useEffect(() => {
    if (!isThinking || steps.length === 0) return;

    const hasExplicitStatus = steps.some((step) => step.status !== undefined);
    if (hasExplicitStatus) return;

    const stepTimerId = window.setInterval(() => {
      setAutoStepIndex((prev) => (prev < steps.length - 1 ? prev + 1 : prev));
    }, stepIntervalMs);

    return () => window.clearInterval(stepTimerId);
  }, [isThinking, steps, stepIntervalMs]);

  const resolvedSteps = useMemo(() => {
    return steps.map((step, index) => {
      if (step.status) return step;
      if (!isThinking) return { ...step, status: 'complete' as const };
      if (index < autoStepIndex) return { ...step, status: 'complete' as const };
      if (index === autoStepIndex) return { ...step, status: 'active' as const };
      return { ...step, status: 'pending' as const };
    });
  }, [steps, isThinking, autoStepIndex]);

  const formattedSeconds = useMemo(() => {
    if (!isThinking && typeof settledDurationS === 'number' && Number.isFinite(settledDurationS)) {
      return Math.max(0.1, settledDurationS).toFixed(1);
    }
    const clampedSeconds = Math.max(0.1, elapsedMs / 1000);
    return clampedSeconds.toFixed(1);
  }, [elapsedMs, isThinking, settledDurationS]);

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
      data-testid={testId}
      data-thinking={isThinking ? 'true' : 'false'}
      className={`select-none text-xs text-[#A1A1AA] ${className}`}
      role="region"
      aria-label="AI Safety Officer reasoning trace"
    >
      <button
        type="button"
        data-testid={`${testId}-toggle`}
        onClick={handleToggle}
        disabled={isThinking}
        aria-expanded={isExpanded}
        className={`group inline-flex items-center gap-2 rounded-md py-1 text-left transition-colors ${
          isThinking ? 'cursor-default' : 'cursor-pointer hover:text-[#F4F4F5]'
        }`}
      >
        <OrbitalTelemetryGlyph active={isThinking} />

        <span
          className={`font-medium tracking-tight transition-all duration-300 ${
            isThinking ? 'thoughtline-shimmer-text' : 'text-[#A1A1AA] group-hover:text-[#E4E4E7]'
          }`}
        >
          {headerText}
        </span>

        {isThinking && (
          <span className="font-mono text-[11px] tabular-nums text-[#71717A]">
            {formattedSeconds}s
          </span>
        )}

        {!isThinking && resolvedSteps.length > 0 && (
          <svg
            viewBox="0 0 16 16"
            fill="none"
            className={`h-3.5 w-3.5 text-[#52525B] transition-transform duration-200 group-hover:text-[#A1A1AA] ${
              isExpanded ? 'rotate-180' : 'rotate-0'
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

      {resolvedSteps.length > 0 && (
        <div
          className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
            isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          }`}
        >
          <div className="overflow-hidden">
            <ol className="ml-[7px] mt-1.5 space-y-2 border-l border-[#27272A] pl-4 pb-1">
              {resolvedSteps.map((step) => {
                if (step.status === 'pending' && isThinking) return null;

                const isStepActive = step.status === 'active';
                return (
                  <li
                    key={step.id}
                    className="relative flex flex-col gap-0.5 transition-opacity duration-200"
                  >
                    <span
                      className={`absolute -left-[20.5px] top-[5px] h-1.5 w-1.5 rounded-full transition-colors ${
                        isStepActive ? 'bg-[#F4F4F5] ring-2 ring-[#27272A]' : 'bg-[#52525B]'
                      }`}
                      aria-hidden="true"
                    />

                    <span
                      className={`text-xs leading-snug ${
                        isStepActive ? 'font-medium text-[#E4E4E7]' : 'text-[#A1A1AA]'
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
