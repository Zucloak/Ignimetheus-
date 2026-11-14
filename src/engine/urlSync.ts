import {
  MATERIALS,
  MISSION_PRESETS,
  SPECIMEN_GEOMETRIES,
  type FlowMode,
  type MaterialId,
  type SimulationParams,
  type SpecimenGeometry,
} from './thermoCore';
import { STANDARD_GRAVITY_MS2, UNIT_SYSTEMS, type UnitSystem } from './units';

export interface UrlSyncState {
  params: SimulationParams;
  unitSystem: UnitSystem;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function parseStateFromSearch(search: string): UrlSyncState {
  const defaultState: UrlSyncState = {
    params: { ...MISSION_PRESETS[0].params },
    unitSystem: 'nasa-psi',
  };

  if (!search) return defaultState;
  const q = new URLSearchParams(search);

  const o2Raw = Number(q.get('o2'));
  const pRaw = Number(q.get('p'));
  const vRaw = Number(q.get('v'));
  const gRaw = Number(q.get('g'));
  const matRaw = q.get('mat') as MaterialId | null;
  const flowRaw = q.get('flow') as FlowMode | null;
  const geomRaw = q.get('geom') as SpecimenGeometry | null;
  const unitRaw = q.get('u') as UnitSystem | null;

  const hasHardware = q.has('baffle') || q.has('arrestor') || q.has('nozzle');

  const params: SimulationParams = {
    o2Percent: Number.isFinite(o2Raw) && q.has('o2') ? clamp(o2Raw, 12, 40) : defaultState.params.o2Percent,
    pressurePa: Number.isFinite(pRaw) && q.has('p') ? clamp(pRaw, 40000, 110000) : defaultState.params.pressurePa,
    flowVelocityMs: Number.isFinite(vRaw) && q.has('v') ? clamp(vRaw, 0, 0.5) : defaultState.params.flowVelocityMs,
    gravityMs2:
      Number.isFinite(gRaw) && q.has('g')
        ? clamp(gRaw, 0, 2 * STANDARD_GRAVITY_MS2)
        : defaultState.params.gravityMs2,
    materialId: matRaw && matRaw in MATERIALS ? matRaw : defaultState.params.materialId,
    flowMode: flowRaw === 'opposed' || flowRaw === 'concurrent' ? flowRaw : defaultState.params.flowMode,
    ...(geomRaw && geomRaw in SPECIMEN_GEOMETRIES ? { specimenGeometry: geomRaw } : {}),
    ...(hasHardware
      ? {
          hardware: {
            wakeBaffle: q.get('baffle') === '1',
            flameArrestor: q.get('arrestor') === '1',
            inertNozzle: q.get('nozzle') === '1',
          },
        }
      : {}),
  };

  const validUnit = UNIT_SYSTEMS.some((u) => u.id === unitRaw);
  const unitSystem: UnitSystem = validUnit && unitRaw ? unitRaw : defaultState.unitSystem;

  return { params, unitSystem };
}

export function serializeStateToSearch(params: SimulationParams, unitSystem: UnitSystem): string {
  const q = new URLSearchParams();
  q.set('o2', params.o2Percent.toFixed(1));
  q.set('p', Math.round(params.pressurePa).toString());
  q.set('v', params.flowVelocityMs.toFixed(3));
  q.set('g', params.gravityMs2.toFixed(4));
  q.set('mat', params.materialId);
  q.set('flow', params.flowMode);
  if (params.specimenGeometry && params.specimenGeometry !== 'rod') {
    q.set('geom', params.specimenGeometry);
  }
  if (params.hardware?.wakeBaffle) q.set('baffle', '1');
  if (params.hardware?.flameArrestor) q.set('arrestor', '1');
  if (params.hardware?.inertNozzle) q.set('nozzle', '1');
  q.set('u', unitSystem);
  return `?${q.toString()}`;
}
