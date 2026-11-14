import { STANDARD_ATM_PA, STANDARD_GRAVITY_MS2 } from './units';

export type MaterialId = 'pmma' | 'nomex' | 'silicone' | 'cellulose';
export type FlowMode = 'opposed' | 'concurrent';
export type SpecimenGeometry = 'rod' | 'sheet' | 'channel' | 'droplet';
export type DuctScale = 'msg-12cm' | 'saffire-40cm';

export interface DuctScaleSpec {
  id: DuctScale;
  label: string;
  shortLabel: string;
  hydraulicDiameterM: number;
  wallLossSpreadFactor: number;
}

export const DUCT_SCALES: Record<DuctScale, DuctScaleSpec> = {
  'msg-12cm': {
    id: 'msg-12cm',
    label: '12 cm MSG Wind Tunnel (Dh = 120 mm)',
    shortLabel: '12 cm MSG',
    hydraulicDiameterM: 0.12,
    wallLossSpreadFactor: 1.0,
  },
  'saffire-40cm': {
    id: 'saffire-40cm',
    label: '40 cm Cygnus Saffire Duct (Dh = 400 mm)',
    shortLabel: '40 cm Saffire',
    hydraulicDiameterM: 0.4,
    wallLossSpreadFactor: 0.88,
  },
};

export interface DuctHardwareConfig {
  wakeBaffle: boolean;
  flameArrestor: boolean;
  inertNozzle: boolean;
}

export const DEFAULT_DUCT_HARDWARE: DuctHardwareConfig = {
  wakeBaffle: false,
  flameArrestor: false,
  inertNozzle: false,
};

export interface SpecimenGeometrySpec {
  id: SpecimenGeometry;
  label: string;
  shortLabel: string;
  programRef: string;
  description: string;
}

export const SPECIMEN_GEOMETRIES: Record<SpecimenGeometry, SpecimenGeometrySpec> = {
  rod: {
    id: 'rod',
    label: 'Cylindrical Rod (BASS-II)',
    shortLabel: 'Cylindrical Rod',
    programRef: 'BASS-II',
    description: 'Central cylindrical fuel rod with helical nichrome igniter at leading edge.',
  },
  sheet: {
    id: 'sheet',
    label: 'Thin Sheet (Saffire-II)',
    shortLabel: 'Thin Sheet',
    programRef: 'Saffire-II',
    description: 'Dual-rail clamped thin film/fabric strip with symmetric upper/lower flame fronts.',
  },
  channel: {
    id: 'channel',
    label: 'Parallel Avionics Channel',
    shortLabel: 'Avionics Channel',
    programRef: 'Avionics Gap',
    description: 'Opposing fuel walls separated by a 20 mm air gap with radiative view-factor trapping.',
  },
  droplet: {
    id: 'droplet',
    label: 'Suspended Droplet (FLEX)',
    shortLabel: 'Suspended Droplet',
    programRef: 'FLEX',
    description: 'Liquid fuel droplet suspended on quartz cross-fiber with concentric cool-flame halo.',
  },
};

export const FLAME_ARRESTOR_X_MM = 280;
export const WAKE_BAFFLE_X_MM = 95;
export const INERT_NOZZLE_X_MM = 160;
export const N2_DISCHARGE_DURATION_S = 5.0;
export const N2_O2_DROP_PERCENT = 8.0;

export type ExtinctionRegime =
  | 'Quenched'
  | 'Radiative Spherical'
  | 'Ventilation-Driven Spread'
  | 'Critical Runaway'
  | 'Blow-Off Extinction';

export type ChamberCombustionState =
  | 'STANDBY'
  | 'IGNITING'
  | 'SUSTAINED_BURN'
  | 'SELF_EXTINGUISHED';

export type TestDurationMode = number | 'Continuous';

export const TEST_DURATION_OPTIONS: Array<{
  value: TestDurationMode;
  label: string;
}> = [
  { value: 30, label: '30s' },
  { value: 60, label: '60s' },
  { value: 180, label: '180s' },
  { value: 'Continuous', label: 'Loop' },
];

export const CUSTOM_DURATION_PRESETS: Array<{
  value: number;
  label: string;
}> = [
  { value: 2.2, label: '2.2s Drop Tower' },
  { value: 22, label: '22s Parabolic' },
  { value: 300, label: '300s Extended' },
];

export const IGNITION_PULSE_DURATION_S = 3.5;
export const IGNITER_JOULE_POWER_W = 80;
export const AMBIENT_CHAMBER_TEMP_K = 295;
export const SPECIMEN_LENGTH_MM = 300;
export const NASA_STD_BURN_LIMIT_MM = 152;

export type TestVerdictOutcome = 'PASS' | 'FAIL';

export interface TestVerdict {
  outcome: TestVerdictOutcome;
  reason: 'SELF_EXTINGUISHED' | 'TIME_LIMIT' | 'FULL_BURNOUT';
  headline: string;
  summary: string;
  elapsedTimeS: number;
  burnLengthMm: number;
  testDuration: TestDurationMode;
}

export interface ChamberTransientInput {
  state: ChamberCombustionState;
  stateElapsedS: number;
  overloadElapsedS: number | null;
  n2DischargeRemainingS?: number;
  flameScale: number;
  thermocoupleTempsK: [number, number, number, number, number, number];
  elapsedTimeS: number;
  burnLengthMm: number;
  ignitedInRun: boolean;
  testVerdict: TestVerdict | null;
}

export const ALPHA_REF_M2_S = 2.216e-5; // Dry air thermal diffusivity at 300 K, 101325 Pa (m^2/s)
export const T_REF_K = 300.0; // Reference temperature for transport properties (K)
export const P_REF_PA = 101325.0; // Standard reference pressure (Pa)
export const ALPHA_TEMP_EXPONENT = 1.75; // Kinetic-theory temperature exponent n for thermal diffusivity
export const DA_CRIT = 1.0; // Critical Extinction-Proximity Index (Da*) threshold at extinction locus (loiMarginPercent = 0)
export const L_DIFF_M = 0.012; // Characteristic radial/stagnation diffusion length at V -> 0 (m)
export const CONCURRENT_THIN_SHEET_SPREAD_FACTOR = 0.07756; // Concurrent thin-sheet factor (0.07756 * 0.88 = 0.06826 in 40 cm Saffire duct, calibrated strictly to SAFFIRE-I-01 & SAFFIRE-II-05)

export interface MaterialSpec {
  id: MaterialId;
  name: string;
  shortName: string;
  loi1gPercent: number;
  loiUgMinPercent: number;
  vaporizationTempK: number;
  adiabaticBaseTempK: number;
  heatOfCombustionJkg: number;
  thermalInertia: number; // k * rho * c (W^2 s / m^4 K^2)
  radiativeFraction: number;
  sootYield: number;
  charForming: boolean;
  notes: string;
}

export const MATERIALS: Record<MaterialId, MaterialSpec> = {
  pmma: {
    id: 'pmma',
    name: 'PMMA (Cast Acrylic)',
    shortName: 'PMMA',
    loi1gPercent: 17.8,
    loiUgMinPercent: 15.6,
    vaporizationTempK: 635,
    adiabaticBaseTempK: 2180,
    heatOfCombustionJkg: 25.2e6,
    thermalInertia: 3.1e5,
    radiativeFraction: 0.28,
    sootYield: 0.022,
    charForming: false,
    notes: 'Non-charring thermoplastic; melts/vaporizes cleanly, canonical NASA BASS-II/Saffire benchmark.',
  },
  nomex: {
    id: 'nomex',
    name: 'Nomex / Flame-Retardant Cotton',
    shortName: 'Nomex FR',
    loi1gPercent: 28.2,
    loiUgMinPercent: 23.4,
    vaporizationTempK: 710,
    adiabaticBaseTempK: 1940,
    heatOfCombustionJkg: 17.4e6,
    thermalInertia: 1.4e5,
    radiativeFraction: 0.22,
    sootYield: 0.014,
    charForming: true,
    notes: 'Aramid/FR-treated textile; passes 1g 21% O2 screening but vulnerable in 34% O2 exploration atmospheres.',
  },
  silicone: {
    id: 'silicone',
    name: 'Silicone Wire Insulation',
    shortName: 'Silicone',
    loi1gPercent: 24.5,
    loiUgMinPercent: 20.8,
    vaporizationTempK: 685,
    adiabaticBaseTempK: 2060,
    heatOfCombustionJkg: 19.8e6,
    thermalInertia: 2.6e5,
    radiativeFraction: 0.34,
    sootYield: 0.036,
    charForming: true,
    notes: 'Forms porous silica ash shell; sensitive to low-velocity oxygen diffusion in microgravity.',
  },
  cellulose: {
    id: 'cellulose',
    name: 'Cellulose / Kimwipe',
    shortName: 'Cellulose',
    loi1gPercent: 16.5,
    loiUgMinPercent: 14.8,
    vaporizationTempK: 590,
    adiabaticBaseTempK: 2090,
    heatOfCombustionJkg: 16.5e6,
    thermalInertia: 0.48e5,
    radiativeFraction: 0.19,
    sootYield: 0.012,
    charForming: false,
    notes: 'Thermally thin cellulosic tissue; exhibits rapid concurrent spread and clean spherical blue flames at 0 cm/s.',
  },
};

export interface SimulationParams {
  o2Percent: number;       // 12 to 40 (%)
  pressurePa: number;      // 40000 to 110000 (Pa)
  flowVelocityMs: number;  // 0.00 to 0.50 (m/s)
  gravityMs2: number;      // 0.0 to 19.6133 (m/s^2, 0.000-2.000 g)
  materialId: MaterialId;
  flowMode: FlowMode;
  specimenGeometry?: SpecimenGeometry;
  ductScale?: DuctScale;
  hardware?: DuctHardwareConfig;
}

export function resolveSpecimenGeometry(params: SimulationParams): SpecimenGeometry {
  return params.specimenGeometry ?? 'rod';
}

export function resolveDuctScale(params: SimulationParams): DuctScale {
  return params.ductScale ?? 'msg-12cm';
}

export function resolveDuctHardware(params: SimulationParams): DuctHardwareConfig {
  return params.hardware ?? DEFAULT_DUCT_HARDWARE;
}

export interface MissionPreset {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  params: SimulationParams;
}

export const MISSION_PRESETS: MissionPreset[] = [
  {
    id: 'iss-nominal',
    label: 'ISS Nominal',
    shortLabel: 'ISS Nominal',
    description: '21% O2, 101.3 kPa, 15 cm/s forced cabin ventilation, 0g orbital microgravity.',
    params: {
      o2Percent: 21.0,
      pressurePa: 101325,
      flowVelocityMs: 0.15,
      gravityMs2: 0.0,
      materialId: 'pmma',
      flowMode: 'opposed',
    },
  },
  {
    id: 'orion-artemis',
    label: 'Orion / Artemis 34% O2',
    shortLabel: 'Artemis 34% O2',
    description: 'Exploration atmosphere: 34% O2 at 56.5 kPa (8.2 psi), 12 cm/s HVAC, 0g.',
    params: {
      o2Percent: 34.0,
      pressurePa: 56537,
      flowVelocityMs: 0.12,
      gravityMs2: 0.0,
      materialId: 'nomex',
      flowMode: 'concurrent',
    },
  },
  {
    id: 'vent-shutdown',
    label: 'Ventilation Shutdown (0 cm/s)',
    shortLabel: 'Vent Shutdown',
    description: 'Emergency HVAC fan cutoff in 0g: 0 cm/s forced flow, radiative-limited regime.',
    params: {
      o2Percent: 21.0,
      pressurePa: 101325,
      flowVelocityMs: 0.0,
      gravityMs2: 0.0,
      materialId: 'cellulose',
      flowMode: 'opposed',
    },
  },
  {
    id: 'earth-1g',
    label: 'Earth 1g Screening (NASA-STD-6001)',
    shortLabel: 'Earth 1g Std',
    description: '1.0g terrestrial buoyancy baseline contrasting self-extinction against 0g.',
    params: {
      o2Percent: 21.0,
      pressurePa: 101325,
      flowVelocityMs: 0.10,
      gravityMs2: STANDARD_GRAVITY_MS2,
      materialId: 'nomex',
      flowMode: 'opposed',
    },
  },
];

export const GRAVITY_LEVELS = [
  { id: '0g', label: '0 g (Microgravity)', valueMs2: 0.0, gRatio: 0 },
  { id: 'moon', label: '0.165 g (Moon)', valueMs2: 0.165 * STANDARD_GRAVITY_MS2, gRatio: 0.165 },
  { id: 'mars', label: '0.38 g (Mars)', valueMs2: 0.38 * STANDARD_GRAVITY_MS2, gRatio: 0.38 },
  { id: 'earth', label: '1.0 g (Earth 1g)', valueMs2: STANDARD_GRAVITY_MS2, gRatio: 1.0 },
] as const;

export interface FlameGeometry {
  plumeLengthM: number;
  plumeRadiusM: number;
  buoyancyTiltRad: number; // 0 = aligned with horizontal duct flow, >0 = upward buoyant tilt
  sootIntensity: number;   // 0..1 (yellow/amber soot luminance)
  blueZoneRatio: number;   // 0..1 (cyan radiative/chemiluminescent blue fraction)
  extinctionFactor: number; // 0..1 (1 = fully sustained, 0 = extinguished)
}

export interface DamkohlerDiagnostics {
  damkohlerNumber: number; // Extinction-Proximity Index (Da*) = exp(f(LOI Margin, Flow Strain))
  damkohlerCritical: number; // Critical threshold Da* = 1.0 at LOI extinction locus
  thermalDiffusivityM2S: number; // Gas thermal diffusivity alpha_g(T_film, P) (m^2/s)
  filmTempK: number; // Boundary-layer film temperature T_film = 0.5*(T_flame + T_amb) (K)
  reactionZoneTempK: number; // Effective flame-sheet temperature T_flame (K)
  characteristicVelocityMs: number; // Characteristic oxidizer transport velocity V_char (m/s)
  tauFlowS: number; // Flow residence time tau_flow = alpha_g / V_char^2 (s)
  tauChemS: number; // Implied reaction timescale tau_flow / Da* (s)
}

export interface ThermoTelemetry {
  regime: ExtinctionRegime;
  chamberState: ChamberCombustionState;
  stateElapsedS: number;
  igniterPowerW: number;
  overloadActive: boolean;
  overloadIntensity: number;
  n2DischargeActive: boolean;
  n2DischargeRemainingS: number;
  effectiveO2Percent: number;
  arrestorActive: boolean;
  arrestorOverwhelmed: boolean;
  pyrolysisFactor: number;
  flameScale: number;
  thermocoupleTempsK: [number, number, number, number, number, number];
  elapsedTimeS: number;
  burnLengthMm: number;
  testVerdict: TestVerdict | null;
  flameSpreadRateMs: number;
  effectiveLoiPercent: number;
  loiMarginPercent: number; // positive = above LOI (flammable), negative = below LOI (self-extinguishing)
  damkohlerNumber: number;
  damkohlerCritical: number;
  thermalDiffusivityM2S: number;
  filmTempK: number;
  reactionZoneTempK: number;
  characteristicVelocityMs: number;
  tauFlowS: number;
  tauChemS: number;
  reynoldsDuct: number;
  buoyantVelocityMs: number;
  effectiveVelocityMs: number;
  peakFlameTempK: number;
  radiativeHeatFluxWm2: number;
  convectiveHeatFluxWm2: number;
  totalHeatFluxWm2: number;
  o2PartialPressurePa: number;
  flameGeometry: FlameGeometry;
  isBurning: boolean;
  isOutsideCorrelationRange: boolean;
}

export type FieldProvenanceStatus =
  | 'measured'
  | 'derived'
  | 'assumed'
  | 'synthetic'
  | 'midpoint of published range'
  | 'assumed 101.3 kPa';

export type ExperimentProvenanceTag =
  | 'Measured (NASA Published Summary)'
  | 'Adapted Reference'
  | 'Literature Baseline'
  | 'Surrogate (Cotton-Fiberglass)'
  | 'Adapted Atmosphere'
  | 'Droplet Surrogate'
  | 'STD-6001 Criterion';

export type ExperimentScopeStatus = 'in_scope_solid' | 'out_of_scope';

export interface ExperimentProvenanceMeta {
  source: string;
  retrievedOn: string;
  notes: string;
  fields: {
    o2Percent: FieldProvenanceStatus;
    pressurePa: FieldProvenanceStatus;
    flowVelocityMs: FieldProvenanceStatus;
    gravityMs2: FieldProvenanceStatus;
    sampleThicknessMm: FieldProvenanceStatus;
    igniterPowerW: FieldProvenanceStatus;
    observedBurnLengthMm: FieldProvenanceStatus;
    observedSpreadRateMmS: FieldProvenanceStatus;
  };
}

export interface NasaPsiExperiment {
  id: string;
  program: 'Saffire-II' | 'BASS-II' | 'FLEX' | 'NASA-STD-6001';
  psiInvestigationId?: string;
  doi?: string;
  psiUrl?: string;
  license?: string;
  sourceTable?: string;
  sourceCitation?: string;
  provenanceTag?: ExperimentProvenanceTag | string;
  scopeStatus?: ExperimentScopeStatus;
  verificationStatus?: string;
  quarantineReason?: string;
  title: string;
  materialId: MaterialId;
  o2Percent: number;
  pressurePa: number;
  flowVelocityMs: number;
  gravityMs2: number;
  flowMode: FlowMode;
  sampleLengthMm?: number;
  sampleWidthMm?: number;
  sampleThicknessMm: number;
  testedThicknessesMm?: number[];
  durationS?: number;
  igniterPowerW: number;
  observedBurnLengthMm: number | null;
  observedSpreadRateMmS: number | null;
  discrepancyNote1gVsUg: string;
  psiCitation: string;
  provenance?: ExperimentProvenanceMeta;
}

export interface MatchScoreBreakdown {
  inputDistance: number;
  geometryPenalty: number;
  outcomePenalty: number;
  spreadRateErrorPenalty: number;
  totalDistance: number;
}

export interface MatchedExperimentResult {
  experiment: NasaPsiExperiment;
  similarityScore: number; // 0..100
  scoreBreakdown: MatchScoreBreakdown;
}

export function getInScopeSolidExperiments(
  experiments: NasaPsiExperiment[],
): NasaPsiExperiment[] {
  return experiments.filter((exp) => exp.scopeStatus !== 'out_of_scope');
}

export function getQuarantinedOutOfScopeExperiments(
  experiments: NasaPsiExperiment[],
): NasaPsiExperiment[] {
  return experiments.filter((exp) => exp.scopeStatus === 'out_of_scope');
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function smoothstep01(x: number): number {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Computes gas-phase thermal diffusivity alpha_g(T_film, P) in m^2/s:
 * alpha_g(T, P) = alpha_ref * (T / T_ref)^n * (P_ref / P)
 */
export function computeGasThermalDiffusivityM2S(filmTempK: number, pressurePa: number): number {
  const safeTempK = Math.max(200.0, filmTempK);
  const safePressurePa = Math.max(10000.0, pressurePa);
  return (
    ALPHA_REF_M2_S *
    Math.pow(safeTempK / T_REF_K, ALPHA_TEMP_EXPONENT) *
    (P_REF_PA / safePressurePa)
  );
}

/**
 * Computes Extinction-Proximity Index (Da*) and gas-phase residence diagnostics:
 *   Da* = exp(f(LOI Margin, Flow Strain))
 * Algebraic index derived from solver LOI margin (not independent Arrhenius kinetics):
 *   - Da* >= 1.0 indicates sustained burn margin (loiMarginPercent >= 0)
 *   - Da* < 1.0 indicates quenched or blow-off extinction margin
 * Also computes boundary-layer thermal diffusivity alpha_g(T_film, P) and residence time tau_flow = alpha_g / V_char^2.
 */
export function computeDamkohlerDiagnostics(input: {
  materialId: MaterialId;
  flowMode: FlowMode;
  pressurePa: number;
  effectiveVelocityMs: number;
  forcedVelocityMs: number;
  blowoffLimitMs: number;
  peakFlameTempK: number;
  ambientTempK: number;
  loiMarginPercent: number;
  isBurning: boolean;
}): DamkohlerDiagnostics {
  const filmTempK = 0.5 * (input.peakFlameTempK + input.ambientTempK);
  const thermalDiffusivityM2S = computeGasThermalDiffusivityM2S(filmTempK, input.pressurePa);

  // Radial diffusive transport floor velocity V_diff = alpha_g / L_diff ensures finite tau_flow at V = 0
  const diffusiveVelocityFloorMs = thermalDiffusivityM2S / L_DIFF_M;
  const concurrentLengthFactor = input.flowMode === 'concurrent' ? 1.38 : 1.0;
  const rawCharVelMs = Math.sqrt(
    input.effectiveVelocityMs * input.effectiveVelocityMs +
      diffusiveVelocityFloorMs * diffusiveVelocityFloorMs,
  );
  const characteristicVelocityMs = rawCharVelMs / Math.sqrt(concurrentLengthFactor);

  // Residence time tau_flow = alpha_g / V_char^2 (units: (m^2/s) / (m/s)^2 = s)
  const tauFlowS = thermalDiffusivityM2S / (characteristicVelocityMs * characteristicVelocityMs);

  let damkohlerNumber: number;
  if (input.isBurning) {
    const posMargin = Math.max(0, input.loiMarginPercent);
    const highFlowStrain =
      input.forcedVelocityMs > 0.25
        ? 0.35 *
          Math.pow(
            (input.forcedVelocityMs - 0.25) / Math.max(0.08, input.blowoffLimitMs - 0.25),
            1.4,
          )
        : 0;
    const logDaStar = Math.max(
      1e-9,
      0.46 * Math.log(1 + posMargin) + 0.075 * posMargin - highFlowStrain,
    );
    damkohlerNumber = DA_CRIT * Math.exp(logDaStar);
  } else {
    const subLoiDeficit = Math.max(0, -input.loiMarginPercent);
    const blowoffOverrun = Math.max(0, input.forcedVelocityMs - input.blowoffLimitMs);
    const quenchPenalty = 2.15 + 0.38 * subLoiDeficit + 6.5 * blowoffOverrun;
    damkohlerNumber = DA_CRIT * Math.exp(-quenchPenalty);
  }

  const reactionZoneTempK = input.peakFlameTempK;
  const tauChemS = tauFlowS / damkohlerNumber;

  return {
    damkohlerNumber,
    damkohlerCritical: DA_CRIT,
    thermalDiffusivityM2S,
    filmTempK,
    reactionZoneTempK,
    characteristicVelocityMs,
    tauFlowS,
    tauChemS,
  };
}

/**
 * Computes physically scaled igniter-zone pyrolysis char length (mm) when an ignition pulse
 * fails to transition to self-sustained propagation or is aborted during IGNITING.
 */
export function computeIgniterCharLengthMm(
  igniterElapsedS: number,
  params: SimulationParams,
  effectiveO2Percent?: number,
): number {
  const mat = MATERIALS[params.materialId];
  const o2 = effectiveO2Percent ?? clamp(params.o2Percent, 10, 45);
  return clamp(
    (igniterElapsedS / IGNITION_PULSE_DURATION_S) *
      (8 + 11 * (o2 / 21)) *
      Math.pow(3.1e5 / mat.thermalInertia, 0.35),
    2,
    30,
  );
}

/**
 * Pure steady-state thermo-fluids solver (base SI units).
 */
function computeSteadyThermo(
  params: SimulationParams,
  n2DischargeActive = false,
  n2DischargeRemainingS = 0,
): ThermoTelemetry {
  const mat = MATERIALS[params.materialId];
  const geometry = resolveSpecimenGeometry(params);
  const ductScale = resolveDuctScale(params);
  const ductSpec = DUCT_SCALES[ductScale];
  const hardware = resolveDuctHardware(params);

  const isOutsideCorrelationRange =
    params.o2Percent < 14 ||
    params.o2Percent > 36 ||
    params.flowVelocityMs > 0.45 ||
    params.gravityMs2 > 1.5 * STANDARD_GRAVITY_MS2;

  const baseO2 = clamp(params.o2Percent, 10, 45);
  const o2 = n2DischargeActive ? clamp(baseO2 - N2_O2_DROP_PERCENT, 5.0, 45.0) : baseO2;
  const p = clamp(params.pressurePa, 30000, 120000);
  const vForced = clamp(params.flowVelocityMs, 0, 0.6);
  const g = clamp(params.gravityMs2, 0, 2.0 * STANDARD_GRAVITY_MS2);

  const pRatio = p / STANDARD_ATM_PA;
  const o2PartialPressurePa = p * (o2 / 100);
  const gRatio = g / STANDARD_GRAVITY_MS2;

  // Natural convection buoyant velocity scale: V_b ~ sqrt(g * beta*dT * L_c)
  const lChar = geometry === 'droplet' ? 0.016 : 0.035;
  const buoyantVelocityMs = g > 0.001 ? Math.sqrt(g * 0.85 * lChar) : 0.0;

  // Upstream wake baffle shelters the specimen root, reducing local mean shear slightly
  const localWakeFlow = hardware.wakeBaffle ? vForced * 0.72 : vForced;

  // Combined effective oxidizer transport velocity
  const effectiveVelocityMs = Math.sqrt(
    localWakeFlow * localWakeFlow + buoyantVelocityMs * buoyantVelocityMs,
  );

  // Inlet Duct Reynolds number (300K, Dh = 120mm [MSG] or 400mm [Saffire], nu_air ~ 1.56e-5 / pRatio)
  const kinematicViscosity = 1.56e-5 / Math.max(0.35, pRatio);
  const reynoldsDuct = (effectiveVelocityMs * ductSpec.hydraulicDiameterM) / kinematicViscosity;

  // Microgravity vs Earth LOI shift:
  const lowFlowRadiativePenalty =
    gRatio < 0.08 && localWakeFlow < 0.035 && geometry !== 'droplet'
      ? 6.5 * Math.exp(-localWakeFlow / 0.014) * (1 - gRatio * 10)
      : geometry === 'droplet' && gRatio < 0.08 && localWakeFlow < 0.02
        ? 1.8 * Math.exp(-localWakeFlow / 0.01)
        : 0;

  // Upstream wake baffle recirculates flame root, cutting high-flow blow-off effectiveness by 62%
  const rawHighFlowBlowoff =
    vForced > 0.32 ? 18.0 * Math.pow((vForced - 0.32) / 0.18, 1.65) : 0;
  const highFlowBlowoffPenalty = hardware.wakeBaffle
    ? rawHighFlowBlowoff * 0.38
    : rawHighFlowBlowoff;

  const buoyancyPenalty = 3.2 * Math.pow(gRatio, 0.55);
  const pressureLoiShift = -1.6 * (1 - pRatio);
  const flowModeShift = params.flowMode === 'concurrent' ? -1.4 : 0.0;

  // Specimen geometry radiative / thermal inertia LOI shifts:
  // - Thin Sheet: dual-side heating lowers LOI by 0.7%
  // - Parallel Avionics Channel: 20 mm opposing wall view-factor trapping lowers LOI by 2.0%
  // - Suspended Droplet: minimal conductive sink lowers LOI by 0.9%
  const geometryLoiShift =
    geometry === 'channel'
      ? -2.0
      : geometry === 'sheet'
        ? -0.7
        : geometry === 'droplet'
          ? -0.9
          : 0.0;

  // Two-sided thin-sheet radiative quenching for charring/ash-forming materials:
  // Thin sheets of charring/ash-forming fuels (Nomex, Silicone) lose heat radiatively from both
  // faces while building an insulating char/silica-ash barrier (+2.2% to +4.2% LOI shift scaled by
  // mat.radiativeFraction; 0% for non-charring PMMA/cellulose and 0% for rods/channels/droplets).
  const thinSheetCharRadiativePenalty =
    geometry === 'sheet' && mat.charForming
      ? clamp(2.2 + ((mat.radiativeFraction - 0.22) / (0.34 - 0.22)) * 2.0, 2.2, 4.2)
      : 0.0;

  const effectiveLoiPercent = clamp(
    mat.loiUgMinPercent +
      buoyancyPenalty +
      lowFlowRadiativePenalty +
      highFlowBlowoffPenalty +
      pressureLoiShift +
      flowModeShift +
      geometryLoiShift +
      thinSheetCharRadiativePenalty,
    11.0,
    42.0,
  );

  const loiMarginPercent = o2 - effectiveLoiPercent;

  // High-flow blow-off threshold velocity (m/s)
  const blowoffLimitMs = hardware.wakeBaffle ? 0.48 : 0.38;
  const baffleResidenceBoost = hardware.wakeBaffle && vForced > 0.22 ? 1.38 : 1.0;
  const highFlowStrainFactor =
    (1.85 *
      Math.pow(o2 / 21.0, 2.15) *
      Math.pow(pRatio, 1.15) *
      (mat.charForming ? 0.68 : 1.12) *
      baffleResidenceBoost) /
    (Math.max(0.035, effectiveVelocityMs + 0.04) / 0.15);

  // Regime classification
  let regime: ExtinctionRegime;
  const isMicrogravityLike = gRatio < 0.1;

  if (
    isMicrogravityLike &&
    vForced >= blowoffLimitMs &&
    (loiMarginPercent < 2.2 || highFlowStrainFactor < 0.85)
  ) {
    regime = 'Blow-Off Extinction';
  } else if (vForced >= blowoffLimitMs && highFlowStrainFactor < 0.85) {
    regime = 'Blow-Off Extinction';
  } else if (
    isMicrogravityLike &&
    (localWakeFlow < 0.025 || (geometry === 'droplet' && localWakeFlow < 0.075)) &&
    loiMarginPercent >= -1.5
  ) {
    regime =
      o2 >= (geometry === 'droplet' ? 15.5 : 18.0)
        ? 'Radiative Spherical'
        : 'Quenched';
  } else if (loiMarginPercent < 0.0) {
    regime = 'Quenched';
  } else if (loiMarginPercent >= 7.0 || (o2 >= 29.0 && loiMarginPercent > 2.5)) {
    regime = 'Critical Runaway';
  } else {
    regime = 'Ventilation-Driven Spread';
  }

  // Unified combustion sustainability threshold: loiMarginPercent >= 0 and not quenched/blown-off
  const isBurning =
    loiMarginPercent >= 0.0 &&
    regime !== 'Quenched' &&
    regime !== 'Blow-Off Extinction';

  // Flame spread rate (m/s)
  let flameSpreadRateMs = 0;
  if (isBurning || regime === 'Radiative Spherical') {
    const o2Drive = Math.pow(Math.max(0.05, loiMarginPercent + 1.8) / 6.0, 1.45);
    const baseThermalFactor = 3.1e5 / Math.max(0.45e5, mat.thermalInertia);
    const flowFactor =
      regime === 'Radiative Spherical'
        ? 0.08 + localWakeFlow * 2.5
        : Math.pow(clamp(effectiveVelocityMs / 0.15, 0.25, 2.2), 0.58);
    const concurrentBoost = params.flowMode === 'concurrent' ? 2.15 : 1.0;
    const pressureBoost = Math.pow(pRatio, 0.35);
    const blowoffRollOff =
      vForced > 0.33
        ? clamp(1 - (vForced - 0.33) / (hardware.wakeBaffle ? 0.32 : 0.18), 0.15, 1)
        : 1.0;

    const geometrySpreadMultiplier =
      geometry === 'sheet'
        ? params.flowMode === 'concurrent'
          ? CONCURRENT_THIN_SHEET_SPREAD_FACTOR
          : 1.48
        : geometry === 'channel'
          ? 1.35
          : geometry === 'droplet'
            ? 0.55
            : 1.0;

    const ductWallLossFactor = ductSpec.wallLossSpreadFactor;

    flameSpreadRateMs = isBurning
      ? clamp(
          0.0014 *
            o2Drive *
            Math.pow(baseThermalFactor, 0.65) *
            flowFactor *
            concurrentBoost *
            pressureBoost *
            blowoffRollOff *
            geometrySpreadMultiplier *
            ductWallLossFactor,
          0.00005,
          0.055,
        )
      : 0;
  }

  // Peak Flame Temperature (K)
  const ambientTempK = AMBIENT_CHAMBER_TEMP_K;
  let peakFlameTempK = ambientTempK;
  if (!isBurning) {
    peakFlameTempK = ambientTempK + 45;
  } else if (regime === 'Radiative Spherical') {
    const dropletOffset = geometry === 'droplet' ? -90 : 0;
    peakFlameTempK = clamp(1120 + (o2 - 18) * 32 + dropletOffset, 980, 1520);
  } else {
    const o2TempBoost = (o2 - 21) * 26;
    const flowCooling = localWakeFlow > 0.3 ? (localWakeFlow - 0.3) * 450 : 0;
    const channelTempBoost = geometry === 'channel' ? 85 : 0;
    peakFlameTempK = clamp(
      mat.adiabaticBaseTempK + o2TempBoost + channelTempBoost - flowCooling - (1 - pRatio) * 80,
      1380,
      2820,
    );
  }

  // Extinction-Proximity Index (Da* = exp(f(LOI Margin, Flow Strain)))
  const daDiag = computeDamkohlerDiagnostics({
    materialId: params.materialId,
    flowMode: params.flowMode,
    pressurePa: p,
    effectiveVelocityMs,
    forcedVelocityMs: vForced,
    blowoffLimitMs,
    peakFlameTempK,
    ambientTempK,
    loiMarginPercent,
    isBurning,
  });
  const damkohlerNumber = daDiag.damkohlerNumber;

  // Heat Fluxes (W/m^2)
  const stefanBoltzmann = 5.670374419e-8;
  const emissivity =
    regime === 'Radiative Spherical'
      ? 0.16
      : clamp(0.22 + mat.sootYield * 12 + (o2 - 21) * 0.012, 0.18, 0.72);
  const channelRadBoost = geometry === 'channel' ? 1.42 : geometry === 'sheet' ? 1.12 : 1.0;
  const rawRadFlux = isBurning
    ? emissivity *
      stefanBoltzmann *
      (Math.pow(peakFlameTempK, 4) - Math.pow(ambientTempK, 4)) *
      0.28 *
      channelRadBoost
    : 180;

  const hConv = 8.5 + 48.0 * Math.sqrt(Math.max(0.005, effectiveVelocityMs));
  const channelConvBoost = geometry === 'channel' ? 1.18 : 1.0;
  const rawConvFlux = isBurning
    ? hConv *
      (peakFlameTempK - mat.vaporizationTempK) *
      (params.flowMode === 'concurrent' ? 1.25 : 0.92) *
      channelConvBoost
    : 120;

  const radiativeHeatFluxWm2 = clamp(rawRadFlux, 120, 240000);
  const convectiveHeatFluxWm2 = clamp(rawConvFlux, 100, 240000);
  const totalHeatFluxWm2 = radiativeHeatFluxWm2 + convectiveHeatFluxWm2;

  // Flame geometry for canvas rendering (meters in 0.45 m test duct)
  const extinctionFactor = isBurning
    ? regime === 'Radiative Spherical'
      ? clamp(0.45 + loiMarginPercent * 0.08, 0.25, 0.7)
      : clamp(0.55 + loiMarginPercent * 0.07, 0.45, 1.0)
    : 0.0;

  let plumeLengthM = 0.032;
  let plumeRadiusM = 0.022;
  if (regime === 'Radiative Spherical') {
    plumeLengthM = (geometry === 'droplet' ? 0.028 : 0.034) + localWakeFlow * 0.32;
    plumeRadiusM = geometry === 'droplet' ? 0.026 : 0.030;
  } else if (isBurning) {
    const spreadScale = Math.pow(flameSpreadRateMs * 1000, 0.42);
    plumeLengthM = clamp(0.042 + spreadScale * 0.032 + effectiveVelocityMs * 0.16, 0.04, 0.24);
    plumeRadiusM = clamp(
      (geometry === 'channel' ? 0.017 : 0.020) + (o2 - 16) * 0.0012 - localWakeFlow * 0.018,
      0.013,
      0.048,
    );
  } else {
    plumeLengthM = 0.020;
    plumeRadiusM = 0.014;
  }

  const arrestorActive = hardware.flameArrestor;
  const arrestorOverwhelmed = hardware.flameArrestor && baseO2 > 32.0;

  const buoyancyTiltRad = Math.atan2(buoyantVelocityMs, Math.max(0.04, localWakeFlow));

  const blueZoneRatio =
    regime === 'Radiative Spherical'
      ? 0.94
      : regime === 'Blow-Off Extinction'
        ? 0.88
        : clamp(0.55 - (o2 - 20) * 0.022 - gRatio * 0.18 + (vForced > 0.28 ? 0.2 : 0), 0.12, 0.92);

  const sootIntensity = isBurning
    ? clamp((1 - blueZoneRatio) * (0.65 + mat.sootYield * 10), 0.05, 1.0)
    : 0.05;

  const flowShift = clamp((localWakeFlow - 0.15) * 0.4, -0.1, 0.16);
  const gScale = clamp(1 - gRatio * 0.25, 0.72, 1.0);
  const tcWeights = [
    0.26,
    0.44,
    0.66 * gScale,
    clamp(0.58 + flowShift * 0.5, 0.35, 0.8),
    clamp(0.42 + flowShift, 0.2, 0.72),
    clamp(0.22 + flowShift * 1.1, 0.08, 0.55),
  ];
  const steadyTcTemps = tcWeights.map((w) =>
    isBurning
      ? AMBIENT_CHAMBER_TEMP_K + (peakFlameTempK - AMBIENT_CHAMBER_TEMP_K) * w
      : AMBIENT_CHAMBER_TEMP_K + 18 * w,
  ) as [number, number, number, number, number, number];

  return {
    regime,
    chamberState: isBurning ? 'SUSTAINED_BURN' : 'SELF_EXTINGUISHED',
    stateElapsedS: 8.0,
    igniterPowerW: 0,
    overloadActive: false,
    overloadIntensity: 0,
    n2DischargeActive,
    n2DischargeRemainingS,
    effectiveO2Percent: o2,
    arrestorActive,
    arrestorOverwhelmed,
    pyrolysisFactor: isBurning ? 1 : 0,
    flameScale: isBurning ? 1 : 0,
    thermocoupleTempsK: steadyTcTemps,
    elapsedTimeS: 0,
    burnLengthMm: isBurning ? 0 : computeIgniterCharLengthMm(IGNITION_PULSE_DURATION_S, params, o2),
    testVerdict: null,
    flameSpreadRateMs,
    effectiveLoiPercent,
    loiMarginPercent,
    damkohlerNumber,
    damkohlerCritical: daDiag.damkohlerCritical,
    thermalDiffusivityM2S: daDiag.thermalDiffusivityM2S,
    filmTempK: daDiag.filmTempK,
    reactionZoneTempK: daDiag.reactionZoneTempK,
    characteristicVelocityMs: daDiag.characteristicVelocityMs,
    tauFlowS: daDiag.tauFlowS,
    tauChemS: daDiag.tauChemS,
    reynoldsDuct,
    buoyantVelocityMs,
    effectiveVelocityMs,
    peakFlameTempK,
    radiativeHeatFluxWm2,
    convectiveHeatFluxWm2,
    totalHeatFluxWm2,
    o2PartialPressurePa,
    flameGeometry: {
      plumeLengthM,
      plumeRadiusM,
      buoyancyTiltRad,
      sootIntensity,
      blueZoneRatio,
      extinctionFactor,
    },
    isBurning,
    isOutsideCorrelationRange,
  };
}

/**
 * Checks whether chamber conditions support sustained flame propagation
 * once the 3.5s ignition pulse completes. Governed by the unified loiMarginPercent >= 0 threshold.
 */
export function canSustainCombustion(
  _params: SimulationParams,
  steady: Pick<ThermoTelemetry, 'loiMarginPercent' | 'isBurning'>,
): boolean {
  return steady.loiMarginPercent >= 0 && steady.isBurning;
}

const AMBIENT_TC_ARRAY: [number, number, number, number, number, number] = [
  AMBIENT_CHAMBER_TEMP_K,
  AMBIENT_CHAMBER_TEMP_K,
  AMBIENT_CHAMBER_TEMP_K,
  AMBIENT_CHAMBER_TEMP_K,
  AMBIENT_CHAMBER_TEMP_K,
  AMBIENT_CHAMBER_TEMP_K,
];

function applyThermalLag(
  current: [number, number, number, number, number, number],
  targets: [number, number, number, number, number, number],
  taus: [number, number, number, number, number, number],
  dtS: number,
): [number, number, number, number, number, number] {
  return current.map((tCur, idx) => {
    const tau = Math.max(0.05, taus[idx]);
    const alpha = 1 - Math.exp(-dtS / tau);
    return tCur + (targets[idx] - tCur) * alpha;
  }) as [number, number, number, number, number, number];
}

export function buildTestVerdict(
  reason: TestVerdict['reason'],
  elapsedTimeS: number,
  burnLengthMm: number,
  testDuration: TestDurationMode,
  isStillBurning: boolean,
): TestVerdict {
  const burnRounded = Math.round(burnLengthMm);
  const timeStr = elapsedTimeS.toFixed(1);

  if (reason === 'FULL_BURNOUT') {
    return {
      outcome: 'FAIL',
      reason,
      headline: `FAIL — Exceeded ${NASA_STD_BURN_LIMIT_MM} mm Limit / Full Burnout in ${timeStr}s`,
      summary: `Full ${SPECIMEN_LENGTH_MM} mm specimen consumed in ${timeStr}s (exceeds ${NASA_STD_BURN_LIMIT_MM} mm NASA-STD-6001 limit).`,
      elapsedTimeS,
      burnLengthMm,
      testDuration,
    };
  }

  if (reason === 'SELF_EXTINGUISHED') {
    if (burnLengthMm <= NASA_STD_BURN_LIMIT_MM) {
      return {
        outcome: 'PASS',
        reason,
        headline: `PASS — Self-Extinguished at ${burnRounded} mm in ${timeStr}s`,
        summary: `Flame self-extinguished at ${burnLengthMm.toFixed(1)} mm in ${timeStr}s, within the ${NASA_STD_BURN_LIMIT_MM} mm NASA-STD-6001 limit.`,
        elapsedTimeS,
        burnLengthMm,
        testDuration,
      };
    }
    return {
      outcome: 'FAIL',
      reason,
      headline: `FAIL — Exceeded ${NASA_STD_BURN_LIMIT_MM} mm Limit (${burnRounded} mm) in ${timeStr}s`,
      summary: `Flame self-extinguished at ${burnLengthMm.toFixed(1)} mm in ${timeStr}s after exceeding the ${NASA_STD_BURN_LIMIT_MM} mm limit.`,
      elapsedTimeS,
      burnLengthMm,
      testDuration,
    };
  }

  // TIME_LIMIT reached
  if (burnLengthMm > NASA_STD_BURN_LIMIT_MM || isStillBurning) {
    return {
      outcome: 'FAIL',
      reason,
      headline:
        burnLengthMm > NASA_STD_BURN_LIMIT_MM
          ? `FAIL — Exceeded ${NASA_STD_BURN_LIMIT_MM} mm Limit (${burnRounded} mm) in ${timeStr}s`
          : `FAIL — Sustained Propagation at ${timeStr}s Limit (${burnRounded} mm)`,
      summary: `Specimen burned ${burnLengthMm.toFixed(1)} mm over the ${timeStr}s timed run without self-extinguishing below the ${NASA_STD_BURN_LIMIT_MM} mm criterion.`,
      elapsedTimeS,
      burnLengthMm,
      testDuration,
    };
  }

  return {
    outcome: 'PASS',
    reason,
    headline: `PASS — Self-Extinguished at ${burnRounded} mm in ${timeStr}s`,
    summary: `Timed ${timeStr}s run concluded with ${burnLengthMm.toFixed(1)} mm total char length (within ${NASA_STD_BURN_LIMIT_MM} mm limit).`,
    elapsedTimeS,
    burnLengthMm,
    testDuration,
  };
}

export function resetChamberToStandby(
  prev?: ChamberTransientInput,
  resetSpecimen = true,
): ChamberTransientInput {
  return {
    state: 'STANDBY',
    stateElapsedS: 0,
    overloadElapsedS: null,
    n2DischargeRemainingS: resetSpecimen ? 0 : (prev?.n2DischargeRemainingS ?? 0),
    flameScale: prev ? prev.flameScale : 0,
    thermocoupleTempsK: prev ? [...prev.thermocoupleTempsK] : [...AMBIENT_TC_ARRAY],
    elapsedTimeS: resetSpecimen ? 0 : (prev?.elapsedTimeS ?? 0),
    burnLengthMm: resetSpecimen ? 0 : (prev?.burnLengthMm ?? 0),
    ignitedInRun: false,
    testVerdict: resetSpecimen ? null : (prev?.testVerdict ?? null),
  };
}

export function extinguishChamber(prev: ChamberTransientInput): ChamberTransientInput {
  return {
    state: 'SELF_EXTINGUISHED',
    stateElapsedS: 0,
    overloadElapsedS: null,
    n2DischargeRemainingS: prev.n2DischargeRemainingS ?? 0,
    flameScale: prev.flameScale,
    thermocoupleTempsK: [...prev.thermocoupleTempsK],
    elapsedTimeS: prev.elapsedTimeS,
    burnLengthMm: prev.burnLengthMm,
    ignitedInRun: prev.ignitedInRun,
    testVerdict: prev.testVerdict,
  };
}

export function dischargeNitrogen(prev: ChamberTransientInput): ChamberTransientInput {
  const activeBurnOrIgn = prev.state === 'IGNITING' || prev.state === 'SUSTAINED_BURN';
  return {
    state: activeBurnOrIgn ? 'SELF_EXTINGUISHED' : prev.state,
    stateElapsedS: activeBurnOrIgn ? 0 : prev.stateElapsedS,
    overloadElapsedS: null,
    n2DischargeRemainingS: N2_DISCHARGE_DURATION_S,
    flameScale: prev.flameScale,
    thermocoupleTempsK: [...prev.thermocoupleTempsK],
    elapsedTimeS: prev.elapsedTimeS,
    burnLengthMm: prev.burnLengthMm,
    ignitedInRun: prev.ignitedInRun,
    testVerdict: prev.testVerdict,
  };
}

export function triggerIgniterPulse(prev: ChamberTransientInput): ChamberTransientInput {
  if (prev.state === 'SUSTAINED_BURN' && prev.testVerdict === null) {
    return {
      ...prev,
      overloadElapsedS: 0,
      ignitedInRun: true,
    };
  }
  const startingFresh = prev.state === 'SELF_EXTINGUISHED' || prev.testVerdict !== null;
  return {
    state: 'IGNITING',
    stateElapsedS: 0,
    overloadElapsedS: null,
    n2DischargeRemainingS: prev.n2DischargeRemainingS ?? 0,
    flameScale: prev.flameScale,
    thermocoupleTempsK: [...prev.thermocoupleTempsK],
    elapsedTimeS: startingFresh ? 0 : prev.elapsedTimeS,
    burnLengthMm: startingFresh ? 0 : prev.burnLengthMm,
    ignitedInRun: true,
    testVerdict: null,
  };
}

export function getInitialChamberForParams(params: SimulationParams): ChamberTransientInput {
  const steady = computeSteadyThermo(params);
  if (canSustainCombustion(params, steady)) {
    return {
      state: 'SUSTAINED_BURN',
      stateElapsedS: 8.0,
      overloadElapsedS: null,
      n2DischargeRemainingS: 0,
      flameScale: 1.0,
      thermocoupleTempsK: [...steady.thermocoupleTempsK],
      elapsedTimeS: 0,
      burnLengthMm: 0,
      ignitedInRun: true,
      testVerdict: null,
    };
  }
  return {
    state: 'SELF_EXTINGUISHED',
    stateElapsedS: 2.5,
    overloadElapsedS: null,
    n2DischargeRemainingS: 0,
    flameScale: 0.0,
    thermocoupleTempsK: [376, 352, 338, 327, 318, 311],
    elapsedTimeS: 0,
    burnLengthMm: computeIgniterCharLengthMm(
      IGNITION_PULSE_DURATION_S,
      params,
      steady.effectiveO2Percent,
    ),
    ignitedInRun: false,
    testVerdict: null,
  };
}

export function stepChamberTransient(
  prev: ChamberTransientInput,
  dtS: number,
  params: SimulationParams,
  testDuration: TestDurationMode = 60,
): ChamberTransientInput {
  const dt = Math.max(0, dtS);
  const nextN2 = Math.max(0, (prev.n2DischargeRemainingS ?? 0) - dt);
  const n2Active = nextN2 > 0.001;

  // Once a timed verdict concludes, freeze chronometer & burn advancement while allowing flameScale fadeout and cooling
  if (prev.testVerdict !== null) {
    if (prev.state === 'SELF_EXTINGUISHED' || prev.state === 'STANDBY') {
      const nextScale = Math.max(0, prev.flameScale - dt / 0.8);
      const nextTcs = applyThermalLag(
        prev.thermocoupleTempsK,
        AMBIENT_TC_ARRAY,
        [1.6, 1.6, 1.6, 1.6, 1.6, 1.6],
        dt,
      );
      return {
        ...prev,
        n2DischargeRemainingS: nextN2,
        flameScale: nextScale,
        thermocoupleTempsK: nextTcs,
      };
    }
    return {
      ...prev,
      n2DischargeRemainingS: nextN2,
    };
  }

  const nextElapsed = prev.stateElapsedS + dt;

  if (prev.state === 'STANDBY') {
    const nextScale = Math.max(0, prev.flameScale - dt / 0.8);
    const nextTcs = applyThermalLag(
      prev.thermocoupleTempsK,
      AMBIENT_TC_ARRAY,
      [1.4, 1.4, 1.4, 1.4, 1.4, 1.4],
      dt,
    );
    return {
      ...prev,
      state: 'STANDBY',
      stateElapsedS: nextElapsed,
      overloadElapsedS: null,
      n2DischargeRemainingS: nextN2,
      flameScale: nextScale,
      thermocoupleTempsK: nextTcs,
    };
  }

  if (prev.state === 'IGNITING') {
    const rawTotalElapsed = prev.elapsedTimeS + dt;
    const cappedElapsed =
      testDuration !== 'Continuous' ? Math.min(testDuration, rawTotalElapsed) : rawTotalElapsed;
    const ignTargets: [number, number, number, number, number, number] = [
      AMBIENT_CHAMBER_TEMP_K + 640,
      AMBIENT_CHAMBER_TEMP_K + 165,
      AMBIENT_CHAMBER_TEMP_K + 80,
      AMBIENT_CHAMBER_TEMP_K + 42,
      AMBIENT_CHAMBER_TEMP_K + 22,
      AMBIENT_CHAMBER_TEMP_K + 12,
    ];
    const nextTcs = applyThermalLag(
      prev.thermocoupleTempsK,
      ignTargets,
      [0.95, 1.5, 1.9, 2.2, 2.5, 2.8],
      dt,
    );

    const kernelWindowStart = IGNITION_PULSE_DURATION_S - 1.0;
    let nextScale = Math.max(0, prev.flameScale - dt / 0.6);
    if (nextElapsed >= kernelWindowStart && !n2Active) {
      const kProgress = clamp((nextElapsed - kernelWindowStart) / 1.0, 0, 1);
      const kernelTarget = 0.35 * smoothstep01(kProgress);
      nextScale = Math.max(nextScale, kernelTarget);
    }

    const baseO2 = clamp(params.o2Percent, 10, 45);
    const effectiveIgnO2 = n2Active ? clamp(baseO2 - N2_O2_DROP_PERCENT, 5.0, 45.0) : baseO2;
    const igniterElapsedCapped = Math.min(nextElapsed, IGNITION_PULSE_DURATION_S);
    const igniterCharMm = Math.max(
      prev.burnLengthMm,
      computeIgniterCharLengthMm(igniterElapsedCapped, params, effectiveIgnO2),
    );

    if (testDuration !== 'Continuous' && cappedElapsed >= testDuration) {
      return {
        state: 'IGNITING',
        stateElapsedS: nextElapsed,
        overloadElapsedS: null,
        n2DischargeRemainingS: nextN2,
        flameScale: nextScale,
        thermocoupleTempsK: nextTcs,
        elapsedTimeS: cappedElapsed,
        burnLengthMm: igniterCharMm,
        ignitedInRun: true,
        testVerdict: buildTestVerdict('TIME_LIMIT', cappedElapsed, igniterCharMm, testDuration, false),
      };
    }

    if (nextElapsed >= IGNITION_PULSE_DURATION_S) {
      const steady = computeSteadyThermo(params, n2Active, nextN2);
      if (canSustainCombustion(params, steady)) {
        return {
          state: 'SUSTAINED_BURN',
          stateElapsedS: 0,
          overloadElapsedS: null,
          n2DischargeRemainingS: nextN2,
          flameScale: Math.max(0.35, nextScale),
          thermocoupleTempsK: nextTcs,
          elapsedTimeS: cappedElapsed,
          burnLengthMm: prev.burnLengthMm,
          ignitedInRun: true,
          testVerdict: null,
        };
      }
      const failedIgnCharMm = Math.max(
        prev.burnLengthMm,
        computeIgniterCharLengthMm(IGNITION_PULSE_DURATION_S, params, steady.effectiveO2Percent),
      );
      const verdict =
        testDuration !== 'Continuous'
          ? buildTestVerdict('SELF_EXTINGUISHED', cappedElapsed, failedIgnCharMm, testDuration, false)
          : null;
      return {
        state: 'SELF_EXTINGUISHED',
        stateElapsedS: 0,
        overloadElapsedS: null,
        n2DischargeRemainingS: nextN2,
        flameScale: nextScale,
        thermocoupleTempsK: nextTcs,
        elapsedTimeS: cappedElapsed,
        burnLengthMm: failedIgnCharMm,
        ignitedInRun: true,
        testVerdict: verdict,
      };
    }

    return {
      state: 'IGNITING',
      stateElapsedS: nextElapsed,
      overloadElapsedS: null,
      n2DischargeRemainingS: nextN2,
      flameScale: nextScale,
      thermocoupleTempsK: nextTcs,
      elapsedTimeS: cappedElapsed,
      burnLengthMm: igniterCharMm,
      ignitedInRun: true,
      testVerdict: null,
    };
  }

  if (prev.state === 'SUSTAINED_BURN') {
    const steady = computeSteadyThermo(params, n2Active, nextN2);
    if (!canSustainCombustion(params, steady)) {
      const verdict =
        testDuration !== 'Continuous' && prev.ignitedInRun
          ? buildTestVerdict('SELF_EXTINGUISHED', prev.elapsedTimeS, prev.burnLengthMm, testDuration, false)
          : null;
      return {
        state: 'SELF_EXTINGUISHED',
        stateElapsedS: 0,
        overloadElapsedS: null,
        n2DischargeRemainingS: nextN2,
        flameScale: prev.flameScale,
        thermocoupleTempsK: [...prev.thermocoupleTempsK],
        elapsedTimeS: prev.elapsedTimeS,
        burnLengthMm: prev.burnLengthMm,
        ignitedInRun: prev.ignitedInRun,
        testVerdict: verdict,
      };
    }

    let nextOverload: number | null = prev.overloadElapsedS;
    if (nextOverload !== null) {
      nextOverload += dt;
      if (nextOverload >= IGNITION_PULSE_DURATION_S) {
        nextOverload = null;
      }
    }

    const surge =
      nextOverload !== null
        ? Math.pow(clamp(1 - nextOverload / IGNITION_PULSE_DURATION_S, 0, 1), 1.35)
        : 0;

    const burnTargets: [number, number, number, number, number, number] = [
      steady.thermocoupleTempsK[0] + 420 * surge,
      steady.thermocoupleTempsK[1] + 260 * surge,
      steady.thermocoupleTempsK[2] + 110 * surge,
      steady.thermocoupleTempsK[3],
      steady.thermocoupleTempsK[4],
      steady.thermocoupleTempsK[5],
    ];

    const nextTcs = applyThermalLag(
      prev.thermocoupleTempsK,
      burnTargets,
      [0.65, 1.25, 1.85, 2.45, 3.05, 3.65],
      dt,
    );

    const nextScale = Math.min(1.0, prev.flameScale + dt * ((1.0 - 0.35) / 1.2));
    const spreadRateMmS =
      steady.flameSpreadRateMs * 1000 * clamp((nextScale - 0.15) / 0.85, 0.15, 1.0) * (1 + 0.35 * surge);

    const rawNextTime = prev.elapsedTimeS + dt;
    const cappedTime =
      testDuration !== 'Continuous'
        ? prev.elapsedTimeS >= testDuration
          ? prev.elapsedTimeS
          : Math.min(testDuration, rawNextTime)
        : rawNextTime;
    const effectiveDt = Math.max(0, cappedTime - prev.elapsedTimeS);

    const hardware = resolveDuctHardware(params);
    const arrestorCapActive = hardware.flameArrestor && params.o2Percent <= 32.0;
    const maxBurnMm = arrestorCapActive ? FLAME_ARRESTOR_X_MM : SPECIMEN_LENGTH_MM;

    const rawBurnMm = prev.burnLengthMm + spreadRateMmS * effectiveDt;
    const cappedBurnMm = clamp(rawBurnMm, 0, maxBurnMm);

    // Flame Arrestor Mesh quenches propagation cleanly at 280 mm unless overwhelmed (>32% O2)
    if (arrestorCapActive && cappedBurnMm >= FLAME_ARRESTOR_X_MM) {
      const verdict =
        testDuration !== 'Continuous' && prev.ignitedInRun
          ? buildTestVerdict('SELF_EXTINGUISHED', cappedTime, FLAME_ARRESTOR_X_MM, testDuration, false)
          : null;
      return {
        state: 'SELF_EXTINGUISHED',
        stateElapsedS: 0,
        overloadElapsedS: null,
        n2DischargeRemainingS: nextN2,
        flameScale: nextScale,
        thermocoupleTempsK: nextTcs,
        elapsedTimeS: cappedTime,
        burnLengthMm: FLAME_ARRESTOR_X_MM,
        ignitedInRun: prev.ignitedInRun,
        testVerdict: verdict,
      };
    }

    let verdict: TestVerdict | null = null;
    if (testDuration !== 'Continuous') {
      if (cappedBurnMm >= SPECIMEN_LENGTH_MM) {
        verdict = buildTestVerdict('FULL_BURNOUT', cappedTime, SPECIMEN_LENGTH_MM, testDuration, true);
      } else if (cappedTime >= testDuration) {
        verdict = buildTestVerdict('TIME_LIMIT', cappedTime, cappedBurnMm, testDuration, true);
      }
    }

    return {
      state: 'SUSTAINED_BURN',
      stateElapsedS: nextElapsed,
      overloadElapsedS: nextOverload,
      n2DischargeRemainingS: nextN2,
      flameScale: nextScale,
      thermocoupleTempsK: nextTcs,
      elapsedTimeS: cappedTime,
      burnLengthMm: cappedBurnMm,
      ignitedInRun: prev.ignitedInRun,
      testVerdict: verdict,
    };
  }

  // SELF_EXTINGUISHED: smooth 0.8s flame shrink + 1st-order TC thermal decay
  const nextScale = Math.max(0, prev.flameScale - dt / 0.8);
  const nextTcs = applyThermalLag(
    prev.thermocoupleTempsK,
    AMBIENT_TC_ARRAY,
    [1.6, 1.6, 1.6, 1.6, 1.6, 1.6],
    dt,
  );

  return {
    state: 'SELF_EXTINGUISHED',
    stateElapsedS: Math.min(30, nextElapsed),
    overloadElapsedS: null,
    n2DischargeRemainingS: nextN2,
    flameScale: nextScale,
    thermocoupleTempsK: nextTcs,
    elapsedTimeS: prev.elapsedTimeS,
    burnLengthMm: prev.burnLengthMm,
    ignitedInRun: prev.ignitedInRun,
    testVerdict: prev.testVerdict,
  };
}

/**
 * Pure deterministic thermo-fluids solver combining steady-state flammability physics
 * with the live Chamber Combustion State machine (STANDBY, IGNITING, SUSTAINED_BURN, SELF_EXTINGUISHED).
 * Ready for 1:1 port to Rust/WebAssembly (wasm-bindgen).
 */
export function computeThermoTelemetry(
  params: SimulationParams,
  chamber?: ChamberTransientInput,
): ThermoTelemetry {
  const n2Rem = Math.max(0, chamber?.n2DischargeRemainingS ?? 0);
  const n2Active = n2Rem > 0.001;
  const steady = computeSteadyThermo(params, n2Active, n2Rem);
  if (!chamber) {
    return steady;
  }

  const elapsed = Math.max(0, chamber.stateElapsedS);
  const flameScale = clamp(chamber.flameScale, 0, 1);
  const tcTemps = chamber.thermocoupleTempsK;
  const elapsedTimeS = chamber.elapsedTimeS;
  const burnLengthMm = chamber.burnLengthMm;
  const testVerdict = chamber.testVerdict;

  if (chamber.state === 'STANDBY') {
    const radFlux = flameScale > 0.002 ? Math.round(steady.radiativeHeatFluxWm2 * flameScale) : 0;
    const convFlux = flameScale > 0.002 ? Math.round(steady.convectiveHeatFluxWm2 * flameScale) : 0;
    const peakTemp =
      flameScale > 0.002
        ? AMBIENT_CHAMBER_TEMP_K + (steady.peakFlameTempK - AMBIENT_CHAMBER_TEMP_K) * flameScale
        : AMBIENT_CHAMBER_TEMP_K;

    return {
      ...steady,
      chamberState: 'STANDBY',
      stateElapsedS: elapsed,
      igniterPowerW: 0,
      overloadActive: false,
      overloadIntensity: 0,
      pyrolysisFactor: 0,
      flameScale,
      thermocoupleTempsK: tcTemps,
      elapsedTimeS,
      burnLengthMm,
      testVerdict,
      flameSpreadRateMs: 0,
      peakFlameTempK: peakTemp,
      radiativeHeatFluxWm2: radFlux,
      convectiveHeatFluxWm2: convFlux,
      totalHeatFluxWm2: radFlux + convFlux,
      flameGeometry: {
        ...steady.flameGeometry,
        plumeLengthM: steady.flameGeometry.plumeLengthM * flameScale,
        plumeRadiusM: steady.flameGeometry.plumeRadiusM * (0.35 + 0.65 * flameScale),
        sootIntensity: steady.flameGeometry.sootIntensity * flameScale,
        blueZoneRatio: steady.flameGeometry.blueZoneRatio,
        extinctionFactor: steady.flameGeometry.extinctionFactor * flameScale,
      },
      isBurning: false,
    };
  }

  if (chamber.state === 'IGNITING') {
    const pNorm = clamp(elapsed / IGNITION_PULSE_DURATION_S, 0, 1);
    const ramp = smoothstep01(pNorm * 1.15);
    const radFlux = Math.round(
      14500 + 13500 * ramp + steady.radiativeHeatFluxWm2 * flameScale * 0.35,
    );
    const convFlux = Math.round(
      9200 + 9800 * ramp + steady.convectiveHeatFluxWm2 * flameScale * 0.35,
    );
    const pyrolysisFactor = clamp((pNorm - 0.12) / 0.88, 0, 1);
    const kernelPeak =
      flameScale > 0.01
        ? AMBIENT_CHAMBER_TEMP_K + (steady.peakFlameTempK - AMBIENT_CHAMBER_TEMP_K) * Math.min(0.65, flameScale * 1.4)
        : tcTemps[0];

    return {
      ...steady,
      chamberState: 'IGNITING',
      stateElapsedS: elapsed,
      igniterPowerW: IGNITER_JOULE_POWER_W,
      overloadActive: false,
      overloadIntensity: 0,
      pyrolysisFactor,
      flameScale,
      thermocoupleTempsK: tcTemps,
      elapsedTimeS,
      burnLengthMm,
      testVerdict,
      flameSpreadRateMs: 0,
      peakFlameTempK: Math.max(tcTemps[0], kernelPeak),
      radiativeHeatFluxWm2: radFlux,
      convectiveHeatFluxWm2: convFlux,
      totalHeatFluxWm2: radFlux + convFlux,
      flameGeometry: {
        ...steady.flameGeometry,
        plumeLengthM: Math.max(0.02, steady.flameGeometry.plumeLengthM * Math.max(0.28, flameScale)),
        plumeRadiusM: Math.max(0.014, steady.flameGeometry.plumeRadiusM * Math.max(0.45, flameScale)),
        sootIntensity: 0.1 * pyrolysisFactor,
        blueZoneRatio: 0.9,
        extinctionFactor: Math.max(0.15, flameScale),
      },
      isBurning: false,
    };
  }

  if (chamber.state === 'SELF_EXTINGUISHED') {
    const residual = Math.max(0, (tcTemps[0] - AMBIENT_CHAMBER_TEMP_K) / 600);
    const radFlux =
      flameScale > 0.002 || residual > 0.02
        ? Math.round(steady.radiativeHeatFluxWm2 * flameScale + 3200 * residual)
        : 0;
    const convFlux =
      flameScale > 0.002 || residual > 0.02
        ? Math.round(steady.convectiveHeatFluxWm2 * flameScale + 1800 * residual)
        : 0;
    const maxTc = Math.max(...tcTemps);

    const quenchedDa = steady.isBurning
      ? computeDamkohlerDiagnostics({
          materialId: params.materialId,
          flowMode: params.flowMode,
          pressurePa: clamp(params.pressurePa, 30000, 120000),
          effectiveVelocityMs: steady.effectiveVelocityMs,
          forcedVelocityMs: clamp(params.flowVelocityMs, 0, 0.6),
          blowoffLimitMs: resolveDuctHardware(params).wakeBaffle ? 0.48 : 0.38,
          peakFlameTempK: AMBIENT_CHAMBER_TEMP_K + 45,
          ambientTempK: AMBIENT_CHAMBER_TEMP_K,
          loiMarginPercent: steady.loiMarginPercent,
          isBurning: false,
        })
      : null;

    return {
      ...steady,
      regime: steady.isBurning ? 'Quenched' : steady.regime,
      chamberState: 'SELF_EXTINGUISHED',
      stateElapsedS: elapsed,
      igniterPowerW: 0,
      overloadActive: false,
      overloadIntensity: 0,
      pyrolysisFactor: 0,
      flameScale,
      thermocoupleTempsK: tcTemps,
      elapsedTimeS,
      burnLengthMm,
      testVerdict,
      flameSpreadRateMs: 0,
      damkohlerNumber: quenchedDa ? quenchedDa.damkohlerNumber : steady.damkohlerNumber,
      tauFlowS: quenchedDa ? quenchedDa.tauFlowS : steady.tauFlowS,
      tauChemS: quenchedDa ? quenchedDa.tauChemS : steady.tauChemS,
      reactionZoneTempK: quenchedDa ? quenchedDa.reactionZoneTempK : steady.reactionZoneTempK,
      peakFlameTempK: Math.max(
        maxTc,
        AMBIENT_CHAMBER_TEMP_K + (steady.peakFlameTempK - AMBIENT_CHAMBER_TEMP_K) * flameScale,
      ),
      radiativeHeatFluxWm2: radFlux,
      convectiveHeatFluxWm2: convFlux,
      totalHeatFluxWm2: radFlux + convFlux,
      flameGeometry: {
        ...steady.flameGeometry,
        plumeLengthM: steady.flameGeometry.plumeLengthM * flameScale,
        plumeRadiusM: steady.flameGeometry.plumeRadiusM * (0.35 + 0.65 * flameScale),
        sootIntensity: steady.flameGeometry.sootIntensity * flameScale,
        blueZoneRatio: steady.flameGeometry.blueZoneRatio,
        extinctionFactor: steady.flameGeometry.extinctionFactor * flameScale,
      },
      isBurning: false,
    };
  }

  // SUSTAINED_BURN: smooth flameScale growth + optional +80 W thermal overload surge
  const overloadActive =
    chamber.overloadElapsedS !== null && chamber.overloadElapsedS < IGNITION_PULSE_DURATION_S;
  const overloadIntensity = overloadActive
    ? Math.pow(clamp(1 - (chamber.overloadElapsedS as number) / IGNITION_PULSE_DURATION_S, 0, 1), 1.35)
    : 0;

  const spreadBoost = 1 + 0.35 * overloadIntensity;
  const radFlux = Math.round(
    steady.radiativeHeatFluxWm2 * (0.55 + 0.45 * flameScale) + 18000 * overloadIntensity,
  );
  const convFlux = Math.round(
    steady.convectiveHeatFluxWm2 * (0.55 + 0.45 * flameScale) + 12000 * overloadIntensity,
  );
  const peakTemp =
    AMBIENT_CHAMBER_TEMP_K +
    (steady.peakFlameTempK - AMBIENT_CHAMBER_TEMP_K) * (0.55 + 0.45 * flameScale) +
    220 * overloadIntensity;

  return {
    ...steady,
    chamberState: 'SUSTAINED_BURN',
    stateElapsedS: elapsed,
    igniterPowerW: overloadActive ? Math.round(IGNITER_JOULE_POWER_W * overloadIntensity) : 0,
    overloadActive,
    overloadIntensity,
    pyrolysisFactor: clamp(flameScale + 0.35 * overloadIntensity, 0.35, 1.35),
    flameScale,
    thermocoupleTempsK: tcTemps,
    elapsedTimeS,
    burnLengthMm,
    testVerdict,
    flameSpreadRateMs: steady.flameSpreadRateMs * clamp((flameScale - 0.15) / 0.85, 0.15, 1.0) * spreadBoost,
    peakFlameTempK: peakTemp,
    radiativeHeatFluxWm2: radFlux,
    convectiveHeatFluxWm2: convFlux,
    totalHeatFluxWm2: radFlux + convFlux,
    flameGeometry: {
      ...steady.flameGeometry,
      plumeLengthM: steady.flameGeometry.plumeLengthM * flameScale * (1 + 0.16 * overloadIntensity),
      plumeRadiusM:
        steady.flameGeometry.plumeRadiusM * (0.45 + 0.55 * flameScale) * (1 + 0.1 * overloadIntensity),
      sootIntensity: steady.flameGeometry.sootIntensity * smoothstep01((flameScale - 0.2) / 0.65),
    },
    isBurning: true,
  };
}

/**
 * Matches current simulation parameters and physical outcome to the closest reference scenario
 * or in-scope solid-fuel benchmark run, returning the similarity score and component breakdown.
 */
export function matchClosestExperiment(
  params: SimulationParams,
  experiments: NasaPsiExperiment[],
  telemetry?: Pick<ThermoTelemetry, 'isBurning' | 'flameSpreadRateMs'>,
  options?: { inScopeSolidOnly?: boolean },
): MatchedExperimentResult {
  const pool = options?.inScopeSolidOnly
    ? getInScopeSolidExperiments(experiments)
    : experiments;

  if (pool.length === 0) {
    throw new Error('NASA PSI experiment dataset must not be empty');
  }

  const evalTel = telemetry ?? computeSteadyThermo(params);
  const currentGeometry = resolveSpecimenGeometry(params);

  let bestExp = pool[0];
  let bestDist = Infinity;
  let bestBreakdown: MatchScoreBreakdown = {
    inputDistance: 0,
    geometryPenalty: 0,
    outcomePenalty: 0,
    spreadRateErrorPenalty: 0,
    totalDistance: 0,
  };

  for (const exp of pool) {
    const dMaterial = exp.materialId === params.materialId ? 0 : 1.35;
    const dO2 = Math.abs(exp.o2Percent - params.o2Percent) / 7.0;
    const dFlow = Math.abs(exp.flowVelocityMs - params.flowVelocityMs) / 0.10;
    const dGrav = Math.abs(exp.gravityMs2 - params.gravityMs2) / 3.5;
    const dPress = Math.abs(exp.pressurePa - params.pressurePa) / 30000;
    const dMode = exp.flowMode === params.flowMode ? 0 : 0.45;

    const inputDistSq =
      dMaterial * dMaterial * 1.4 +
      dO2 * dO2 * 1.5 +
      dFlow * dFlow * 1.8 +
      dGrav * dGrav * 1.6 +
      dPress * dPress * 0.7 +
      dMode * dMode;
    const inputDistance = Math.sqrt(inputDistSq);

    const expGeometry: SpecimenGeometry =
      exp.program === 'Saffire-II' ? 'sheet' : exp.program === 'FLEX' ? 'droplet' : 'rod';
    const dGeom = currentGeometry === expGeometry ? 0 : 0.6;

    const expSustainedBurn =
      exp.observedSpreadRateMmS !== null
        ? exp.observedSpreadRateMmS > 0
        : (exp.observedBurnLengthMm ?? 0) > NASA_STD_BURN_LIMIT_MM;
    const dOutcome = expSustainedBurn !== evalTel.isBurning ? 1.8 : 0;

    const dSpread =
      exp.observedSpreadRateMmS !== null
        ? (Math.abs(exp.observedSpreadRateMmS - evalTel.flameSpreadRateMs * 1000) /
            Math.max(2.0, exp.observedSpreadRateMmS)) *
          0.7
        : 0;

    const dist = Math.sqrt(
      inputDistSq + dGeom * dGeom + dOutcome * dOutcome + dSpread * dSpread,
    );

    if (dist < bestDist) {
      bestDist = dist;
      bestExp = exp;
      bestBreakdown = {
        inputDistance,
        geometryPenalty: dGeom,
        outcomePenalty: dOutcome,
        spreadRateErrorPenalty: dSpread,
        totalDistance: dist,
      };
    }
  }

  const similarityScore = clamp(Math.round(100 * Math.exp(-bestDist * 0.42)), 12, 99);
  return {
    experiment: bestExp,
    similarityScore,
    scoreBreakdown: bestBreakdown,
  };
}
