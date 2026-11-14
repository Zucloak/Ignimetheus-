import {
  AMBIENT_CHAMBER_TEMP_K,
  type SimulationParams,
  type ThermoTelemetry,
} from './thermoCore';

export const DUCT_LENGTH_MM = 450;
export const DUCT_HALF_HEIGHT_MM = 75;

export interface ThermocoupleSpec {
  id: 'TC-1' | 'TC-2' | 'TC-3' | 'TC-4' | 'TC-5' | 'TC-6';
  axialMm: number;
  xFrac: number;
  yFrac: number;
  zoneLabel: string;
}

export const THERMOCOUPLE_ARRAY_SPECS: ThermocoupleSpec[] = [
  { id: 'TC-1', axialMm: 162, xFrac: 0.36, yFrac: 0.34, zoneLabel: 'Ignitor Edge' },
  { id: 'TC-2', axialMm: 202, xFrac: 0.45, yFrac: -0.46, zoneLabel: 'Leading Wake' },
  { id: 'TC-3', axialMm: 248, xFrac: 0.55, yFrac: 0.42, zoneLabel: 'Flame Core' },
  { id: 'TC-4', axialMm: 292, xFrac: 0.65, yFrac: -0.62, zoneLabel: 'Mid Plume' },
  { id: 'TC-5', axialMm: 338, xFrac: 0.75, yFrac: 0.62, zoneLabel: 'Downstream' },
  { id: 'TC-6', axialMm: 382, xFrac: 0.85, yFrac: -0.34, zoneLabel: 'Duct Exhaust' },
];

export type CadToolMode = 'probe' | 'caliper';

export interface CadProbeMarker {
  kind: 'point';
  id: string; // e.g. 'P-1', 'P-2'
  xMm: number; // 0..450
  yMm: number; // -75..75 (0 = centerline, + = above centerline in CAD coords)
}

export interface CadCaliperMarker {
  kind: 'caliper';
  id: string; // e.g. 'D-1'
  x1Mm: number;
  y1Mm: number;
  x2Mm: number;
  y2Mm: number;
}

export type CadMarker = CadProbeMarker | CadCaliperMarker;

export interface SampledDuctPoint {
  xMm: number;
  yMm: number;
  localTempK: number;
  localVelMs: number;
}

export interface MeasuredCaliperSpan {
  dxMm: number;
  dyMm: number;
  distanceMm: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Pure thermo-fluids field sampler at arbitrary (xMm, yMm) duct coordinates.
 * Matches the quartz duct Poiseuille velocity profile and Gaussian thermal plume field.
 */
export function sampleDuctFieldAtMm(
  xMm: number,
  yMm: number,
  params: SimulationParams,
  telemetry: ThermoTelemetry,
): SampledDuctPoint {
  const safeX = clamp(xMm, 0, DUCT_LENGTH_MM);
  const safeY = clamp(yMm, -DUCT_HALF_HEIGHT_MM, DUCT_HALF_HEIGHT_MM);

  const xNorm = safeX / DUCT_LENGTH_MM;
  // yNorm in -1..1 (canvas draws +y downward, CAD yMm is + upward from centerline)
  const yNorm = -safeY / DUCT_HALF_HEIGHT_MM;

  const parabolic = Math.max(0.24, 1 - yNorm * yNorm * 0.72);
  const localVelMs = params.flowVelocityMs * 1.25 * parabolic;

  const flameCenterXNorm = params.flowMode === 'concurrent' ? 0.40 : 0.48;
  const flameCenterYNorm = params.gravityMs2 > 1 ? -0.32 : 0;
  const dx = (xNorm - flameCenterXNorm) / 0.16;
  const dy = (yNorm - flameCenterYNorm) / 0.32;
  const gaussian = Math.exp(-(dx * dx + dy * dy));

  const hotPeakK = Math.max(telemetry.peakFlameTempK, telemetry.thermocoupleTempsK[0]);
  const isColdStandby =
    telemetry.chamberState === 'STANDBY' &&
    telemetry.flameScale < 0.01 &&
    telemetry.thermocoupleTempsK[0] <= AMBIENT_CHAMBER_TEMP_K + 1;

  const localTempK = isColdStandby
    ? AMBIENT_CHAMBER_TEMP_K
    : AMBIENT_CHAMBER_TEMP_K + (hotPeakK - AMBIENT_CHAMBER_TEMP_K) * gaussian;

  return {
    xMm: safeX,
    yMm: safeY,
    localTempK,
    localVelMs,
  };
}

export function measureCaliperMm(caliper: CadCaliperMarker): MeasuredCaliperSpan {
  const dxMm = caliper.x2Mm - caliper.x1Mm;
  const dyMm = caliper.y2Mm - caliper.y1Mm;
  return {
    dxMm,
    dyMm,
    distanceMm: Math.hypot(dxMm, dyMm),
  };
}

export function nextMarkerId(markers: CadMarker[], kind: 'point' | 'caliper'): string {
  const prefix = kind === 'point' ? 'P-' : 'D-';
  let maxN = 0;
  for (const m of markers) {
    if (m.id.startsWith(prefix)) {
      const n = Number(m.id.slice(prefix.length));
      if (Number.isInteger(n) && n > maxN) {
        maxN = n;
      }
    }
  }
  return `${prefix}${maxN + 1}`;
}

export function getInitialCadMarkers(): CadMarker[] {
  return [
    {
      kind: 'point',
      id: 'P-1',
      xMm: 216,
      yMm: 0,
    },
  ];
}
