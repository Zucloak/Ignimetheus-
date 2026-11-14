import React, { useEffect, useRef, useState } from 'react';
import {
  AMBIENT_CHAMBER_TEMP_K,
  computeThermoTelemetry,
  FLAME_ARRESTOR_X_MM,
  INERT_NOZZLE_X_MM,
  MATERIALS,
  NASA_STD_BURN_LIMIT_MM,
  resolveDuctHardware,
  resolveSpecimenGeometry,
  SPECIMEN_LENGTH_MM,
  WAKE_BAFFLE_X_MM,
  type DuctHardwareConfig,
  type SimulationParams,
  type ThermoTelemetry,
} from '../engine/thermoCore';
import {
  DUCT_HALF_HEIGHT_MM,
  DUCT_LENGTH_MM,
  measureCaliperMm,
  sampleDuctFieldAtMm,
  THERMOCOUPLE_ARRAY_SPECS,
  type CadMarker,
  type CadToolMode,
} from '../engine/ductProbes';
import { formatGravity, formatTemperature, formatVelocity, type UnitSystem } from '../engine/units';

interface CombustionDuctCanvasProps {
  params: SimulationParams;
  telemetry: ThermoTelemetry;
  unitSystem: UnitSystem;
  isPlaying: boolean;
  showStreamlines: boolean;
  showVectors: boolean;
  showContours: boolean;
  showThermocouples: boolean;
  showCrosshair?: boolean;
  show1gOverlay?: boolean;
  isFullscreen: boolean;
  cadTool: CadToolMode;
  markers: CadMarker[];
  pendingCaliperStart: { xMm: number; yMm: number } | null;
  onDropMarkerPoint: (xMm: number, yMm: number) => void;
}

interface ProbeHoverState {
  active: boolean;
  xMm: number;
  yMm: number;
  localTempK: number;
  localVelMs: number;
}

interface TracerParticle {
  x: number; // 0..1 normalized along 450 mm quartz chamber
  y: number; // -0.92..0.92 normalized from duct centerline
  speedJitter: number;
  phase: number;
  trail: Array<{ x: number; y: number }>;
}

interface SootWisp {
  xOffset: number;
  yOffset: number;
  radius: number;
  alpha: number;
  driftPhase: number;
}

interface EmberParticle {
  x: number; // 0..1 normalized along 450 mm chamber
  y: number; // -0.92..0.92 normalized from centerline
  age: number;
  maxAge: number;
  size: number;
  phase: number;
}

interface FlamePt {
  x: number;
  y: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function smoothstep01(x: number): number {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Pure 2-component streamline & velocity vector deflection field (xMm in 0..450 mm, yNorm in -1..1):
 *  (a) Solid Rig Obstruction: tightly hugs physical sample holder & clamps (130..210 mm), returning immediately to 0 downstream.
 *  (b) Thermal Gas Expansion: active ONLY when flame/ignition heats gas (rho ~ 1/T) across 210..360 mm;
 *      strictly 0 when cold (STANDBY / SELF_EXTINGUISHED), leaving clean horizontal parabolic Poiseuille flow.
 */
function evaluateDuctFlowField(
  xMm: number,
  yNorm: number,
  thermalScale: number,
  gMs2: number,
  simTime: number,
  phase: number,
  hardware: DuctHardwareConfig,
  n2DischargeActive: boolean,
): {
  parabolic: number;
  uMultiplier: number;
  yStreamNorm: number;
  slopeDyDx: number;
} {
  const parabolic = Math.max(0.24, 1 - yNorm * yNorm * 0.72);
  const ySign = yNorm >= 0 ? 1 : -1;

  // Component (0): Upstream Wake Baffle deflection & Karman recirculation wake (82..135 mm)
  let yBaffleShift = 0;
  let slopeBaffle = 0;
  let baffleSpeedMult = 1.0;
  if (hardware.wakeBaffle && xMm >= 80 && xMm <= 145) {
    const uBaf = (xMm - 80) / (145 - 80);
    const yAtten = Math.exp(-Math.pow(yNorm / 0.36, 2));
    const wakeRipple = xMm > WAKE_BAFFLE_X_MM ? Math.sin((xMm - WAKE_BAFFLE_X_MM) * 0.16 - simTime * 7.5 + phase) * 0.045 : 0;
    yBaffleShift = Math.sin(Math.PI * uBaf) * 0.22 * yAtten * ySign + wakeRipple * yAtten;
    slopeBaffle = Math.cos(Math.PI * uBaf) * 0.48 * yAtten * ySign;
    if (xMm > WAKE_BAFFLE_X_MM && Math.abs(yNorm) < 0.25) {
      baffleSpeedMult = 0.62;
    }
  }

  // Component (a): Tight localized solid rig obstruction around 130..210 mm
  const rigStartMm = 124;
  const rigEndMm = 216;
  let yRigShift = 0;
  let slopeRig = 0;
  if (xMm >= rigStartMm && xMm <= rigEndMm && Math.abs(yNorm) < 0.34) {
    const uRig = (xMm - rigStartMm) / (rigEndMm - rigStartMm);
    const yAtten = Math.exp(-Math.pow(yNorm / 0.14, 2));
    yRigShift = Math.sin(Math.PI * uRig) * 0.13 * yAtten * ySign;
    slopeRig = Math.cos(Math.PI * uRig) * 0.34 * yAtten * ySign;
  }

  // Component (b): Thermal gas expansion deflection (210..360 mm) proportional to thermalScale (0 when cold)
  let yThermShift = 0;
  let slopeTherm = 0;
  let uMultiplier = baffleSpeedMult;

  if (thermalScale > 0.002 && xMm >= 200 && xMm <= 365) {
    const uTherm = clamp((xMm - 205) / (360 - 205), 0, 1);
    const envelope = Math.sin(Math.PI * Math.pow(uTherm, 0.75)) * (1 - 0.32 * uTherm);
    const dEnvDu =
      Math.PI * 0.75 * Math.pow(Math.max(0.02, uTherm), -0.25) * Math.cos(Math.PI * Math.pow(uTherm, 0.75)) * (1 - 0.32 * uTherm) -
      0.32 * Math.sin(Math.PI * Math.pow(uTherm, 0.75));

    const radialCore = Math.exp(-Math.pow(yNorm / 0.5, 2));
    const bowAmp = 0.22 * thermalScale * radialCore;
    yThermShift = envelope * bowAmp * ySign;
    slopeTherm = clamp(dEnvDu * 0.24, -0.55, 0.55) * thermalScale * radialCore * ySign;

    // Continuity thermal expansion velocity increase (u ~ T / T0)
    uMultiplier += 0.32 * thermalScale * envelope * Math.exp(-Math.pow(yNorm / 0.46, 2));

    // Upward buoyant plume curl when gravity > 0.3 m/s^2
    if (gMs2 > 0.3) {
      const gFrac = clamp(gMs2 / 9.80665, 0, 1.1);
      const buoyLift = uTherm * 0.52 * gFrac * thermalScale;
      const vortex = Math.sin(uTherm * 9 - simTime * 6 + phase) * 0.03 * gFrac * thermalScale;
      yThermShift -= buoyLift - vortex;
      slopeTherm -= 0.32 * gFrac * thermalScale;
    }
  }

  // Inert gas nozzle downward jet perturbation around X = 160 mm during N2 discharge
  let yNozzleShift = 0;
  let slopeNozzle = 0;
  if (n2DischargeActive && xMm >= 140 && xMm <= 215) {
    const uNoz = (xMm - 140) / 75;
    yNozzleShift = Math.sin(Math.PI * uNoz) * 0.18;
    slopeNozzle = Math.cos(Math.PI * uNoz) * 0.35;
    uMultiplier += 0.28;
  }

  const yStreamNorm = clamp(yNorm + yBaffleShift + yRigShift + yThermShift + yNozzleShift, -0.93, 0.93);
  const slopeDyDx = slopeBaffle + slopeRig + slopeTherm + slopeNozzle;

  return { parabolic, uMultiplier, yStreamNorm, slopeDyDx };
}

/**
 * Generates high-resolution upper & lower spline envelopes for an open-tipped diffusion flame
 * modulated by multi-frequency traveling boundary-layer waves (sin(k*x - omega*t)).
 */
function buildOpenFlameEnvelope(
  len: number,
  rad: number,
  noseBack: number,
  turbulence: number,
  simTime: number,
  phaseSeed: number,
  openFlare = 0.44,
  liftPx = 0,
): { upper: FlamePt[]; lower: FlamePt[] } {
  const N = 28;
  const upper: FlamePt[] = [];
  const lower: FlamePt[] = [];
  const breath = 1 + Math.sin(simTime * (2.2 + 2.5 * turbulence) + phaseSeed) * (0.03 + 0.05 * turbulence);

  for (let i = 0; i < N; i++) {
    const u = i / (N - 1);
    const x = -noseBack + u * (len + noseBack);

    // Smooth buoyant spine curve: rises off specimen and levels gracefully along upper duct boundary
    const spineY = -liftPx * Math.sin(Math.min(1, u * 1.1) * (Math.PI / 2));

    // Rounded leading nose (u=0) -> broad shoulder (u~0.3) -> open diffusing wake (u=1, never pinches to 0)
    const noseFactor = Math.pow(Math.sin(Math.min(1, u / 0.28) * (Math.PI / 2)), 0.62);
    const wakeTaper = 1 - (1 - openFlare) * Math.pow(clamp((u - 0.24) / 0.76, 0, 1), 1.15);
    const baseHalfH = rad * breath * noseFactor * wakeTaper;

    // Traveling boundary-layer shear & varicose waves growing downstream
    const spatialGrowth = Math.pow(u, 1.28) * turbulence * rad;
    const speed = 4.2 + 8.5 * turbulence;
    const sinuous =
      (0.55 * Math.sin(6.8 * u - simTime * speed + phaseSeed) +
        0.3 * Math.sin(12.6 * u - simTime * (speed * 1.65) + phaseSeed * 1.7) +
        0.15 * Math.sin(19.5 * u - simTime * (speed * 2.3) + 2.1)) *
      0.48 *
      spatialGrowth;

    const swellUp = Math.sin(9.2 * u - simTime * (speed * 1.25) + 0.5) * 0.22 * spatialGrowth;
    const swellLow = Math.sin(9.2 * u - simTime * (speed * 1.25) + 2.6) * 0.22 * spatialGrowth;

    upper.push({ x, y: spineY + sinuous - baseHalfH - swellUp });
    lower.push({ x, y: spineY + sinuous + baseHalfH + swellLow });
  }

  return { upper, lower };
}

function traceSmoothClosedPlume(
  ctx: CanvasRenderingContext2D,
  upper: FlamePt[],
  lower: FlamePt[],
): void {
  const n = upper.length;
  if (n < 3) return;
  const noseMidY = (upper[0].y + lower[0].y) * 0.5;
  const noseX = upper[0].x - Math.max(3, Math.abs(upper[1].y - lower[1].y) * 0.14);

  ctx.beginPath();
  ctx.moveTo(noseX, noseMidY);
  ctx.quadraticCurveTo(upper[0].x, upper[0].y, (upper[0].x + upper[1].x) * 0.5, (upper[0].y + upper[1].y) * 0.5);

  for (let i = 1; i < n - 1; i++) {
    const mx = (upper[i].x + upper[i + 1].x) * 0.5;
    const my = (upper[i].y + upper[i + 1].y) * 0.5;
    ctx.quadraticCurveTo(upper[i].x, upper[i].y, mx, my);
  }
  ctx.lineTo(upper[n - 1].x, upper[n - 1].y);
  ctx.lineTo(lower[n - 1].x, lower[n - 1].y);

  for (let i = n - 2; i >= 1; i--) {
    const mx = (lower[i].x + lower[i - 1].x) * 0.5;
    const my = (lower[i].y + lower[i - 1].y) * 0.5;
    ctx.quadraticCurveTo(lower[i].x, lower[i].y, mx, my);
  }
  ctx.quadraticCurveTo(lower[0].x, lower[0].y, noseX, noseMidY);
  ctx.closePath();
}

function traceOpenReactionSheath(
  ctx: CanvasRenderingContext2D,
  upper: FlamePt[],
  lower: FlamePt[],
): void {
  const n = upper.length;
  if (n < 3) return;
  const noseMidY = (upper[0].y + lower[0].y) * 0.5;
  const noseX = upper[0].x - Math.max(3, Math.abs(upper[1].y - lower[1].y) * 0.14);

  ctx.beginPath();
  ctx.moveTo(lower[n - 1].x, lower[n - 1].y);
  for (let i = n - 2; i >= 1; i--) {
    const mx = (lower[i].x + lower[i - 1].x) * 0.5;
    const my = (lower[i].y + lower[i - 1].y) * 0.5;
    ctx.quadraticCurveTo(lower[i].x, lower[i].y, mx, my);
  }
  ctx.quadraticCurveTo(lower[0].x, lower[0].y, noseX, noseMidY);
  ctx.quadraticCurveTo(upper[0].x, upper[0].y, (upper[0].x + upper[1].x) * 0.5, (upper[0].y + upper[1].y) * 0.5);
  for (let i = 1; i < n - 1; i++) {
    const mx = (upper[i].x + upper[i + 1].x) * 0.5;
    const my = (upper[i].y + upper[i + 1].y) * 0.5;
    ctx.quadraticCurveTo(upper[i].x, upper[i].y, mx, my);
  }
  ctx.lineTo(upper[n - 1].x, upper[n - 1].y);
}

export const CombustionDuctCanvas: React.FC<CombustionDuctCanvasProps> = ({
  params,
  telemetry,
  unitSystem,
  isPlaying,
  showStreamlines,
  showVectors,
  showContours,
  showThermocouples,
  showCrosshair = true,
  show1gOverlay = false,
  isFullscreen,
  cadTool,
  markers,
  pendingCaliperStart,
  onDropMarkerPoint,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [probe, setProbe] = useState<ProbeHoverState>({
    active: false,
    xMm: 225,
    yMm: 0,
    localTempK: AMBIENT_CHAMBER_TEMP_K,
    localVelMs: 0,
  });

  const hoverRef = useRef<{ active: boolean; xMm: number; yMm: number }>({
    active: false,
    xMm: 225,
    yMm: 0,
  });

  const renderStateRef = useRef({
    params,
    telemetry,
    unitSystem,
    overlays: {
      showStreamlines,
      showVectors,
      showContours,
      showThermocouples,
      showCrosshair,
      show1gOverlay,
    },
    isPlaying,
    combustionState: telemetry.chamberState,
    burnLengthMm: telemetry.burnLengthMm,
    igniterPulseActive: telemetry.igniterPowerW > 0,
    n2Suppressed: telemetry.n2DischargeActive,
    showStreamlines,
    showVectors,
    showContours,
    showThermocouples,
    showCrosshair,
    show1gOverlay,
    isFullscreen,
    cadTool,
    markers,
    pendingCaliperStart,
  });

  renderStateRef.current = {
    params,
    telemetry,
    unitSystem,
    overlays: {
      showStreamlines,
      showVectors,
      showContours,
      showThermocouples,
      showCrosshair,
      show1gOverlay,
    },
    isPlaying,
    combustionState: telemetry.chamberState,
    burnLengthMm: telemetry.burnLengthMm,
    igniterPulseActive: telemetry.igniterPowerW > 0,
    n2Suppressed: telemetry.n2DischargeActive,
    showStreamlines,
    showVectors,
    showContours,
    showThermocouples,
    showCrosshair,
    show1gOverlay,
    isFullscreen,
    cadTool,
    markers,
    pendingCaliperStart,
  };

  const dirtyRef = useRef(true);
  const scheduleRenderRef = useRef<() => void>(() => {});
  dirtyRef.current = true;
  if (!isPlaying) {
    scheduleRenderRef.current();
  }

  useEffect(() => {
    dirtyRef.current = true;
    scheduleRenderRef.current();
  }, [isPlaying]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const tracers: TracerParticle[] = Array.from({ length: 132 }, (_, idx) => {
      const yNorm = (((idx * 29) % 33) / 16.5 - 1) * 0.88;
      return {
        x: (idx * 0.0731) % 1,
        y: yNorm,
        speedJitter: 0.9 + ((idx * 17) % 11) * 0.018,
        phase: idx * 0.47,
        trail: [],
      };
    });

    const wisps: SootWisp[] = Array.from({ length: 14 }, (_, idx) => ({
      xOffset: (idx / 14) * 1.0,
      yOffset: Math.sin(idx * 1.9) * 0.14,
      radius: 12 + (idx % 5) * 7,
      alpha: 0.11 - (idx % 4) * 0.02,
      driftPhase: idx * 0.9,
    }));

    const embers: EmberParticle[] = Array.from({ length: 28 }, (_, idx) => ({
      x: 0.45 + (idx / 28) * 0.35,
      y: (((idx * 13) % 19) / 9.5 - 1) * 0.12,
      age: (idx / 28) * 1.1,
      maxAge: 0.75 + (idx % 5) * 0.18,
      size: 0.9 + (idx % 4) * 0.45,
      phase: idx * 0.73,
    }));

    let rafId = 0;
    let simTime = 0;
    let lastTs = performance.now();
    let lastPaintTs = 0;
    let displayFlameScale = renderStateRef.current.telemetry.flameScale;
    let lastPeakLenPx = 88;
    let lastPeakRadPx = 22;
    let scheduleRender = () => {};

    const getDuctBounds = (width: number, height: number, s: typeof renderStateRef.current) => {
      const sidePad = s.isFullscreen ? Math.max(32, width * 0.05) : Math.max(14, width * 0.025);
      const topBarPad = s.isFullscreen ? 42 : 38;
      const dockPad = s.isFullscreen ? 84 : 18;

      const ductLeft = sidePad;
      const ductRight = Math.max(sidePad + 240, width - sidePad);
      const ductWidth = ductRight - ductLeft;
      const availH = Math.max(140, height - topBarPad - dockPad);
      const ductCenterY = topBarPad + availH * 0.5;
      const ductHalfH = Math.min(availH * 0.42, 154);
      return {
        ductLeft,
        ductRight,
        ductWidth,
        ductCenterY,
        ductHalfH,
        ductTop: ductCenterY - ductHalfH,
        ductBottom: ductCenterY + ductHalfH,
      };
    };

    const renderFrame = (now: number) => {
      rafId = 0;
      const s = renderStateRef.current;
      const shouldAnimate = s.isPlaying;

      if (!dirtyRef.current && !shouldAnimate) {
        lastTs = now;
        return;
      }

      if (shouldAnimate && now - lastPaintTs < 24) {
        scheduleRender();
        return;
      }

      dirtyRef.current = false;
      lastPaintTs = now;
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTs) / 1000));
      lastTs = now;

      if (s.isPlaying) {
        simTime += dt;
        const diff = s.telemetry.flameScale - displayFlameScale;
        if (Math.abs(diff) < 0.002) {
          displayFlameScale = s.telemetry.flameScale;
        } else {
          displayFlameScale += diff * Math.min(1, dt * 16);
        }
      } else {
        displayFlameScale = s.telemetry.flameScale;
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = canvas.width / dpr;
      const height = canvas.height / dpr;

      ctx.save();
      ctx.scale(dpr, dpr);

      ctx.fillStyle = '#09090B';
      ctx.fillRect(0, 0, width, height);

      const {
        ductLeft,
        ductRight,
        ductWidth,
        ductCenterY,
        ductHalfH,
        ductTop,
        ductBottom,
      } = getDuctBounds(width, height, s);

      const straightenerW = 24;
      const chamberLeft = ductLeft + straightenerW;
      const chamberWidth = Math.max(120, ductWidth - straightenerW);

      const {
        flameGeometry,
        regime,
        chamberState,
        igniterPowerW,
        overloadActive,
        overloadIntensity,
        n2DischargeActive,
        arrestorActive,
        arrestorOverwhelmed,
        pyrolysisFactor,
        thermocoupleTempsK,
        totalHeatFluxWm2,
        stateElapsedS,
        buoyantVelocityMs,
        peakFlameTempK,
        flameScale: targetFlameScale,
        burnLengthMm,
      } = s.telemetry;

      const vForced = s.params.flowVelocityMs;
      const g = s.params.gravityMs2;
      const isConcurrent = s.params.flowMode === 'concurrent';
      const mat = MATERIALS[s.params.materialId];
      const geometry = resolveSpecimenGeometry(s.params);
      const hardware = resolveDuctHardware(s.params);

      // Solid specimen + stainless clamp assembly constrained strictly to 130..210 mm along 450 mm chamber
      const clampLeftX = chamberLeft + chamberWidth * (130 / 450);
      const clampRightX = chamberLeft + chamberWidth * (210 / 450);
      const clampJawW = clamp(chamberWidth * (12 / 450), 8, 14);
      const sampleX = clampLeftX + clampJawW;
      const sampleLen = Math.max(24, clampRightX - clampJawW - sampleX);
      const sampleThick = geometry === 'sheet' ? 4 : 9;
      const sampleY = ductCenterY;
      const channelHalfGapPx = clamp(ductHalfH * 0.16, 10, 16);
      const dropletCenterX = sampleX + sampleLen * 0.5;
      const burnFrac = clamp(burnLengthMm / SPECIMEN_LENGTH_MM, 0, 1);

      const arrestorX = chamberLeft + chamberWidth * (FLAME_ARRESTOR_X_MM / 450);
      const baffleX = chamberLeft + chamberWidth * (WAKE_BAFFLE_X_MM / 450);
      const nozzleX = chamberLeft + chamberWidth * (INERT_NOZZLE_X_MM / 450);

      const pxPerM = chamberWidth / 0.45;
      const rawPlumeLenPx = flameGeometry.plumeLengthM * pxPerM;
      const rawPlumeRadPx = flameGeometry.plumeRadiusM * pxPerM;
      if (targetFlameScale > 0.08 && rawPlumeLenPx > 4) {
        lastPeakLenPx = rawPlumeLenPx / targetFlameScale;
        lastPeakRadPx = rawPlumeRadPx / (0.45 + 0.55 * targetFlameScale);
      }
      const fullPlumeLenPx = Math.max(46, lastPeakLenPx);
      const fullPlumeRadPx = Math.max(14, lastPeakRadPx);

      const charAdvancePx = clamp(sampleLen * burnFrac, 8, Math.max(8, sampleLen - 6));
      const flameOriginX =
        geometry === 'droplet'
          ? dropletCenterX
          : isConcurrent
            ? sampleX + charAdvancePx
            : sampleX + sampleLen - charAdvancePx;
      const flameOriginY = sampleY;
      const tilt = flameGeometry.buoyancyTiltRad;
      const flowDirX = Math.cos(tilt);
      const flowDirY = -Math.sin(tilt);

      // Thermal expansion factor (0 when cold STANDBY / cooled SELF_EXTINGUISHED)
      const gasTempBoost = clamp((peakFlameTempK - AMBIENT_CHAMBER_TEMP_K) / 1600, 0, 1);
      const activeFlameThermal = displayFlameScale * (0.35 + 0.65 * gasTempBoost);
      const igniterThermal = chamberState === 'IGNITING' ? pyrolysisFactor * 0.2 : 0;
      const thermalScale = clamp(Math.max(activeFlameThermal, igniterThermal), 0, 1.15);

      // 1. Interior Duct Chamber Background
      ctx.fillStyle = '#0D0D11';
      ctx.fillRect(ductLeft, ductTop, ductWidth, ductHalfH * 2);

      ctx.strokeStyle = 'rgba(39, 39, 42, 0.45)';
      ctx.lineWidth = 1;
      for (let i = 1; i < 10; i++) {
        const gx = chamberLeft + (chamberWidth * i) / 10;
        ctx.beginPath();
        ctx.moveTo(gx, ductTop);
        ctx.lineTo(gx, ductBottom);
        ctx.stroke();
      }
      for (let j = -2; j <= 2; j++) {
        const gy = ductCenterY + (ductHalfH * j) / 3;
        ctx.beginPath();
        ctx.moveTo(chamberLeft, gy);
        ctx.lineTo(ductRight, gy);
        ctx.stroke();
      }

      // 2. Heat Flux Contours (Clipped inside chamber, smoothly fades with displayFlameScale)
      if (s.showContours && (displayFlameScale > 0.01 || chamberState === 'IGNITING' || totalHeatFluxWm2 > 120)) {
        const thermalReach =
          displayFlameScale > 0.01 && chamberState !== 'IGNITING'
            ? Math.max(36, fullPlumeLenPx * (0.45 + 1.15 * displayFlameScale)) * (1 + 0.12 * overloadIntensity)
            : chamberState === 'IGNITING'
              ? 48 + pyrolysisFactor * 34 + displayFlameScale * 35
              : 42;
        const cx =
          chamberState === 'IGNITING'
            ? flameOriginX
            : flameOriginX + flowDirX * thermalReach * 0.22 * displayFlameScale;
        const cy =
          chamberState === 'IGNITING'
            ? flameOriginY
            : flameOriginY + flowDirY * thermalReach * 0.22 * displayFlameScale;

        ctx.save();
        ctx.beginPath();
        ctx.rect(chamberLeft, ductTop + 1, chamberWidth, ductHalfH * 2 - 2);
        ctx.clip();

        const contourGrad = ctx.createRadialGradient(cx, cy, 4, cx, cy, thermalReach);
        if (chamberState === 'IGNITING') {
          contourGrad.addColorStop(0, `rgba(252, 211, 77, ${(0.18 + 0.14 * pyrolysisFactor).toFixed(2)})`);
          contourGrad.addColorStop(0.55, `rgba(103, 232, 249, ${(0.10 + 0.12 * displayFlameScale).toFixed(2)})`);
          contourGrad.addColorStop(1, 'rgba(103, 232, 249, 0)');
        } else if (regime === 'Radiative Spherical' && displayFlameScale > 0.01) {
          const sphA = 0.26 * Math.min(1, displayFlameScale * 1.25);
          contourGrad.addColorStop(0, `rgba(103, 232, 249, ${sphA.toFixed(2)})`);
          contourGrad.addColorStop(0.55, `rgba(103, 232, 249, ${(sphA * 0.35).toFixed(2)})`);
          contourGrad.addColorStop(1, 'rgba(103, 232, 249, 0)');
        } else if (displayFlameScale > 0.01) {
          const scaleFade = Math.min(1, displayFlameScale * 1.3);
          const coreAlpha = ((regime === 'Critical Runaway' ? 0.34 : 0.22) + 0.1 * overloadIntensity) * scaleFade;
          contourGrad.addColorStop(0, `rgba(253, 164, 175, ${coreAlpha.toFixed(2)})`);
          contourGrad.addColorStop(0.42, `rgba(252, 211, 77, ${(0.13 * scaleFade).toFixed(2)})`);
          contourGrad.addColorStop(0.76, `rgba(103, 232, 249, ${(0.06 * scaleFade).toFixed(2)})`);
          contourGrad.addColorStop(1, 'rgba(103, 232, 249, 0)');
        } else {
          const coolAlpha = Math.max(0.01, 0.1 * Math.exp(-stateElapsedS * 0.6));
          contourGrad.addColorStop(0, `rgba(252, 211, 77, ${coolAlpha.toFixed(2)})`);
          contourGrad.addColorStop(1, 'rgba(103, 232, 249, 0)');
        }
        ctx.fillStyle = contourGrad;
        ctx.fillRect(chamberLeft, ductTop, chamberWidth, ductHalfH * 2);

        if (displayFlameScale > 0.05 || chamberState === 'IGNITING') {
          const ringFade = chamberState === 'IGNITING' ? 0.22 : 0.18 * Math.min(1, displayFlameScale * 1.2);
          ctx.strokeStyle =
            chamberState === 'IGNITING' || displayFlameScale <= 0.35
              ? `rgba(103, 232, 249, ${ringFade.toFixed(2)})`
              : regime === 'Radiative Spherical'
                ? `rgba(103, 232, 249, ${ringFade.toFixed(2)})`
                : `rgba(252, 211, 77, ${ringFade.toFixed(2)})`;
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          for (const mult of [0.42, 0.72, 0.96]) {
            ctx.beginPath();
            ctx.ellipse(
              cx,
              cy,
              thermalReach * mult,
              Math.min(
                ductHalfH * 0.92,
                thermalReach * mult * (regime === 'Radiative Spherical' || chamberState === 'IGNITING' ? 0.92 : 0.56),
              ),
              chamberState === 'IGNITING' ? 0 : -tilt * 0.55,
              0,
              Math.PI * 2,
            );
            ctx.stroke();
          }
          ctx.setLineDash([]);
        }
        ctx.restore();
      }

      // 3. Fluid Tracer Streamlines (Solid rig + Wake Baffle + Thermal expansion)
      ctx.save();
      ctx.beginPath();
      ctx.rect(chamberLeft, ductTop + 2, chamberWidth, ductHalfH * 2 - 4);
      ctx.clip();

      const effectiveAdvanceSpeed =
        vForced > 0.002 ? 42 + vForced * 460 : g > 0.3 && thermalScale > 0.05 ? 28 + buoyantVelocityMs * 75 : 0;

      if (s.showStreamlines && (vForced > 0.002 || (g > 0.3 && thermalScale > 0.05))) {
        for (const t of tracers) {
          const xMmNow = t.x * 450;
          const field = evaluateDuctFlowField(
            xMmNow,
            t.y,
            thermalScale,
            g,
            simTime,
            t.phase,
            hardware,
            n2DischargeActive,
          );

          if (s.isPlaying) {
            const dxNorm =
              (effectiveAdvanceSpeed * field.parabolic * field.uMultiplier * t.speedJitter * dt) / chamberWidth;
            t.x += dxNorm;

            if (t.x > 1.03) {
              t.x = 0.0;
              t.y = (((Math.round(t.phase * 100) % 33) / 16.5) - 1) * 0.88;
              t.trail = [];
            }

            const nextField = evaluateDuctFlowField(
              t.x * 450,
              t.y,
              thermalScale,
              g,
              simTime,
              t.phase,
              hardware,
              n2DischargeActive,
            );
            const pxBase = chamberLeft + t.x * chamberWidth;
            const pyActual = ductCenterY + nextField.yStreamNorm * (ductHalfH - 10);
            t.trail.push({ x: pxBase, y: pyActual });
            if (t.trail.length > 7) t.trail.shift();
          }

          if (t.trail.length > 1) {
            ctx.strokeStyle =
              vForced > 0.36 ? 'rgba(103, 232, 249, 0.42)' : 'rgba(103, 232, 249, 0.28)';
            ctx.lineWidth = 1.25;
            ctx.beginPath();
            ctx.moveTo(t.trail[0].x, t.trail[0].y);
            for (let k = 1; k < t.trail.length; k++) {
              ctx.lineTo(t.trail[k].x, t.trail[k].y);
            }
            ctx.stroke();

            const head = t.trail[t.trail.length - 1];
            ctx.fillStyle = 'rgba(165, 243, 252, 0.72)';
            ctx.beginPath();
            ctx.arc(head.x, head.y, 1.35, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // 4. Calibrated Velocity Vector Arrow Field (Cold Parabolic Poiseuille vs Hot Thermal Expansion)
      if (s.showVectors) {
        if (vForced > 0.002) {
          const cols = 8;
          const rows = 5;
          for (let r = 0; r < rows; r++) {
            const yNorm = -0.72 + (r / (rows - 1)) * 1.44;
            for (let c = 0; c < cols; c++) {
              const xFrac = (24 + (c / (cols - 1)) * (chamberWidth - 72)) / chamberWidth;
              const xMmVec = xFrac * 450;
              const field = evaluateDuctFlowField(
                xMmVec,
                yNorm,
                thermalScale,
                g,
                simTime,
                c * 0.6,
                hardware,
                n2DischargeActive,
              );

              const vx = chamberLeft + xFrac * chamberWidth;
              const vy = ductCenterY + field.yStreamNorm * (ductHalfH - 16);

              // Skip inside solid clamp/specimen bar (130..210 mm) or wake baffle (95 mm)
              if (xMmVec > 126 && xMmVec < 214 && Math.abs(vy - sampleY) < 16) {
                continue;
              }
              if (hardware.wakeBaffle && Math.abs(xMmVec - WAKE_BAFFLE_X_MM) < 12 && Math.abs(vy - sampleY) < 28) {
                continue;
              }

              const arrowLen = (11 + vForced * 52) * field.parabolic * field.uMultiplier;
              const dx = arrowLen;
              const dy = arrowLen * field.slopeDyDx;
              const mag = Math.hypot(dx, dy) || 1;
              const ux = dx / mag;
              const uy = dy / mag;
              const ex = vx + dx;
              const ey = vy + dy;

              ctx.strokeStyle =
                field.uMultiplier > 1.06 && thermalScale > 0.2
                  ? 'rgba(165, 243, 252, 0.56)'
                  : 'rgba(103, 232, 249, 0.42)';
              ctx.lineWidth = 1.1;
              ctx.beginPath();
              ctx.moveTo(vx, vy);
              ctx.lineTo(ex, ey);
              ctx.lineTo(ex - ux * 4.2 + uy * 2.2, ey - uy * 4.2 - ux * 2.2);
              ctx.moveTo(ex, ey);
              ctx.lineTo(ex - ux * 4.2 - uy * 2.2, ey - uy * 4.2 + ux * 2.2);
              ctx.stroke();
            }
          }
        } else {
          ctx.fillStyle = '#71717A';
          ctx.font = '10px "JetBrains Mono Variable", monospace';
          ctx.fillText('0.0 cm/s · QUIESCENT DIFFUSION REGIME', chamberLeft + 16, ductTop + 24);
        }

        if (g > 0.4) {
          const bx = chamberLeft + 24;
          const by = ductBottom - 22;
          const arrowH = Math.min(44, 16 + (g / 9.80665) * 28);
          ctx.strokeStyle = '#FCD34D';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx, by - arrowH);
          ctx.lineTo(bx - 4, by - arrowH + 6);
          ctx.moveTo(bx, by - arrowH);
          ctx.lineTo(bx + 4, by - arrowH + 6);
          ctx.stroke();
          ctx.fillStyle = '#FCD34D';
          ctx.font = '10px "JetBrains Mono Variable", monospace';
          ctx.fillText('BUOYANCY g', bx + 7, by - arrowH + 9);
        }
      }

      // 5. Stratified Open-Tipped Diffusion Flame Plume & Streamline Ember Micro-Particles
      const gFactor = clamp(g / 9.80665, 0, 1);
      const highFlowFactor = clamp((vForced - 0.20) / 0.22, 0, 1);
      const turbulence = clamp(0.12 + 0.72 * gFactor + 0.68 * highFlowFactor + 0.25 * overloadIntensity, 0.1, 1.25);

      if (chamberState === 'IGNITING') {
        // 80 W hot-wire pyrolysis vapor glow emerging around sample leading edge
        const rVapor = (20 + pyrolysisFactor * 24) * (0.95 + Math.sin(simTime * 5) * 0.05);
        const vaporGrad = ctx.createRadialGradient(flameOriginX, flameOriginY, 2, flameOriginX, flameOriginY, rVapor);
        vaporGrad.addColorStop(0, `rgba(252, 211, 77, ${(0.28 + pyrolysisFactor * 0.36).toFixed(2)})`);
        vaporGrad.addColorStop(0.55, `rgba(103, 232, 249, ${(0.16 + pyrolysisFactor * 0.26).toFixed(2)})`);
        vaporGrad.addColorStop(1, 'rgba(103, 232, 249, 0)');
        ctx.fillStyle = vaporGrad;
        ctx.beginPath();
        ctx.arc(flameOriginX, flameOriginY, rVapor, 0, Math.PI * 2);
        ctx.fill();
      }

      const sootMix =
        chamberState === 'IGNITING'
          ? 0.02
          : smoothstep01((displayFlameScale - 0.30) / 0.50);
      // Incandescent soot dims & vanishes as O2% drops or flow approaches < 3 cm/s microgravity radiative quenching
      const o2SootGate = smoothstep01((s.params.o2Percent - 16.0) / 5.5);
      const lowFlowSootGate = vForced < 0.03 && g < 0.5 ? smoothstep01(vForced / 0.03) : 1.0;
      const sootLum = clamp(flameGeometry.sootIntensity * o2SootGate * lowFlowSootGate, 0, 1) * sootMix;

      // Clip flame wake strictly upstream of Flame Arrestor Mesh (280 mm) when active & not overwhelmed
      ctx.save();
      if (arrestorActive && !arrestorOverwhelmed) {
        ctx.beginPath();
        ctx.rect(chamberLeft, ductTop + 2, Math.max(10, arrestorX - chamberLeft), ductHalfH * 2 - 4);
        ctx.clip();
      }

      // 5a. Optional 1g Buoyant Plume Silhouette Overlay (Dashed Reference Comparison)
      if (s.show1gOverlay) {
        const ref1g = computeThermoTelemetry({ ...s.params, gravityMs2: 9.80665 });
        const len1g = Math.max(52, Math.max(0.068, ref1g.flameGeometry.plumeLengthM) * pxPerM * 0.85);
        const rad1g = Math.max(15, Math.max(0.017, ref1g.flameGeometry.plumeRadiusM) * pxPerM * 0.85);
        const tilt1g = Math.max(0.38, ref1g.flameGeometry.buoyancyTiltRad);
        const maxLift1g = Math.max(12, ductHalfH - rad1g * 1.45 - 12);
        const lift1g = clamp(len1g * Math.sin(tilt1g) * 0.85, 18, maxLift1g);
        const angle1g = -tilt1g * 0.16;
        const env1g = buildOpenFlameEnvelope(len1g, rad1g, 6, 0.22, simTime * 0.35, 0.9, 0.48, lift1g);

        ctx.save();
        ctx.translate(flameOriginX, flameOriginY);
        ctx.rotate(angle1g);
        ctx.fillStyle = 'rgba(228, 228, 231, 0.04)';
        traceSmoothClosedPlume(ctx, env1g.upper, env1g.lower);
        ctx.fill();

        ctx.strokeStyle =
          ref1g.loiMarginPercent >= 0
            ? 'rgba(252, 211, 77, 0.48)'
            : 'rgba(161, 161, 170, 0.45)';
        ctx.lineWidth = 1.25;
        ctx.setLineDash([5, 4]);
        traceOpenReactionSheath(ctx, env1g.upper, env1g.lower);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();

        const labelX = clamp(flameOriginX + len1g * 0.32, chamberLeft + 12, ductRight - 185);
        const labelY = Math.max(ductTop + 15, flameOriginY - lift1g - rad1g - 6);
        ctx.save();
        ctx.font = '9.5px "JetBrains Mono Variable", monospace';
        ctx.fillStyle = 'rgba(212, 212, 216, 0.72)';
        const status1g =
          ref1g.loiMarginPercent >= 0
            ? `${(ref1g.flameSpreadRateMs * 1000).toFixed(2)} mm/s`
            : `QUENCHED (LOI ${ref1g.effectiveLoiPercent.toFixed(1)}%)`;
        ctx.fillText(`1G BUOYANT ENVELOPE · ${status1g}`, labelX, labelY);
        ctx.restore();
      }

      if (displayFlameScale > 0.008) {
        if (
          (regime === 'Radiative Spherical' || (geometry === 'droplet' && g < 0.98 && vForced < 0.14)) &&
          chamberState !== 'IGNITING'
        ) {
          // Cool dim cyan-blue radiative diffusion sphere / concentric droplet cool-flame halo
          const breathSph = 1 + Math.sin(simTime * 2.2) * 0.04;
          const rSph =
            Math.max(
              10,
              fullPlumeRadPx * (geometry === 'droplet' ? 1.42 : 1.28) * (0.3 + 0.7 * displayFlameScale),
            ) * breathSph;
          const sphFade = clamp(displayFlameScale / 0.35, 0, 1);

          ctx.save();
          ctx.globalCompositeOperation = 'screen';
          const sphGrad = ctx.createRadialGradient(flameOriginX, flameOriginY, 2, flameOriginX, flameOriginY, rSph);
          sphGrad.addColorStop(0, `rgba(56, 189, 248, ${(0.34 * sphFade).toFixed(2)})`);
          sphGrad.addColorStop(0.62, `rgba(103, 232, 249, ${(0.48 * sphFade).toFixed(2)})`);
          if (geometry === 'droplet' && sootLum > 0.15) {
            sphGrad.addColorStop(0.76, `rgba(252, 211, 77, ${(0.22 * sootLum * sphFade).toFixed(2)})`);
          }
          sphGrad.addColorStop(0.84, `rgba(56, 189, 248, ${(0.18 * sphFade).toFixed(2)})`);
          sphGrad.addColorStop(1, 'rgba(56, 189, 248, 0)');
          ctx.fillStyle = sphGrad;
          ctx.beginPath();
          ctx.arc(flameOriginX, flameOriginY, rSph, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = `rgba(103, 232, 249, ${(0.72 * sphFade).toFixed(2)})`;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(flameOriginX, flameOriginY, rSph * 0.72, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();

          // Dark pyrolysis vapor cavity over specimen/droplet
          const cavGrad = ctx.createRadialGradient(flameOriginX, flameOriginY, 1, flameOriginX, flameOriginY, rSph * 0.45);
          cavGrad.addColorStop(0, `rgba(15, 15, 20, ${(0.55 * sphFade).toFixed(2)})`);
          cavGrad.addColorStop(1, 'rgba(15, 15, 20, 0)');
          ctx.fillStyle = cavGrad;
          ctx.beginPath();
          ctx.arc(flameOriginX, flameOriginY, rSph * 0.45, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Open-tipped traveling-wave diffusion flame plume (curves gracefully along upper duct boundary in 1g)
          const scaleRamp = clamp(displayFlameScale / 0.45, 0.25, 1);
          const len = Math.max(16, fullPlumeLenPx * displayFlameScale);
          const rad = Math.max(7, fullPlumeRadPx * (0.38 + 0.62 * displayFlameScale));
          const alphaScale = clamp(displayFlameScale / 0.22, 0.14, 1);
          const noseBack = Math.min(12, 5 + 7 * displayFlameScale);
          const maxSafeLift = Math.max(0, ductHalfH - rad * 1.45 - 12);
          const liftPx = clamp(len * Math.sin(tilt) * 0.88 * scaleRamp, 0, maxSafeLift);
          const flameAngle = -tilt * 0.16 * scaleRamp;

          // Geometry-specific multi-front offsets:
          // - 'sheet': subtle upper & lower symmetric boundary-layer dual plumes
          // - 'channel': twin opposing plate boundary flames + intensified radiant core gap glow
          const plumeOriginsY =
            geometry === 'channel'
              ? [flameOriginY - channelHalfGapPx + 3, flameOriginY + channelHalfGapPx - 3]
              : geometry === 'sheet'
                ? [flameOriginY - 3, flameOriginY + 3]
                : [flameOriginY];

          if (geometry === 'channel' && displayFlameScale > 0.15) {
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            const gapGlow = ctx.createLinearGradient(sampleX, flameOriginY, flameOriginX + len * 0.9, flameOriginY);
            gapGlow.addColorStop(0, `rgba(252, 211, 77, ${(0.28 * alphaScale).toFixed(2)})`);
            gapGlow.addColorStop(0.55, `rgba(249, 115, 22, ${(0.22 * alphaScale).toFixed(2)})`);
            gapGlow.addColorStop(1, 'rgba(249, 115, 22, 0)');
            ctx.fillStyle = gapGlow;
            ctx.fillRect(sampleX, flameOriginY - channelHalfGapPx + 3, sampleLen + len * 0.7, channelHalfGapPx * 2 - 6);
            ctx.restore();
          }

          for (let pIdx = 0; pIdx < plumeOriginsY.length; pIdx++) {
            const originYItem = plumeOriginsY[pIdx];
            const radScale = plumeOriginsY.length > 1 ? 0.72 : 1.0;
            const localRad = rad * radScale;

            ctx.save();
            ctx.translate(flameOriginX, originYItem);
            ctx.rotate(flameAngle);

            // Soft drifting radiative / soot wake wisps downstream (open-tipped fade to alpha 0.0)
            if (pIdx === 0 && displayFlameScale > 0.22) {
              for (const w of wisps) {
                const prog = (w.xOffset + simTime * (0.28 + vForced * 0.8)) % 1.0;
                const wx = len * (0.84 + prog * 1.08);
                const wy =
                  -liftPx * 0.92 +
                  w.yOffset * localRad * (1.7 + prog * 1.3) +
                  Math.sin(simTime * (3.5 + 4 * turbulence) + w.driftPhase) * (3 + 7 * turbulence);
                const rWisp = w.radius * (0.55 + 0.75 * prog) * (0.5 + 0.5 * displayFlameScale);
                const wAlpha = w.alpha * (1 - prog) * (0.35 + 0.65 * sootLum) * alphaScale;
                if (wAlpha > 0.005) {
                  const wGrad = ctx.createRadialGradient(wx, wy, 1, wx, wy, rWisp);
                  wGrad.addColorStop(0, `rgba(161, 161, 170, ${wAlpha.toFixed(3)})`);
                  wGrad.addColorStop(0.6, `rgba(113, 113, 122, ${(wAlpha * 0.45).toFixed(3)})`);
                  wGrad.addColorStop(1, 'rgba(113, 113, 122, 0)');
                  ctx.fillStyle = wGrad;
                  ctx.beginPath();
                  ctx.arc(wx, wy, rWisp, 0, Math.PI * 2);
                  ctx.fill();
                }
              }
            }

            // Layer A (screen): Outer stoichiometric cyan-blue reaction front (#38BDF8 / #67E8F9)
            const outerEnv = buildOpenFlameEnvelope(
              len * 1.22,
              localRad * 1.12,
              noseBack,
              turbulence,
              simTime,
              pIdx * 1.3,
              0.52,
              liftPx,
            );

            ctx.save();
            ctx.globalCompositeOperation = 'screen';

            const blueFill = ctx.createLinearGradient(-noseBack, 0, len * 1.22, -liftPx * 0.82);
            blueFill.addColorStop(0, `rgba(103, 232, 249, ${(0.36 * alphaScale).toFixed(2)})`);
            blueFill.addColorStop(0.36, `rgba(56, 189, 248, ${(0.28 * alphaScale).toFixed(2)})`);
            blueFill.addColorStop(0.74, `rgba(56, 189, 248, ${(0.09 * alphaScale).toFixed(2)})`);
            blueFill.addColorStop(1, 'rgba(56, 189, 248, 0)');
            ctx.fillStyle = blueFill;
            traceSmoothClosedPlume(ctx, outerEnv.upper, outerEnv.lower);
            ctx.fill();

            const blueSheath = ctx.createLinearGradient(-noseBack, 0, len * 1.16, -liftPx * 0.82);
            blueSheath.addColorStop(0, `rgba(103, 232, 249, ${(0.92 * alphaScale).toFixed(2)})`);
            blueSheath.addColorStop(0.5, `rgba(56, 189, 248, ${(0.58 * alphaScale).toFixed(2)})`);
            blueSheath.addColorStop(0.85, `rgba(56, 189, 248, ${(0.15 * alphaScale).toFixed(2)})`);
            blueSheath.addColorStop(1, 'rgba(56, 189, 248, 0)');
            ctx.shadowColor = `rgba(56, 189, 248, ${(0.52 * alphaScale).toFixed(2)})`;
            ctx.shadowBlur = 9;
            ctx.strokeStyle = blueSheath;
            ctx.lineWidth = 1.85;
            traceOpenReactionSheath(ctx, outerEnv.upper, outerEnv.lower);
            ctx.stroke();
            ctx.shadowBlur = 0;

            // Layer B (screen): Feathered middle incandescent soot zone (#FCD34D to #F97316)
            if (sootLum > 0.025) {
              const sootHaloEnv = buildOpenFlameEnvelope(
                len * 1.08,
                localRad * 0.86,
                noseBack * 0.52,
                turbulence * 0.9,
                simTime,
                0.45 + pIdx * 1.1,
                0.44,
                liftPx * 0.9,
              );
              const sootHaloAlpha = Math.min(0.46, (0.16 + sootLum * 0.28 + 0.08 * overloadIntensity) * alphaScale);
              const sootHaloGrad = ctx.createLinearGradient(-noseBack * 0.52, 0, len * 1.08, -liftPx * 0.78);
              sootHaloGrad.addColorStop(0, `rgba(249, 115, 22, ${(sootHaloAlpha * 0.9).toFixed(2)})`);
              sootHaloGrad.addColorStop(0.48, `rgba(249, 115, 22, ${(sootHaloAlpha * 0.58).toFixed(2)})`);
              sootHaloGrad.addColorStop(1, 'rgba(249, 115, 22, 0)');
              ctx.shadowColor = `rgba(249, 115, 22, ${(sootHaloAlpha * 0.85).toFixed(2)})`;
              ctx.shadowBlur = 12;
              ctx.fillStyle = sootHaloGrad;
              traceSmoothClosedPlume(ctx, sootHaloEnv.upper, sootHaloEnv.lower);
              ctx.fill();

              const sootEnv = buildOpenFlameEnvelope(
                len * 0.98,
                localRad * 0.64,
                noseBack * 0.4,
                turbulence * 0.84,
                simTime,
                0.75 + pIdx * 1.1,
                0.4,
                liftPx * 0.86,
              );
              const sootAlpha = Math.min(0.86, (0.28 + sootLum * 0.52 + 0.14 * overloadIntensity) * alphaScale);
              const sootGrad = ctx.createLinearGradient(-noseBack * 0.4, 0, len * 0.98, -liftPx * 0.75);
              sootGrad.addColorStop(0, `rgba(252, 211, 77, ${(sootAlpha * 0.94).toFixed(2)})`);
              sootGrad.addColorStop(0.38, `rgba(252, 211, 77, ${(sootAlpha * 0.78).toFixed(2)})`);
              sootGrad.addColorStop(0.72, `rgba(249, 115, 22, ${(sootAlpha * 0.34).toFixed(2)})`);
              sootGrad.addColorStop(1, 'rgba(249, 115, 22, 0)');
              ctx.shadowColor = `rgba(252, 211, 77, ${(sootAlpha * 0.55).toFixed(2)})`;
              ctx.shadowBlur = 9;
              ctx.fillStyle = sootGrad;
              traceSmoothClosedPlume(ctx, sootEnv.upper, sootEnv.lower);
              ctx.fill();

              if (sootLum > 0.35 || overloadActive) {
                const hotEnv = buildOpenFlameEnvelope(
                  len * 0.72,
                  localRad * 0.4,
                  noseBack * 0.2,
                  turbulence * 0.72,
                  simTime,
                  1.4 + pIdx * 0.9,
                  0.36,
                  liftPx * 0.74,
                );
                const hotAlpha = clamp((sootLum * 0.52 + overloadIntensity * 0.35) * alphaScale, 0, 0.76);
                const hotGrad = ctx.createLinearGradient(0, 0, len * 0.72, -liftPx * 0.65);
                hotGrad.addColorStop(0, `rgba(254, 243, 199, ${hotAlpha.toFixed(2)})`);
                hotGrad.addColorStop(0.55, `rgba(252, 211, 77, ${(hotAlpha * 0.5).toFixed(2)})`);
                hotGrad.addColorStop(1, 'rgba(249, 115, 22, 0)');
                ctx.shadowBlur = 7;
                ctx.fillStyle = hotGrad;
                traceSmoothClosedPlume(ctx, hotEnv.upper, hotEnv.lower);
                ctx.fill();
              }
              ctx.shadowBlur = 0;
            }

            ctx.restore(); // restore globalCompositeOperation

            // Layer C (source-over): Inner dark/translucent pyrolysis vapor cavity hugging fuel surface
            const cavLen = len * 0.44;
            const cavRad = Math.max(3.2, localRad * 0.29);
            const cavEnv = buildOpenFlameEnvelope(cavLen, cavRad, 2, turbulence * 0.42, simTime, 2.1 + pIdx, 0.32, liftPx * 0.36);
            const cavGrad = ctx.createLinearGradient(-2, 0, cavLen, -liftPx * 0.3);
            cavGrad.addColorStop(0, `rgba(15, 15, 20, ${(0.52 * alphaScale).toFixed(2)})`);
            cavGrad.addColorStop(0.65, `rgba(15, 15, 20, ${(0.28 * alphaScale).toFixed(2)})`);
            cavGrad.addColorStop(1, 'rgba(15, 15, 20, 0)');
            ctx.save();
            ctx.shadowColor = `rgba(12, 12, 16, ${(0.45 * alphaScale).toFixed(2)})`;
            ctx.shadowBlur = 6;
            ctx.fillStyle = cavGrad;
            traceSmoothClosedPlume(ctx, cavEnv.upper, cavEnv.lower);
            ctx.fill();
            ctx.restore();

            ctx.restore();
          }

          // Streamline-advected glowing soot/ember micro-particles emitted from open downstream tip
          if (sootLum > 0.08 && displayFlameScale > 0.28) {
            const tipLocalX = len * 0.86;
            const tipLocalY = -liftPx * 0.86;
            const tipOriginX =
              flameOriginX + tipLocalX * Math.cos(flameAngle) - tipLocalY * Math.sin(flameAngle);
            const tipOriginY =
              flameOriginY + tipLocalX * Math.sin(flameAngle) + tipLocalY * Math.cos(flameAngle);
            const tipXNorm = clamp((tipOriginX - chamberLeft) / chamberWidth, 0.25, 0.92);
            const tipYNormBase = clamp((tipOriginY - ductCenterY) / Math.max(1, ductHalfH - 10), -0.86, 0.86);

            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            for (const emb of embers) {
              if (s.isPlaying) {
                emb.age += dt;
                if (emb.age >= emb.maxAge || emb.x > 1.01) {
                  emb.age = 0;
                  emb.x = tipXNorm + Math.sin(emb.phase * 3.1 + simTime) * 0.025;
                  emb.y = tipYNormBase + Math.cos(emb.phase * 4.7 + simTime * 2) * (rad / Math.max(40, ductHalfH)) * 0.55;
                } else {
                  const embField = evaluateDuctFlowField(
                    emb.x * 450,
                    emb.y,
                    thermalScale,
                    g,
                    simTime,
                    emb.phase,
                    hardware,
                    n2DischargeActive,
                  );
                  const speedNorm =
                    (Math.max(26, effectiveAdvanceSpeed) * embField.parabolic * embField.uMultiplier * dt) /
                    chamberWidth;
                  emb.x += speedNorm * 0.92;
                  emb.y = clamp(emb.y + speedNorm * embField.slopeDyDx * 0.85, -0.92, 0.92);
                }
              }

              const life = clamp(emb.age / emb.maxAge, 0, 1);
              const ex = chamberLeft + emb.x * chamberWidth;
              const ey = ductCenterY + emb.y * (ductHalfH - 10);
              const eAlpha = (1 - life) * (1 - life) * 0.65 * sootLum * alphaScale;
              if (eAlpha > 0.015) {
                ctx.fillStyle = life < 0.45 ? `rgba(252, 211, 77, ${eAlpha.toFixed(2)})` : `rgba(249, 115, 22, ${eAlpha.toFixed(2)})`;
                ctx.beginPath();
                ctx.arc(ex, ey, emb.size * (1 - 0.35 * life), 0, Math.PI * 2);
                ctx.fill();
              }
            }
            ctx.restore();
          }
        }
      }
      ctx.restore(); // restore optional Flame Arrestor clip

      if (chamberState === 'SELF_EXTINGUISHED' && stateElapsedS < 1.8) {
        const fade = Math.max(0, 1 - stateElapsedS / 1.8);
        for (let b = 0; b < 4; b++) {
          const offset = ((simTime * 85 + b * 22) % 72) + 10;
          ctx.fillStyle = `rgba(161, 161, 170, ${(fade * 0.22).toFixed(2)})`;
          ctx.beginPath();
          ctx.ellipse(
            flameOriginX + offset,
            flameOriginY + Math.sin(b * 1.4 + simTime * 8) * 4,
            9,
            4,
            0,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
      }
      ctx.restore();

      // 6. Duct Hardware Add-ons + Geometry-Specific Specimen & Sample Holder Clamp
      // 6a. Upstream Wake Baffle (X = 95 mm)
      if (hardware.wakeBaffle) {
        const bafHalfH = Math.min(26, ductHalfH * 0.32);
        ctx.fillStyle = '#27272A';
        ctx.fillRect(baffleX - 1.5, sampleY + bafHalfH, 3, ductBottom - (sampleY + bafHalfH));
        const bafGrad = ctx.createLinearGradient(baffleX - 5, 0, baffleX + 5, 0);
        bafGrad.addColorStop(0, '#52525B');
        bafGrad.addColorStop(0.5, '#3F3F46');
        bafGrad.addColorStop(1, '#27272A');
        ctx.fillStyle = bafGrad;
        ctx.fillRect(baffleX - 5, sampleY - bafHalfH, 10, bafHalfH * 2);
        ctx.strokeStyle = '#A1A1AA';
        ctx.lineWidth = 1;
        ctx.strokeRect(baffleX - 5, sampleY - bafHalfH, 10, bafHalfH * 2);

        if (vForced > 0.004) {
          ctx.strokeStyle = 'rgba(103, 232, 249, 0.32)';
          ctx.lineWidth = 1;
          for (const sign of [-1, 1]) {
            const wy = sampleY + sign * (bafHalfH * 0.55);
            const wx = baffleX + 14 + Math.sin(simTime * 5 + sign) * 3;
            ctx.beginPath();
            ctx.arc(wx, wy, 5, 0, Math.PI * 1.45);
            ctx.stroke();
          }
        }
      }

      // 6b. Flame Arrestor Mesh (X = 280 mm)
      if (hardware.flameArrestor) {
        const meshHot = arrestorOverwhelmed && displayFlameScale > 0.15;
        ctx.fillStyle = meshHot ? 'rgba(252, 211, 77, 0.24)' : 'rgba(161, 161, 170, 0.12)';
        ctx.fillRect(arrestorX - 3, ductTop + 2, 6, ductHalfH * 2 - 4);
        ctx.strokeStyle = meshHot ? '#FCD34D' : '#71717A';
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.moveTo(arrestorX - 3, ductTop + 2);
        ctx.lineTo(arrestorX - 3, ductBottom - 2);
        ctx.moveTo(arrestorX + 3, ductTop + 2);
        ctx.lineTo(arrestorX + 3, ductBottom - 2);
        ctx.stroke();

        ctx.strokeStyle = meshHot ? 'rgba(253, 164, 175, 0.8)' : 'rgba(161, 161, 170, 0.55)';
        ctx.lineWidth = 0.85;
        for (let py = ductTop + 6; py < ductBottom - 4; py += 6) {
          ctx.beginPath();
          ctx.moveTo(arrestorX - 3, py);
          ctx.lineTo(arrestorX + 3, py + 3);
          ctx.stroke();
        }
      }

      // 6c. Inert Gas Nozzle (X = 160 mm top wall injector + N2 expansion cone)
      if (hardware.inertNozzle) {
        ctx.fillStyle = '#3F3F46';
        ctx.fillRect(nozzleX - 5, ductTop, 10, 10);
        ctx.fillStyle = '#A1A1AA';
        ctx.fillRect(nozzleX - 3, ductTop + 10, 6, 4);
        ctx.strokeStyle = '#71717A';
        ctx.lineWidth = 1;
        ctx.strokeRect(nozzleX - 5, ductTop, 10, 10);

        if (n2DischargeActive) {
          ctx.save();
          const coneGrad = ctx.createLinearGradient(nozzleX, ductTop + 14, nozzleX, ductBottom - 10);
          coneGrad.addColorStop(0, 'rgba(165, 243, 252, 0.45)');
          coneGrad.addColorStop(0.55, 'rgba(103, 232, 249, 0.22)');
          coneGrad.addColorStop(1, 'rgba(103, 232, 249, 0)');
          ctx.fillStyle = coneGrad;
          ctx.beginPath();
          ctx.moveTo(nozzleX - 3, ductTop + 14);
          ctx.lineTo(nozzleX + 3, ductTop + 14);
          ctx.lineTo(nozzleX + 46, ductBottom - 8);
          ctx.lineTo(nozzleX - 34, ductBottom - 8);
          ctx.closePath();
          ctx.fill();

          ctx.strokeStyle = 'rgba(165, 243, 252, 0.55)';
          ctx.lineWidth = 1;
          for (let j = -2; j <= 2; j++) {
            const prog = (simTime * 3.4 + (j + 2) * 0.21) % 1;
            const sy = ductTop + 16 + prog * (ductHalfH * 1.65);
            const sx = nozzleX + j * (5 + prog * 13);
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(sx + j * 1.4, sy + 11);
            ctx.stroke();
          }
          ctx.restore();
        }
      }

      // 6d. Specimen Geometry & Clamps
      const matBaseColor =
        s.params.materialId === 'pmma'
          ? '#52525B'
          : s.params.materialId === 'nomex'
            ? '#5D614D'
            : '#71717A';
      const limitFrac = NASA_STD_BURN_LIMIT_MM / SPECIMEN_LENGTH_MM;
      const limitX = isConcurrent ? sampleX + sampleLen * limitFrac : sampleX + sampleLen * (1 - limitFrac);
      const ignTipPx = chamberState === 'IGNITING' ? 4 + pyrolysisFactor * 7 : 0;
      const charW = clamp(Math.max(ignTipPx, sampleLen * burnFrac), 0, sampleLen);

      if (geometry === 'droplet') {
        // Suspended Droplet (FLEX): quartz cross-fiber + liquid spherical fuel droplet
        ctx.strokeStyle = '#A1A1AA';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(dropletCenterX, ductTop + 6);
        ctx.lineTo(dropletCenterX, ductBottom - 6);
        ctx.moveTo(dropletCenterX - 30, sampleY + 12);
        ctx.lineTo(dropletCenterX + 30, sampleY - 12);
        ctx.stroke();

        const dropR = clamp(8.8 * (1 - 0.55 * burnFrac), 3.4, 9.0);
        const dropGrad = ctx.createRadialGradient(
          dropletCenterX - dropR * 0.3,
          sampleY - dropR * 0.3,
          1,
          dropletCenterX,
          sampleY,
          dropR,
        );
        dropGrad.addColorStop(0, '#E4E4E7');
        dropGrad.addColorStop(0.55, matBaseColor);
        dropGrad.addColorStop(1, '#18181B');
        ctx.fillStyle = dropGrad;
        ctx.beginPath();
        ctx.arc(dropletCenterX, sampleY, dropR, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = displayFlameScale > 0.05 ? '#FCD34D' : '#A1A1AA';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else if (geometry === 'channel') {
        // Parallel Avionics Channel: twin parallel fuel plates separated by 20 mm gap
        ctx.fillStyle = '#27272A';
        ctx.fillRect(sampleX + sampleLen * 0.5 - 3, sampleY + channelHalfGapPx + 4, 6, ductBottom - (sampleY + channelHalfGapPx + 4));

        const clampGrad = ctx.createLinearGradient(0, sampleY - channelHalfGapPx - 8, 0, sampleY + channelHalfGapPx + 8);
        clampGrad.addColorStop(0, '#52525B');
        clampGrad.addColorStop(1, '#27272A');
        ctx.fillStyle = clampGrad;
        ctx.fillRect(clampLeftX, sampleY - channelHalfGapPx - 7, clampJawW, channelHalfGapPx * 2 + 14);
        ctx.fillRect(sampleX + sampleLen, sampleY - channelHalfGapPx - 7, clampJawW, channelHalfGapPx * 2 + 14);
        ctx.strokeStyle = '#71717A';
        ctx.lineWidth = 1;
        ctx.strokeRect(clampLeftX, sampleY - channelHalfGapPx - 7, clampJawW, channelHalfGapPx * 2 + 14);
        ctx.strokeRect(sampleX + sampleLen, sampleY - channelHalfGapPx - 7, clampJawW, channelHalfGapPx * 2 + 14);

        for (const plateY of [sampleY - channelHalfGapPx, sampleY + channelHalfGapPx]) {
          ctx.fillStyle = matBaseColor;
          ctx.fillRect(sampleX, plateY - 3.5, sampleLen, 7);
          ctx.strokeStyle = '#A1A1AA';
          ctx.strokeRect(sampleX, plateY - 3.5, sampleLen, 7);

          if (charW > 0.5) {
            const charStartX = isConcurrent ? sampleX : sampleX + sampleLen - charW;
            ctx.fillStyle = mat.charForming ? '#111115' : '#1E1E24';
            ctx.fillRect(charStartX, plateY - 3, charW, 6);
            if ((displayFlameScale > 0.02 || chamberState === 'IGNITING') && charW < sampleLen - 0.5) {
              const frontX = isConcurrent ? charStartX + charW : charStartX;
              ctx.strokeStyle =
                burnLengthMm > NASA_STD_BURN_LIMIT_MM ? 'rgba(253, 164, 175, 0.95)' : 'rgba(252, 211, 77, 0.95)';
              ctx.lineWidth = 1.6;
              ctx.beginPath();
              ctx.moveTo(frontX, plateY - 3.5);
              ctx.lineTo(frontX, plateY + 3.5);
              ctx.stroke();
            }
          }
        }
      } else {
        // Cylindrical Rod (BASS-II) or Thin Sheet (Saffire-II)
        ctx.fillStyle = '#27272A';
        ctx.fillRect(sampleX + sampleLen * 0.5 - 3, sampleY + 5, 6, ductBottom - sampleY - 5);

        if (geometry === 'sheet') {
          // Saffire-II dual-rail outer clamping frame
          ctx.strokeStyle = '#52525B';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(clampLeftX, sampleY - 11);
          ctx.lineTo(sampleX + sampleLen + clampJawW, sampleY - 11);
          ctx.moveTo(clampLeftX, sampleY + 11);
          ctx.lineTo(sampleX + sampleLen + clampJawW, sampleY + 11);
          ctx.stroke();
        }

        const clampGrad = ctx.createLinearGradient(0, sampleY - 9, 0, sampleY + 9);
        clampGrad.addColorStop(0, '#52525B');
        clampGrad.addColorStop(0.5, '#3F3F46');
        clampGrad.addColorStop(1, '#27272A');
        ctx.fillStyle = clampGrad;
        ctx.fillRect(clampLeftX, sampleY - 8, clampJawW, 16);
        ctx.fillRect(sampleX + sampleLen, sampleY - 8, clampJawW, 16);
        ctx.strokeStyle = '#71717A';
        ctx.lineWidth = 1;
        ctx.strokeRect(clampLeftX, sampleY - 8, clampJawW, 16);
        ctx.strokeRect(sampleX + sampleLen, sampleY - 8, clampJawW, 16);

        ctx.fillStyle = '#A1A1AA';
        ctx.beginPath();
        ctx.arc(clampLeftX + clampJawW * 0.5, sampleY, 2, 0, Math.PI * 2);
        ctx.arc(sampleX + sampleLen + clampJawW * 0.5, sampleY, 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = matBaseColor;
        ctx.fillRect(sampleX, sampleY - sampleThick / 2, sampleLen, sampleThick);
        ctx.strokeStyle = '#A1A1AA';
        ctx.lineWidth = 1;
        ctx.strokeRect(sampleX, sampleY - sampleThick / 2, sampleLen, sampleThick);

        ctx.strokeStyle = 'rgba(253, 164, 175, 0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(limitX, sampleY - sampleThick / 2 - 2);
        ctx.lineTo(limitX, sampleY + sampleThick / 2 + 2);
        ctx.stroke();

        if (charW > 0.5) {
          const charStartX = isConcurrent ? sampleX : sampleX + sampleLen - charW;
          ctx.fillStyle = mat.charForming ? '#111115' : '#1E1E24';
          ctx.fillRect(charStartX, sampleY - sampleThick / 2 + 0.5, charW, sampleThick - 1);

          ctx.strokeStyle = 'rgba(82, 82, 91, 0.55)';
          ctx.lineWidth = 0.8;
          for (let sx = charStartX + 3; sx < charStartX + charW - 2; sx += 4) {
            ctx.beginPath();
            ctx.moveTo(sx, sampleY - sampleThick / 2 + 1);
            ctx.lineTo(sx + 1.5, sampleY + sampleThick / 2 - 1);
            ctx.stroke();
          }

          if ((displayFlameScale > 0.02 || chamberState === 'IGNITING') && charW < sampleLen - 0.5) {
            const frontX = isConcurrent ? charStartX + charW : charStartX;
            ctx.strokeStyle =
              burnLengthMm > NASA_STD_BURN_LIMIT_MM ? 'rgba(253, 164, 175, 0.95)' : 'rgba(252, 211, 77, 0.95)';
            ctx.lineWidth = 1.75;
            ctx.beginPath();
            ctx.moveTo(frontX, sampleY - sampleThick / 2);
            ctx.lineTo(frontX, sampleY + sampleThick / 2);
            ctx.stroke();
          }
        }
      }

      // Helical Nichrome Hot-Wire Igniter Coil + Thermal Pulse Ripples
      const coilX =
        geometry === 'droplet'
          ? dropletCenterX + 12
          : isConcurrent
            ? sampleX + 8
            : sampleX + sampleLen - 8;
      const coilIntensity = igniterPowerW > 0 ? Math.min(1, igniterPowerW / 80) : 0;
      if (coilIntensity > 0.02) {
        for (let ring = 0; ring < 2; ring++) {
          const prog = (simTime * 0.85 + ring * 0.5) % 1;
          const rRipple = 8 + prog * 36;
          ctx.strokeStyle = `rgba(252, 211, 77, ${((1 - prog) * 0.55 * coilIntensity).toFixed(2)})`;
          ctx.lineWidth = 1.25;
          ctx.beginPath();
          ctx.arc(coilX, sampleY, rRipple, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      const coilGlow = coilIntensity > 0.05;
      ctx.strokeStyle = coilGlow
        ? `rgba(254, 243, 199, ${0.55 + coilIntensity * 0.45})`
        : '#71717A';
      ctx.lineWidth = coilGlow ? 2.3 : 1.3;
      for (let loop = -1; loop <= 1; loop++) {
        ctx.beginPath();
        ctx.ellipse(coilX + loop * 3.2, sampleY, 2.1, 8.2, 0.2, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 7. Honeycomb Flow-Straightener Mesh (Inlet)
      ctx.fillStyle = '#141418';
      ctx.fillRect(ductLeft, ductTop, straightenerW, ductHalfH * 2);
      ctx.strokeStyle = '#3F3F46';
      ctx.lineWidth = 1;
      for (let y = ductTop + 5; y < ductBottom - 3; y += 7) {
        ctx.beginPath();
        ctx.moveTo(ductLeft, y);
        ctx.lineTo(ductLeft + straightenerW, y);
        ctx.stroke();
      }
      for (let x = ductLeft + 6; x < ductLeft + straightenerW; x += 6) {
        ctx.beginPath();
        ctx.moveTo(x, ductTop);
        ctx.lineTo(x, ductBottom);
        ctx.stroke();
      }
      ctx.strokeStyle = '#52525B';
      ctx.strokeRect(ductLeft, ductTop, straightenerW, ductHalfH * 2);

      // 8. Brushed Metallic Duct Walls + Bolted Flanges + Quartz Observation Window & mm Scale Ticks
      const wallGradTop = ctx.createLinearGradient(0, ductTop - 12, 0, ductTop);
      wallGradTop.addColorStop(0, '#27272A');
      wallGradTop.addColorStop(0.5, '#3F3F46');
      wallGradTop.addColorStop(1, '#18181B');
      ctx.fillStyle = wallGradTop;
      ctx.fillRect(ductLeft, ductTop - 12, ductWidth, 12);

      const wallGradBot = ctx.createLinearGradient(0, ductBottom, 0, ductBottom + 12);
      wallGradBot.addColorStop(0, '#18181B');
      wallGradBot.addColorStop(0.5, '#3F3F46');
      wallGradBot.addColorStop(1, '#27272A');
      ctx.fillStyle = wallGradBot;
      ctx.fillRect(ductLeft, ductBottom, ductWidth, 12);

      ctx.strokeStyle = '#52525B';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(chamberLeft, ductTop, chamberWidth, ductHalfH * 2);

      for (let bx = ductLeft + 18; bx < ductRight - 10; bx += 54) {
        ctx.fillStyle = '#52525B';
        ctx.fillRect(bx - 3, ductTop - 15, 6, 3);
        ctx.fillRect(bx - 3, ductBottom + 12, 6, 3);
        ctx.fillStyle = '#A1A1AA';
        ctx.beginPath();
        ctx.arc(bx, ductTop - 6, 1.8, 0, Math.PI * 2);
        ctx.arc(bx, ductBottom + 6, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.strokeStyle = '#71717A';
      ctx.fillStyle = '#71717A';
      ctx.font = '9px "JetBrains Mono Variable", monospace';
      const numTicks = 18;
      for (let i = 0; i <= numTicks; i++) {
        const tx = chamberLeft + (chamberWidth * i) / numTicks;
        const isMajor = i % 2 === 0;
        const tickLen = isMajor ? 6 : 3;
        ctx.beginPath();
        ctx.moveTo(tx, ductTop);
        ctx.lineTo(tx, ductTop + tickLen);
        ctx.moveTo(tx, ductBottom);
        ctx.lineTo(tx, ductBottom - tickLen);
        ctx.stroke();

        if (isMajor && i > 0 && i < numTicks) {
          const mmLabel = `${Math.round((i / numTicks) * 450)}`;
          ctx.fillText(mmLabel, tx - 7, ductTop + 15);
        }
      }

      // 9. Thermocouple Probe Array (TC-1 to TC-6 driven by first-order thermal lag telemetry)
      if (s.showThermocouples) {
        const isNarrow = chamberWidth < 380;

        ctx.font = isNarrow
          ? '8.5px "JetBrains Mono Variable", monospace'
          : '10px "JetBrains Mono Variable", monospace';
        for (let idx = 0; idx < THERMOCOUPLE_ARRAY_SPECS.length; idx++) {
          const tc = THERMOCOUPLE_ARRAY_SPECS[idx];
          const tx = chamberLeft + tc.xFrac * chamberWidth;
          const ty = ductCenterY + tc.yFrac * ductHalfH;
          const localTempK = thermocoupleTempsK[idx] ?? AMBIENT_CHAMBER_TEMP_K;
          const tempFmt = formatTemperature(localTempK, s.unitSystem);
          const label = isNarrow
            ? `${tc.id} ${tempFmt.text}°`
            : `${tc.id} ${tempFmt.text}${tempFmt.unit}`;

          ctx.fillStyle = localTempK > 700 ? '#FDA4AF' : localTempK > 420 ? '#FCD34D' : '#67E8F9';
          ctx.beginPath();
          ctx.arc(tx, ty, 3, 0, Math.PI * 2);
          ctx.fill();

          const labelW = ctx.measureText(label).width + 6;
          const labelX = tx + 5 + labelW > ductRight - 4 ? tx - labelW - 5 : tx + 5;
          ctx.fillStyle = 'rgba(9, 9, 11, 0.85)';
          ctx.fillRect(labelX, ty - 12, labelW, 12);
          ctx.fillStyle = '#E4E4E7';
          ctx.fillText(label, labelX + 3, ty - 2.5);
        }
      }

      // 10. CAD Pinned Probes (P-n), Caliper Spans (D-n), and Live Crosshair Reticle
      const mmToPx = (xMm: number, yMm: number) => ({
        x: chamberLeft + (clamp(xMm, 0, DUCT_LENGTH_MM) / DUCT_LENGTH_MM) * chamberWidth,
        y: ductCenterY - (clamp(yMm, -DUCT_HALF_HEIGHT_MM, DUCT_HALF_HEIGHT_MM) / DUCT_HALF_HEIGHT_MM) * ductHalfH,
      });

      for (const marker of s.markers) {
        if (marker.kind === 'point') {
          const p = mmToPx(marker.xMm, marker.yMm);
          ctx.strokeStyle = 'rgba(103, 232, 249, 0.9)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
          ctx.moveTo(p.x - 9, p.y);
          ctx.lineTo(p.x + 9, p.y);
          ctx.moveTo(p.x, p.y - 9);
          ctx.lineTo(p.x, p.y + 9);
          ctx.stroke();

          ctx.fillStyle = '#67E8F9';
          ctx.beginPath();
          ctx.arc(p.x, p.y, 1.8, 0, Math.PI * 2);
          ctx.fill();

          const sampled = sampleDuctFieldAtMm(marker.xMm, marker.yMm, s.params, s.telemetry);
          const tFmt = formatTemperature(sampled.localTempK, s.unitSystem);
          const tag = `${marker.id} ${tFmt.text}${tFmt.unit}`;
          ctx.font = '9.5px "JetBrains Mono Variable", monospace';
          const tagW = ctx.measureText(tag).width + 8;
          const tagX = p.x + 8 + tagW > ductRight - 4 ? p.x - tagW - 8 : p.x + 8;
          const tagY = p.y - 14 < ductTop + 4 ? p.y + 12 : p.y - 7;
          ctx.fillStyle = 'rgba(9, 9, 11, 0.9)';
          ctx.fillRect(tagX, tagY - 9, tagW, 13);
          ctx.strokeStyle = 'rgba(103, 232, 249, 0.45)';
          ctx.lineWidth = 0.8;
          ctx.strokeRect(tagX, tagY - 9, tagW, 13);
          ctx.fillStyle = '#F4F4F5';
          ctx.fillText(tag, tagX + 4, tagY + 1);
        } else {
          const p1 = mmToPx(marker.x1Mm, marker.y1Mm);
          const p2 = mmToPx(marker.x2Mm, marker.y2Mm);
          const span = measureCaliperMm(marker);

          ctx.strokeStyle = 'rgba(252, 211, 77, 0.88)';
          ctx.lineWidth = 1.25;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
          ctx.setLineDash([]);

          for (const endPt of [p1, p2]) {
            ctx.fillStyle = '#FCD34D';
            ctx.beginPath();
            ctx.arc(endPt.x, endPt.y, 2.5, 0, Math.PI * 2);
            ctx.fill();
          }

          const midX = (p1.x + p2.x) * 0.5;
          const midY = (p1.y + p2.y) * 0.5;
          const calTag = `${marker.id} ${span.distanceMm.toFixed(1)}mm`;
          ctx.font = '9.5px "JetBrains Mono Variable", monospace';
          const calW = ctx.measureText(calTag).width + 8;
          const boxX = clamp(midX - calW * 0.5, chamberLeft + 4, ductRight - calW - 4);
          const boxY = clamp(midY - 14, ductTop + 4, ductBottom - 16);
          ctx.fillStyle = 'rgba(9, 9, 11, 0.92)';
          ctx.fillRect(boxX, boxY, calW, 13);
          ctx.strokeStyle = 'rgba(252, 211, 77, 0.5)';
          ctx.lineWidth = 0.8;
          ctx.strokeRect(boxX, boxY, calW, 13);
          ctx.fillStyle = '#FCD34D';
          ctx.fillText(calTag, boxX + 4, boxY + 9.5);
        }
      }

      if (s.pendingCaliperStart) {
        const ps = mmToPx(s.pendingCaliperStart.xMm, s.pendingCaliperStart.yMm);
        ctx.fillStyle = '#FCD34D';
        ctx.beginPath();
        ctx.arc(ps.x, ps.y, 3.5, 0, Math.PI * 2);
        ctx.fill();

        if (hoverRef.current.active) {
          const pe = mmToPx(hoverRef.current.xMm, hoverRef.current.yMm);
          ctx.strokeStyle = 'rgba(252, 211, 77, 0.72)';
          ctx.lineWidth = 1.1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(ps.x, ps.y);
          ctx.lineTo(pe.x, pe.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      if (s.showCrosshair && hoverRef.current.active) {
        const hp = mmToPx(hoverRef.current.xMm, hoverRef.current.yMm);
        ctx.save();
        ctx.beginPath();
        ctx.rect(chamberLeft, ductTop + 1, chamberWidth, ductHalfH * 2 - 2);
        ctx.clip();

        ctx.strokeStyle = 'rgba(244, 244, 245, 0.22)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 4]);
        ctx.beginPath();
        ctx.moveTo(chamberLeft, hp.y);
        ctx.lineTo(ductRight, hp.y);
        ctx.moveTo(hp.x, ductTop);
        ctx.lineTo(hp.x, ductBottom);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.strokeStyle = s.cadTool === 'caliper' ? '#FCD34D' : '#67E8F9';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.arc(hp.x, hp.y, 5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // Rig caption above top rail (positioned cleanly on left so top-right probe pill never collides)
      ctx.fillStyle = '#71717A';
      ctx.font = width < 520 ? '9px "JetBrains Mono Variable", monospace' : '10px "JetBrains Mono Variable", monospace';
      const rigLabel =
        width < 560
          ? `SAFFIRE/BASS 450mm · ${chamberState}`
          : `SAFFIRE-II / BASS-II RIG · QUARTZ DUCT 450 mm · ${s.params.flowMode.toUpperCase()} · ${chamberState}`;
      ctx.fillText(rigLabel, ductLeft, ductTop - 19);

      ctx.restore();

      if (s.isPlaying) {
        scheduleRender();
      }
    };

    scheduleRender = () => {
      if (rafId === 0) {
        rafId = window.requestAnimationFrame(renderFrame);
      }
    };
    scheduleRenderRef.current = scheduleRender;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(300, Math.floor(rect.width));
      const h = Math.max(180, Math.floor(rect.height));
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        dirtyRef.current = true;
        scheduleRender();
      }
    };

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    scheduleRender();
    return () => {
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId);
      }
      scheduleRenderRef.current = () => {};
      observer.disconnect();
    };
  }, []);

  const pointerToDuctMm = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const pxX = clientX - rect.left;
    const pxY = clientY - rect.top;

    const sidePad = isFullscreen ? Math.max(32, rect.width * 0.05) : Math.max(14, rect.width * 0.025);
    const topBarPad = isFullscreen ? 42 : 38;
    const dockPad = isFullscreen ? 84 : 18;

    const ductLeft = sidePad;
    const ductRight = Math.max(sidePad + 240, rect.width - sidePad);
    const ductWidth = ductRight - ductLeft;
    const chamberLeft = ductLeft + 24;
    const chamberWidth = Math.max(120, ductWidth - 24);
    const availH = Math.max(140, rect.height - topBarPad - dockPad);
    const ductCenterY = topBarPad + availH * 0.5;
    const ductHalfH = Math.min(availH * 0.42, 154);

    const xNorm = clamp((pxX - chamberLeft) / chamberWidth, 0, 1);
    const yNorm = clamp((pxY - ductCenterY) / Math.max(1, ductHalfH), -1, 1);

    return {
      xMm: xNorm * DUCT_LENGTH_MM,
      yMm: -yNorm * DUCT_HALF_HEIGHT_MM,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pt = pointerToDuctMm(e.clientX, e.clientY);
    if (!pt) return;
    hoverRef.current = { active: true, xMm: pt.xMm, yMm: pt.yMm };
    const sampled = sampleDuctFieldAtMm(pt.xMm, pt.yMm, params, telemetry);
    setProbe({
      active: true,
      xMm: sampled.xMm,
      yMm: sampled.yMm,
      localTempK: sampled.localTempK,
      localVelMs: sampled.localVelMs,
    });
    dirtyRef.current = true;
    scheduleRenderRef.current();
  };

  const handlePointerLeave = () => {
    hoverRef.current = { ...hoverRef.current, active: false };
    setProbe((p) => ({ ...p, active: false }));
    dirtyRef.current = true;
    scheduleRenderRef.current();
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pt = pointerToDuctMm(e.clientX, e.clientY);
    if (!pt) return;
    onDropMarkerPoint(pt.xMm, pt.yMm);
  };

  const probeTempFmt = formatTemperature(probe.localTempK, unitSystem);
  const probeVelFmt = formatVelocity(probe.localVelMs, unitSystem);
  const currentVelFmt = formatVelocity(params.flowVelocityMs, unitSystem);
  const currentGravFmt = formatGravity(params.gravityMs2, unitSystem);

  return (
    <div
      ref={containerRef}
      className={
        isFullscreen
          ? 'fixed inset-0 z-40 h-screen w-screen overflow-hidden bg-[#09090B]'
          : 'relative h-full w-full overflow-hidden bg-[#09090B]'
      }
    >
      <canvas
        ref={canvasRef}
        data-testid="combustion-duct-canvas"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onClick={handleCanvasClick}
        className={`block h-full w-full ${showCrosshair ? 'cursor-crosshair' : 'cursor-pointer'}`}
      />

      {/* Minimal Monochrome Probe Telemetry Badge */}
      <div
        className={`pointer-events-none absolute rounded-full border border-[#27272A] bg-[#111114]/90 px-2.5 py-0.5 font-mono text-[10px] tabular-nums backdrop-blur-md whitespace-nowrap ${
          isFullscreen ? 'top-4 left-4' : 'top-1.5 right-3'
        } ${probe.active ? 'text-[#F4F4F5]' : 'text-[#71717A]'}`}
      >
        {probe.active ? (
          <span>
            {cadTool === 'caliper' ? 'CALIPER' : 'PROBE'} X={probe.xMm.toFixed(0)}mm Y={probe.yMm.toFixed(0)}mm · T={probeTempFmt.text}
            {probeTempFmt.unit} · V={probeVelFmt.text} {probeVelFmt.unit}
          </span>
        ) : (
          <span>
            g={currentGravFmt.text} {currentGravFmt.unit} · V={currentVelFmt.text}{' '}
            {currentVelFmt.unit}
            <span className="hidden sm:inline">
              {' '}
              · {cadTool === 'caliper' ? 'Click 2 points to measure' : 'Click duct to pin probe'}
            </span>
          </span>
        )}
      </div>
    </div>
  );
};
