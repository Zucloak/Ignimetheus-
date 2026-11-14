import {
  MATERIALS,
  resolveDuctHardware,
  resolveSpecimenGeometry,
  SPECIMEN_GEOMETRIES,
  type MatchedExperimentResult,
  type SimulationParams,
  type ThermoTelemetry,
} from './thermoCore';
import {
  measureCaliperMm,
  sampleDuctFieldAtMm,
  type CadMarker,
} from './ductProbes';
import {
  formatGravity,
  formatHeatFlux,
  formatPressure,
  formatSpreadRate,
  formatTemperature,
  formatVelocity,
  type UnitSystem,
} from './units';

export interface SafetyRecommendation {
  hazardLevel: 'NOMINAL' | 'ELEVATED' | 'CRITICAL' | 'EXTINGUISHED';
  summary: string;
  hvacAction: string;
  atmosphereAction: string;
  suppressantProtocol: string;
  nasaReferenceNote: string;
  rawText: string;
}

export interface SafetyReasoningStep {
  id: string;
  label: string;
  detail: string;
}

/**
 * Generates ordered, telemetry-grounded reasoning steps for the Safety Officer
 * ThoughtLine trace without touching DOM or React state.
 */
export function buildSafetyReasoningSteps(
  params: SimulationParams,
  telemetry: ThermoTelemetry,
  matched: MatchedExperimentResult,
  unitSystem: UnitSystem,
  kind: 'diagnostic' | 'chat',
  markers: CadMarker[] = [],
  backendLabel = 'Verified Telemetry Engine',
): SafetyReasoningStep[] {
  const mat = MATERIALS[params.materialId];
  const geom = SPECIMEN_GEOMETRIES[resolveSpecimenGeometry(params)];
  const hw = resolveDuctHardware(params);
  const exp = matched.experiment;
  const press = formatPressure(params.pressurePa, unitSystem);
  const vel = formatVelocity(telemetry.effectiveVelocityMs, unitSystem);
  const spread = formatSpreadRate(telemetry.flameSpreadRateMs, unitSystem);

  const activeHw: string[] = [];
  if (hw.wakeBaffle) activeHw.push('Wake Baffle');
  if (hw.flameArrestor) {
    activeHw.push(telemetry.arrestorOverwhelmed ? 'Arrestor Overwhelmed' : 'Flame Arrestor');
  }
  if (hw.inertNozzle) {
    activeHw.push(telemetry.n2DischargeActive ? 'N2 Purge Active' : 'N2 Nozzle Armed');
  }

  return [
    {
      id: 'step-atmos',
      label: `Sampling ${mat.shortName} (${geom.shortLabel}) at ${telemetry.effectiveO2Percent.toFixed(1)}% O2 & ${press.text} ${press.unit}`,
      detail: `Effective LOI ${telemetry.effectiveLoiPercent.toFixed(1)}% (margin ${telemetry.loiMarginPercent >= 0 ? '+' : ''}${telemetry.loiMarginPercent.toFixed(1)}%) · ppO2 ${(telemetry.o2PartialPressurePa / 1000).toFixed(1)} kPa`,
    },
    {
      id: 'step-flow',
      label: `Resolving ${telemetry.regime} & Extinction-Proximity Index (Da*) residence bounds`,
      detail: `V_eff=${vel.text} ${vel.unit} · Da=${telemetry.damkohlerNumber.toFixed(2)} · Re=${Math.round(telemetry.reynoldsDuct)}${activeHw.length > 0 ? ` · ${activeHw.join(', ')}` : ''}`,
    },
    {
      id: 'step-psi',
      label: `Cross-referencing reference scenario ${exp.id} (${matched.similarityScore}% match)`,
      detail:
        exp.observedSpreadRateMmS !== null
          ? `Baseline spread ${exp.observedSpreadRateMmS.toFixed(2)} mm/s vs. live ${spread.text} ${spread.unit}`
          : `Screening criterion (<= 152 mm burn) vs. live ${spread.text} ${spread.unit}`,
    },
    {
      id: 'step-protocol',
      label:
        kind === 'diagnostic'
          ? 'Synthesizing ECLSS damper & suppressant protocol'
          : 'Synthesizing grounded telemetry response',
      detail: `${markers.length} active CAD marker${markers.length === 1 ? '' : 's'} · ${backendLabel}`,
    },
  ];
}

/**
 * Generates a deterministic, grounded fire-safety protocol directly from
 * computed thermo-fluids telemetry and the matched reference scenario.
 * Serves both as the zero-latency baseline and the Telemetry Snapshot Fallback.
 */
export function buildVerifiedSafetySnapshot(
  params: SimulationParams,
  telemetry: ThermoTelemetry,
  matched: MatchedExperimentResult,
  unitSystem: UnitSystem,
): SafetyRecommendation {
  const mat = MATERIALS[params.materialId];
  const exp = matched.experiment;
  const velStr = `${formatVelocity(params.flowVelocityMs, unitSystem).text} ${formatVelocity(params.flowVelocityMs, unitSystem).unit}`;
  const pressStr = `${formatPressure(params.pressurePa, unitSystem).text} ${formatPressure(params.pressurePa, unitSystem).unit}`;
  const spreadStr = `${formatSpreadRate(telemetry.flameSpreadRateMs, unitSystem).text} ${formatSpreadRate(telemetry.flameSpreadRateMs, unitSystem).unit}`;
  const fluxStr = `${formatHeatFlux(telemetry.totalHeatFluxWm2, unitSystem).text} ${formatHeatFlux(telemetry.totalHeatFluxWm2, unitSystem).unit}`;
  const tempStr = `${formatTemperature(telemetry.peakFlameTempK, unitSystem).text} ${formatTemperature(telemetry.peakFlameTempK, unitSystem).unit}`;
  const gravStr = `${formatGravity(params.gravityMs2, unitSystem).text} ${formatGravity(params.gravityMs2, unitSystem).unit}`;

  let hazardLevel: SafetyRecommendation['hazardLevel'] = 'NOMINAL';
  if (telemetry.chamberState === 'STANDBY') {
    hazardLevel = 'NOMINAL';
  } else if (telemetry.chamberState === 'IGNITING') {
    hazardLevel = 'ELEVATED';
  } else if (telemetry.chamberState === 'SELF_EXTINGUISHED') {
    hazardLevel = 'EXTINGUISHED';
  } else if (telemetry.regime === 'Critical Runaway') {
    hazardLevel = 'CRITICAL';
  } else if (telemetry.regime === 'Ventilation-Driven Spread') {
    hazardLevel = 'ELEVATED';
  } else if (telemetry.regime === 'Quenched' || telemetry.regime === 'Blow-Off Extinction') {
    hazardLevel = 'EXTINGUISHED';
  } else {
    hazardLevel = 'NOMINAL';
  }

  const isMicrogravity = params.gravityMs2 < 0.5;
  const isModerateFlow = params.flowVelocityMs >= 0.03 && params.flowVelocityMs <= 0.35;

  let summary = '';
  let hvacAction = '';
  let atmosphereAction = '';
  let suppressantProtocol = '';

  if (telemetry.chamberState === 'STANDBY') {
    summary = `Chamber STANDBY on unignited ${mat.shortName} at ${params.o2Percent.toFixed(1)}% O2 (${pressStr}, ${velStr} ${params.flowMode}, ${gravStr}). Ambient baseline ${tempStr}, 0 W/m2 heat flux.`;
    hvacAction =
      telemetry.loiMarginPercent > 0
        ? `Caution: ${params.o2Percent.toFixed(1)}% O2 exceeds effective LOI (${telemetry.effectiveLoiPercent.toFixed(1)}%). Reducing ${velStr} ventilation before ignition prevents convective spread.`
        : `Chamber conditions remain below effective LOI (${telemetry.effectiveLoiPercent.toFixed(1)}%); HVAC circulation nominal.`;
    atmosphereAction = `Prepared at ${params.o2Percent.toFixed(1)}% O2 and ${pressStr}. Click Pulse Igniter (80 W hot wire) to test ignition threshold.`;
    suppressantProtocol =
      'Chamber unignited; handheld CO2 extinguisher staged at rack bulkhead during ignition trials.';
  } else if (telemetry.chamberState === 'IGNITING') {
    summary = `80 W hot-wire Joule ignition transient active on ${mat.shortName} (${telemetry.stateElapsedS.toFixed(1)}s / 3.5s). Upstream TC-1 spiked to ${tempStr} with ${fluxStr} local pyrolysis flux.`;
    hvacAction =
      telemetry.loiMarginPercent > 0
        ? `Monitor forced flow (${velStr}): positive LOI margin (+${telemetry.loiMarginPercent.toFixed(1)}%) will transition to sustained spread once coil cuts off unless fans are tripped.`
        : `Current flow (${velStr}) and O2 margin (${telemetry.loiMarginPercent.toFixed(1)}%) are predicted to self-extinguish after the 3.5s coil pulse.`;
    atmosphereAction = `Local O2 partial pressure is ${(telemetry.o2PartialPressurePa / 1000).toFixed(1)} kPa vs ${telemetry.effectiveLoiPercent.toFixed(1)}% effective LOI.`;
    suppressantProtocol =
      'Hold suppressant until 3.5s ignition pulse finishes unless pyrolysis plume accelerates downstream past TC-2.';
  } else if (telemetry.chamberState === 'SELF_EXTINGUISHED') {
    summary = `Self-Extinguished (Below Flammability Limit) on ${mat.shortName} at ${params.o2Percent.toFixed(1)}% O2, ${velStr}, ${gravStr}. Flame extinguished; thermocouples decaying toward ambient (${tempStr}).`;
    hvacAction =
      'Maintain current HVAC state or isolate return HEPA loop while residual pyrolysis gases clear.';
    atmosphereAction = `Cabin atmosphere (${params.o2Percent.toFixed(1)}% O2, ${pressStr}) and flow (${velStr}) failed to sustain propagation (effective LOI ${telemetry.effectiveLoiPercent.toFixed(1)}%).`;
    suppressantProtocol =
      'No discharge required; confirm TC-1 through TC-6 decay below vaporization threshold before re-pulsing.';
  } else if (telemetry.regime === 'Critical Runaway') {
    summary = `Critical flame runaway on ${mat.shortName} at ${params.o2Percent.toFixed(1)}% O2 (${pressStr}, ${gravStr}). Spread rate ${spreadStr} with ${fluxStr} heat flux and ${tempStr} peak flame${telemetry.overloadActive ? ' (+80 W thermal overload surge active)' : ''}.`;
    hvacAction =
      'Command immediate HVAC rack/module damper isolation and fan trip to 0 cm/s to starve convective O2 transport.';
    atmosphereAction = `Initiate N2 cabin bleed to reduce O2 concentration below ${telemetry.effectiveLoiPercent.toFixed(1)}% effective LOI (current margin +${telemetry.loiMarginPercent.toFixed(1)}% O2).`;
    suppressantProtocol =
      'Deploy handheld CO2 or fine water-mist extinguisher after fan shutdown; require crew breathing masks for toxic pyrolysis products.';
  } else if (telemetry.regime === 'Ventilation-Driven Spread') {
    summary = `Sustained ventilation-driven spread on ${mat.shortName} (${spreadStr}) at ${velStr} ${params.flowMode} flow in ${gravStr}${telemetry.overloadActive ? ' (+80 W thermal overload surge active)' : ''}.`;
    hvacAction = isMicrogravity && isModerateFlow
      ? `Close compartment supply/return dampers immediately: ${velStr} forced flow thins the boundary layer and sustains spread in 0g.`
      : 'Secure local avionics cooling loop and switch cabin circulation to recirculation-bypass mode.';
    atmosphereAction = `Depressurize or dilute O2 partial pressure below ${(telemetry.effectiveLoiPercent).toFixed(1)}% LOI threshold if isolation fails.`;
    suppressantProtocol =
      'Target flame base with CO2 suppressant post-damper closure; monitor IR/CO sensors for smoldering re-ignition.';
  } else if (telemetry.regime === 'Radiative Spherical') {
    summary = `Low-momentum radiative spherical flamelet (${tempStr}, ${fluxStr}) near quenching threshold at ${velStr} in ${gravStr}.`;
    hvacAction =
      'Maintain HVAC fans OFF (0 cm/s). Do not restore ventilation until thermocouple grid confirms full thermal decay.';
    atmosphereAction = `Keep O2 nominal or trim below ${telemetry.effectiveLoiPercent.toFixed(1)}% LOI; avoid sudden cabin pressure spikes.`;
    suppressantProtocol =
      'Allow radiative quenching to proceed while keeping CO2 extinguisher staged; rapid airflow surge would re-ignite soot/char.';
  } else if (telemetry.regime === 'Blow-Off Extinction') {
    summary = `Convective blow-off extinction achieved at ${velStr} (Da=${telemetry.damkohlerNumber.toFixed(2)}); reaction residence time insufficient for flame attachment.`;
    hvacAction =
      'Transition carefully from high-velocity purge to damper isolation to avoid transporting hot embers downstream.';
    atmosphereAction = `Maintain O2 <= ${params.o2Percent.toFixed(1)}% at ${pressStr}; verify zero CO/particulate rebound.`;
    suppressantProtocol =
      'Verify surface temperature drops below vaporization threshold before opening return-air scrubbers.';
  } else {
    summary = `Self-extinguishing / quenched state on ${mat.shortName} (LOI margin ${telemetry.loiMarginPercent.toFixed(1)}% O2 at ${gravStr}).`;
    hvacAction =
      'Maintain nominal cabin air-exchange monitoring; verify HEPA/charcoal scrubber differential pressure.';
    atmosphereAction = `Cabin atmosphere (${params.o2Percent.toFixed(1)}% O2, ${pressStr}) remains below effective flammability limit (${telemetry.effectiveLoiPercent.toFixed(1)}% O2).`;
    suppressantProtocol =
      'No active agent discharge required; log thermal transient and inspect sample surface for char integrity.';
  }

  const burnSummary =
    exp.observedBurnLengthMm !== null
      ? `${exp.observedBurnLengthMm} mm burn`
      : `Coupon: ${exp.sampleLengthMm ?? 940} × ${exp.sampleWidthMm ?? 406} mm (burn length unverified)`;
  const spreadSummary =
    exp.observedSpreadRateMmS !== null
      ? `at ${exp.observedSpreadRateMmS.toFixed(2)} mm/s`
      : '(Pass/Fail Criterion <= 152 mm)';
  const nasaReferenceNote = `Closest Reference Scenario (Adapted): ${exp.id} (${exp.psiCitation}) — Reference Baseline: ${burnSummary} ${spreadSummary} (Pending raw PSI check). ${exp.discrepancyNote1gVsUg}`;

  const rawText = [
    `STATUS: ${hazardLevel} (${telemetry.regime})`,
    `DIAGNOSIS: ${summary}`,
    `HVAC: ${hvacAction}`,
    `ATMOS: ${atmosphereAction}`,
    `SUPPRESSION: ${suppressantProtocol}`,
    `NASA PSI CITATION: ${nasaReferenceNote}`,
  ].join('\n');

  return {
    hazardLevel,
    summary,
    hvacAction,
    atmosphereAction,
    suppressantProtocol,
    nasaReferenceNote,
    rawText,
  };
}

export const NUMERIC_GUARDRAIL_INSTRUCTION =
  'CRITICAL RULE: Use ONLY numbers present in the telemetry snapshot. Never invent, extrapolate, or alter numeric values.';

export function buildWebLlmPrompt(
  params: SimulationParams,
  telemetry: ThermoTelemetry,
  matched: MatchedExperimentResult,
  unitSystem: UnitSystem,
): string {
  const mat = MATERIALS[params.materialId];
  const exp = matched.experiment;
  const vel = formatVelocity(params.flowVelocityMs, unitSystem);
  const press = formatPressure(params.pressurePa, unitSystem);
  const spread = formatSpreadRate(telemetry.flameSpreadRateMs, unitSystem);
  const flux = formatHeatFlux(telemetry.totalHeatFluxWm2, unitSystem);

  return [
    'You are an onboard Spacecraft Fire Safety Officer. Provide concise, non-decorative, deterministic engineering fire-suppression actions.',
    `Do not use emojis or speculative prose. Cite the exact NASA PSI experiment ID provided. ${NUMERIC_GUARDRAIL_INSTRUCTION}`,
    `Telemetry: Material=${mat.name}, O2=${params.o2Percent.toFixed(1)}%, Pressure=${press.text} ${press.unit}, Flow=${vel.text} ${vel.unit} (${params.flowMode}), Gravity=${params.gravityMs2.toFixed(2)} m/s2.`,
    `Computed Regime=${telemetry.regime}, SpreadRate=${spread.text} ${spread.unit}, EffectiveLOI=${telemetry.effectiveLoiPercent.toFixed(1)}%, ExtinctionIndexDaStar=${telemetry.damkohlerNumber.toFixed(2)}, TotalHeatFlux=${flux.text} ${flux.unit}.`,
    `Closest Reference Scenario (Adapted): ${exp.id} (${exp.psiCitation}) — ${exp.discrepancyNote1gVsUg}`,
    'Respond with 4 short labeled lines: HVAC:, ATMOS:, SUPPRESSION:, NASA_REF:.',
  ].join('\n');
}

export function buildLiveContextSystemPrompt(
  params: SimulationParams,
  telemetry: ThermoTelemetry,
  matched: MatchedExperimentResult,
  unitSystem: UnitSystem,
): string {
  const mat = MATERIALS[params.materialId];
  const exp = matched.experiment;
  const vel = formatVelocity(params.flowVelocityMs, unitSystem);
  const press = formatPressure(params.pressurePa, unitSystem);
  const spread = formatSpreadRate(telemetry.flameSpreadRateMs, unitSystem);
  const grav = formatGravity(params.gravityMs2, unitSystem);
  const temp = formatTemperature(telemetry.peakFlameTempK, unitSystem);
  const flux = formatHeatFlux(telemetry.totalHeatFluxWm2, unitSystem);
  const obsBurnNote =
    exp.observedBurnLengthMm !== null
      ? `${exp.observedBurnLengthMm}mm burn`
      : `Coupon: ${exp.sampleLengthMm ?? 940}x${exp.sampleWidthMm ?? 406}mm (burn length unverified)`;
  const obsSpreadNote =
    exp.observedSpreadRateMmS !== null
      ? `at ${exp.observedSpreadRateMmS.toFixed(2)}mm/s`
      : '(Pass/Fail Criterion <= 152mm)';

  return [
    'You are an onboard Spacecraft AI Fire Safety Officer inside a precision microgravity combustion console.',
    `Rules: Zero emojis. Be concise, technical, and always reference the live chamber values and closest reference run ID below. ${NUMERIC_GUARDRAIL_INSTRUCTION}`,
    `LIVE CHAMBER: Material=${mat.name} (${mat.shortName}), O2=${params.o2Percent.toFixed(1)}%, Pressure=${press.text} ${press.unit}, HVAC_Velocity=${vel.text} ${vel.unit} (${params.flowMode}), Gravity=${grav.text} ${grav.unit}.`,
    `LIVE TELEMETRY: ChamberState=${telemetry.chamberState} (Igniter=${telemetry.igniterPowerW}W), Regime=${telemetry.regime}, SpreadRate=${spread.text} ${spread.unit}, EffectiveLOI=${telemetry.effectiveLoiPercent.toFixed(1)}% (1g LOI=${mat.loi1gPercent.toFixed(1)}%), LOI_Margin=${telemetry.loiMarginPercent.toFixed(1)}%, ExtinctionIndexDaStar=${telemetry.damkohlerNumber.toFixed(2)}, PeakTemp=${temp.text} ${temp.unit}, HeatFlux=${flux.text} ${flux.unit}.`,
    `CLOSEST REFERENCE SCENARIO (ADAPTED): ${exp.id} (${exp.program}) — ${exp.psiCitation}. Reference Baseline: ${obsBurnNote} ${obsSpreadNote}. Note: ${exp.discrepancyNote1gVsUg}`,
  ].join('\n');
}

export function buildTieredSystemPrompt(
  params: SimulationParams,
  telemetry: ThermoTelemetry,
  matched: MatchedExperimentResult,
  unitSystem: UnitSystem,
  budget: 'compact' | 'standard' | 'full' = 'full',
): string {
  if (budget === 'full') {
    return buildLiveContextSystemPrompt(params, telemetry, matched, unitSystem);
  }

  const mat = MATERIALS[params.materialId];
  const exp = matched.experiment;
  const vel = formatVelocity(params.flowVelocityMs, unitSystem);
  const spread = formatSpreadRate(telemetry.flameSpreadRateMs, unitSystem);

  if (budget === 'compact') {
    return [
      `Spacecraft Fire Safety Officer. Zero emojis. ${NUMERIC_GUARDRAIL_INSTRUCTION}`,
      `CHAMBER: ${mat.shortName}, O2=${params.o2Percent.toFixed(1)}%, V=${vel.text}${vel.unit} (${params.flowMode}), g=${params.gravityMs2.toFixed(2)}m/s2.`,
      `STATE: ${telemetry.regime}, Vf=${spread.text}${spread.unit}, LOI_eff=${telemetry.effectiveLoiPercent.toFixed(1)}%, Da*=${telemetry.damkohlerNumber.toFixed(2)}, Ref=${exp.id}.`,
    ].join('\n');
  }

  const press = formatPressure(params.pressurePa, unitSystem);
  const temp = formatTemperature(telemetry.peakFlameTempK, unitSystem);
  return [
    `You are an onboard Spacecraft Fire Safety Officer. Zero emojis. ${NUMERIC_GUARDRAIL_INSTRUCTION}`,
    `CHAMBER: ${mat.name} (${mat.shortName}), O2=${params.o2Percent.toFixed(1)}%, P=${press.text} ${press.unit}, Flow=${vel.text} ${vel.unit} (${params.flowMode}), g=${params.gravityMs2.toFixed(2)} m/s2.`,
    `TELEMETRY: State=${telemetry.chamberState}, Regime=${telemetry.regime}, Spread=${spread.text} ${spread.unit}, EffLOI=${telemetry.effectiveLoiPercent.toFixed(1)}% (Margin=${telemetry.loiMarginPercent.toFixed(1)}%), Da*=${telemetry.damkohlerNumber.toFixed(2)}, PeakT=${temp.text} ${temp.unit}.`,
    `REFERENCE: ${exp.id} (${exp.program}) — ${exp.psiCitation}.`,
  ].join('\n');
}

/**
 * Pre-LLM Out-of-Scope Router (`Not modeled`).
 * Intercepts queries asking for unmodeled quantities (toxic gas/CO/HCN ppm, crew evacuation
 * time, cabin depressurization time, flight hardware certification, electrical arc energy in mJ,
 * or 3D soot concentration) before `quickRuleMatch` or WebLLM is ever called.
 */
export function checkOutOfScopeQuery(
  question: string,
  params: SimulationParams,
  telemetry: ThermoTelemetry,
  matched: MatchedExperimentResult,
  unitSystem: UnitSystem,
): string | null {
  const q = question.toLowerCase().trim();
  if (!q) return null;

  const isToxicGasPpm =
    /\b(?:toxic|toxicity|hcn|hydrogen cyanide|cyanide|carbon monoxide|co\s*ppm|hcl|hf|phosgene|ppm|idlh|twa)\b/.test(
      q,
    );
  const isEvacuationTime =
    /\b(?:evacuat(?:e|ion)|egress\s*time|crew\s*escape|abandon\s*module|time\s*to\s*evacuate)\b/.test(
      q,
    );
  const isDepressurizationTime =
    /\b(?:depressuriz(?:e|ation)\s*time|time\s*to\s*depressurize|vacuum\s*vent\s*time|bleed\s*down\s*time|cabin\s*vent\s*duration)\b/.test(
      q,
    );
  const isFlightCertification =
    /\b(?:certif(?:y|ied|ication)|flight[-\s]*qualif(?:y|ied|ication)|waiver\s*approval|sign[-\s]*off|formally\s*approved\s*for\s*flight)\b/.test(
      q,
    );
  const isElectricalArcEnergy =
    /\b(?:arc\s*energy|spark\s*energy|millijoule|mj\b|dielectric\s*breakdown\s*voltage|short[-\s]*circuit\s*current)\b/.test(
      q,
    );
  const is3dSootField =
    /\b(?:3d\s*soot|soot\s*concentration|soot\s*volume\s*fraction|particulate\s*mass\s*density|optical\s*obscuration\s*meter)\b/.test(
      q,
    );

  if (
    !isToxicGasPpm &&
    !isEvacuationTime &&
    !isDepressurizationTime &&
    !isFlightCertification &&
    !isElectricalArcEnergy &&
    !is3dSootField
  ) {
    return null;
  }

  const unmodeledTopics: string[] = [];
  if (isToxicGasPpm) unmodeledTopics.push('toxic gas species yields (CO/HCN/HCl ppm)');
  if (isEvacuationTime) unmodeledTopics.push('crew egress / module evacuation timelines');
  if (isDepressurizationTime) unmodeledTopics.push('cabin depressurization valve bleed-down times');
  if (isFlightCertification) unmodeledTopics.push('formal flight hardware certification / waiver sign-off');
  if (isElectricalArcEnergy) unmodeledTopics.push('electrical arc ignition energy (mJ)');
  if (is3dSootField) unmodeledTopics.push('3D soot volume fraction / particulate obscuration fields');

  const mat = MATERIALS[params.materialId];
  const spread = formatSpreadRate(telemetry.flameSpreadRateMs, unitSystem);
  const flux = formatHeatFlux(telemetry.totalHeatFluxWm2, unitSystem);

  return [
    `**Not modeled in this 1D thermo-fluids solver**`,
    `- Requested quantity (${unmodeledTopics.join(', ')}) is outside the scope of the 1D opposed/concurrent boundary-layer flame spread and thermal-inertia model.`,
    `- Modeled live telemetry for ${mat.shortName}: Regime=${telemetry.regime}, Spread=${spread.text} ${spread.unit}, Effective LOI=${telemetry.effectiveLoiPercent.toFixed(1)}% (Margin ${telemetry.loiMarginPercent >= 0 ? '+' : ''}${telemetry.loiMarginPercent.toFixed(1)}%), Total Heat Flux=${flux.text} ${flux.unit}, Closest Reference=${matched.experiment.id}.`,
  ].join('\n');
}

export interface NumericAuditResult {
  passed: boolean;
  extractedNumbers: number[];
  rejectedNumbers: number[];
}

export const FIXED_AUDIT_REFERENCE_CONSTANTS = [
  0, 1, 2, 3, 4, 300, 120, 400, 6001, 152.4, 152, 450, 280, 32, 8, 5, 3.5, 80, 55, 940, 406,
] as const;

/**
 * Collects all numeric values legitimately present in the live telemetry snapshot
 * (plus fixed reference constants) so WebLLM output can be strictly audited.
 */
export function buildAllowedTelemetryNumberSet(
  params: SimulationParams,
  telemetry: ThermoTelemetry,
  matched: MatchedExperimentResult,
  unitSystem: UnitSystem,
  markers: CadMarker[] = [],
): number[] {
  const mat = MATERIALS[params.materialId];
  const exp = matched.experiment;

  const velFmt = formatVelocity(params.flowVelocityMs, unitSystem);
  const effVelFmt = formatVelocity(telemetry.effectiveVelocityMs, unitSystem);
  const pressFmt = formatPressure(params.pressurePa, unitSystem);
  const spreadFmt = formatSpreadRate(telemetry.flameSpreadRateMs, unitSystem);
  const gravFmt = formatGravity(params.gravityMs2, unitSystem);
  const tempFmt = formatTemperature(telemetry.peakFlameTempK, unitSystem);
  const totalFluxFmt = formatHeatFlux(telemetry.totalHeatFluxWm2, unitSystem);
  const radFluxFmt = formatHeatFlux(telemetry.radiativeHeatFluxWm2, unitSystem);
  const convFluxFmt = formatHeatFlux(telemetry.convectiveHeatFluxWm2, unitSystem);

  const candidates: number[] = [
    ...FIXED_AUDIT_REFERENCE_CONSTANTS,
    params.o2Percent,
    telemetry.effectiveO2Percent,
    params.pressurePa,
    params.pressurePa / 1000,
    Number(pressFmt.text),
    params.flowVelocityMs,
    params.flowVelocityMs * 100,
    Number(velFmt.text),
    telemetry.effectiveVelocityMs,
    telemetry.effectiveVelocityMs * 100,
    Number(effVelFmt.text),
    params.gravityMs2,
    params.gravityMs2 / 9.80665,
    Number(gravFmt.text),
    telemetry.flameSpreadRateMs,
    telemetry.flameSpreadRateMs * 1000,
    Number(spreadFmt.text),
    telemetry.effectiveLoiPercent,
    mat.loi1gPercent,
    mat.loiUgMinPercent,
    telemetry.loiMarginPercent,
    Math.abs(telemetry.loiMarginPercent),
    Math.abs(mat.loi1gPercent - telemetry.effectiveLoiPercent),
    telemetry.o2PartialPressurePa,
    telemetry.o2PartialPressurePa / 1000,
    telemetry.damkohlerNumber,
    telemetry.reynoldsDuct,
    Math.round(telemetry.reynoldsDuct),
    telemetry.peakFlameTempK,
    telemetry.peakFlameTempK - 273.15,
    Number(tempFmt.text),
    telemetry.totalHeatFluxWm2,
    telemetry.totalHeatFluxWm2 / 1000,
    Number(totalFluxFmt.text),
    telemetry.radiativeHeatFluxWm2,
    telemetry.radiativeHeatFluxWm2 / 1000,
    Number(radFluxFmt.text),
    telemetry.convectiveHeatFluxWm2,
    telemetry.convectiveHeatFluxWm2 / 1000,
    Number(convFluxFmt.text),
    telemetry.burnLengthMm,
    telemetry.elapsedTimeS,
    telemetry.stateElapsedS,
    telemetry.igniterPowerW,
    matched.similarityScore,
    exp.o2Percent,
    exp.pressurePa,
    exp.pressurePa / 1000,
    exp.flowVelocityMs,
    exp.flowVelocityMs * 100,
    exp.gravityMs2,
    exp.sampleThicknessMm,
    exp.sampleLengthMm ?? 940,
    exp.sampleWidthMm ?? 406,
  ];

  if (exp.observedSpreadRateMmS !== null) {
    candidates.push(exp.observedSpreadRateMmS);
  }
  if (exp.observedBurnLengthMm !== null) {
    candidates.push(exp.observedBurnLengthMm);
  }

  for (const tcK of telemetry.thermocoupleTempsK) {
    candidates.push(tcK, tcK - 273.15, Number(formatTemperature(tcK, unitSystem).text));
  }

  for (const m of markers) {
    if (m.kind === 'point') {
      const sampled = sampleDuctFieldAtMm(m.xMm, m.yMm, params, telemetry);
      candidates.push(
        sampled.xMm,
        sampled.yMm,
        sampled.localTempK,
        Number(formatTemperature(sampled.localTempK, unitSystem).text),
        sampled.localVelMs,
        Number(formatVelocity(sampled.localVelMs, unitSystem).text),
      );
    } else {
      const span = measureCaliperMm(m);
      candidates.push(span.distanceMm, span.dxMm, span.dyMm);
    }
  }

  return candidates.filter((v) => Number.isFinite(v));
}

/**
 * Post-LLM Strict Numeric Audit (`Local model (numbers audited)`).
 * Extracts every numeric token from the WebLLM response and verifies that every number
 * matches a value in the live telemetry snapshot (within displayed rounding tolerance,
 * plus fixed reference constants 0, 1, 300, 120, 400, 6001, 152.4).
 */
export function auditLlmNumbers(
  llmText: string,
  params: SimulationParams,
  telemetry: ThermoTelemetry,
  matched: MatchedExperimentResult,
  unitSystem: UnitSystem,
  markers: CadMarker[] = [],
): NumericAuditResult {
  // Strip chemical formulas, unit superscripts, and known run/sensor IDs before extracting numbers
  const scrubbed = llmText
    .replace(
      /\b(?:SAFFIRE-(?:I|II|III)-\d+|BASS-II-\d+|FLEX-\d+|STD-6001[A-Z0-9-]*|PSI-\d+|NTRS\s*20180005168|TC-[1-6]|P-\d+|D-\d+|HT90-40|O2|N2|CO2|H2O|ppO2|1D|3D)\b/gi,
      ' ',
    )
    .replace(/\b(?:m\/s2|m\/s²|cm2|cm²|m2|m²|ft2|ft²)\b/gi, ' ');

  const allowed = buildAllowedTelemetryNumberSet(params, telemetry, matched, unitSystem, markers);
  const matches = scrubbed.match(/(?<![A-Za-z])[+-]?\d+(?:\.\d+)?(?![A-Za-z])/g) ?? [];

  const extractedNumbers: number[] = [];
  const rejectedNumbers: number[] = [];

  for (const rawToken of matches) {
    const val = Number(rawToken);
    if (!Number.isFinite(val)) continue;
    extractedNumbers.push(val);

    const isMatched = allowed.some((ref) => {
      if (Math.abs(val - ref) <= 0.15) return true;
      if (Math.abs(val - Math.round(ref)) <= 1e-6) return true;
      if (Math.abs(Math.abs(val) - Math.abs(ref)) <= 0.15) return true;
      return false;
    });

    if (!isMatched) {
      rejectedNumbers.push(val);
    }
  }

  return {
    passed: rejectedNumbers.length === 0,
    extractedNumbers,
    rejectedNumbers,
  };
}

/**
 * Trims truncated LLM output (`finish_reason === 'length'`) back to the last complete sentence.
 */
export function trimToLastCompleteSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (/[.!?]$/.test(trimmed)) return trimmed;

  const lastPunctIdx = Math.max(
    trimmed.lastIndexOf('.'),
    trimmed.lastIndexOf('!'),
    trimmed.lastIndexOf('?'),
  );
  if (lastPunctIdx > 0) {
    return trimmed.slice(0, lastPunctIdx + 1).trim();
  }
  const lastNewlineIdx = trimmed.lastIndexOf('\n');
  if (lastNewlineIdx > 0) {
    return `${trimmed.slice(0, lastNewlineIdx).trim()}.`;
  }
  return `${trimmed}.`;
}

export const QUICK_SAFETY_QUESTIONS = [
  'Why does 0 cm/s quench in 0g?',
  'Compare with Earth 1g test',
  'Recommend suppression steps',
] as const;

/**
 * Fast-path deterministic telemetry rule matcher (0 ms / 0 GPU).
 * Matches standard telemetry queries (@TC-1..6, @P-1.., 0g vs 1g envelope comparison,
 * N2 suppression / Flame Arrestor mitigation, Orion / Artemis 34% O2, and Saffire / BASS-II
 * reference scenarios) and returns a grounded deterministic response immediately, or null
 * when the prompt requires open-ended inference.
 */
export function quickRuleMatch(
  question: string,
  params: SimulationParams,
  telemetry: ThermoTelemetry,
  matched: MatchedExperimentResult,
  unitSystem: UnitSystem,
  markers: CadMarker[] = [],
): string | null {
  const q = question.toLowerCase().trim();
  if (!q) return null;

  const mat = MATERIALS[params.materialId];
  const exp = matched.experiment;
  const vel = formatVelocity(params.flowVelocityMs, unitSystem);
  const press = formatPressure(params.pressurePa, unitSystem);
  const spread = formatSpreadRate(telemetry.flameSpreadRateMs, unitSystem);
  const grav = formatGravity(params.gravityMs2, unitSystem);
  const temp = formatTemperature(telemetry.peakFlameTempK, unitSystem);
  const radFlux = formatHeatFlux(telemetry.radiativeHeatFluxWm2, unitSystem);
  const convFlux = formatHeatFlux(telemetry.convectiveHeatFluxWm2, unitSystem);
  const expBurnClause =
    exp.observedBurnLengthMm !== null
      ? `${exp.observedBurnLengthMm} mm burn`
      : `Coupon: ${exp.sampleLengthMm ?? 940} × ${exp.sampleWidthMm ?? 406} mm (burn length unverified)`;
  const expSpreadClause =
    exp.observedSpreadRateMmS !== null
      ? `at ${exp.observedSpreadRateMmS.toFixed(2)} mm/s`
      : '(Pass/Fail Criterion <= 152 mm)';

  const probeMention = q.match(/@?(p-\d+|d-\d+)/);
  if (probeMention) {
    const targetId = probeMention[1].toUpperCase();
    const marker = markers.find((m) => m.id === targetId);
    if (marker && marker.kind === 'point') {
      const sampled = sampleDuctFieldAtMm(marker.xMm, marker.yMm, params, telemetry);
      const tFmt = formatTemperature(sampled.localTempK, unitSystem);
      const vFmt = formatVelocity(sampled.localVelMs, unitSystem);
      return [
        `**CAD Sensor Probe ${marker.id} Sampled Telemetry**`,
        `- Coordinates: X=${sampled.xMm.toFixed(1)} mm · Y=${sampled.yMm.toFixed(1)} mm along 450 mm quartz duct.`,
        `- Local Field: T=${tFmt.text}${tFmt.unit} · V=${vFmt.text} ${vFmt.unit} (${params.flowMode}, ${telemetry.chamberState}).`,
        `- Regime context: ${telemetry.regime} on ${mat.shortName} · Closest reference scenario (adapted) ${exp.id}.`,
      ].join('\n');
    }
    if (marker && marker.kind === 'caliper') {
      const span = measureCaliperMm(marker);
      return [
        `**CAD Caliper Marker ${marker.id} Measurement**`,
        `- Span: Distance=${span.distanceMm.toFixed(1)} mm (dX=${span.dxMm.toFixed(1)} mm, dY=${span.dyMm.toFixed(1)} mm).`,
        `- Reference: Current specimen burn length ${telemetry.burnLengthMm.toFixed(1)} mm vs 152 mm NASA-STD-6001 limit.`,
      ].join('\n');
    }
  }

  if (/@?tc-?1\.\.6|thermocouple|tc-1|tc-2|tc-3|tc-4|tc-5|tc-6/.test(q)) {
    const singleMatch = q.match(/tc-([1-6])/);
    const tcList = telemetry.thermocoupleTempsK
      .map((k, idx) => {
        const tf = formatTemperature(k, unitSystem);
        return `TC-${idx + 1}: ${tf.text}${tf.unit}`;
      })
      .join(' · ');
    const singleIdx = singleMatch ? Number(singleMatch[1]) - 1 : -1;
    const singleLine =
      singleIdx >= 0
        ? `- Focused sensor TC-${singleIdx + 1}: ${formatTemperature(telemetry.thermocoupleTempsK[singleIdx], unitSystem).text}${formatTemperature(telemetry.thermocoupleTempsK[singleIdx], unitSystem).unit} (${telemetry.chamberState}).\n`
        : '';
    return [
      `**Live Thermocouple Array (${telemetry.chamberState})**`,
      `${singleLine}- Profile along 450 mm quartz duct: ${tcList}`,
      `- Leading-edge coil input: ${telemetry.igniterPowerW.toFixed(0)} W · Peak flame: ${temp.text}${temp.unit} · Spread rate: ${spread.text} ${spread.unit}`,
      `- Closest reference scenario (adapted) ${exp.id} (${exp.psiCitation}): Reference Baseline: ${expBurnClause} ${expSpreadClause}.`,
    ].join('\n');
  }

  if (/orion|artemis|34\s*%\s*o2|34%|56\.5\s*kpa|exploration atmosphere/.test(q)) {
    return [
      `**Orion / Artemis Exploration Atmosphere (34% O2 at 56.5 kPa)**`,
      `- Under 34.0% O2 hypobaric cabin conditions with forced ventilation, oxygen molar enrichment elevates flame temperature and heat flux, driving rapid propagation even when ppO2 (~19.2 kPa) resembles sea-level air.`,
      `- Live chamber state (${mat.shortName} @ ${params.o2Percent.toFixed(1)}% O2, ${press.text} ${press.unit}, ${vel.text} ${vel.unit}): Regime=${telemetry.regime}, Spread=${spread.text} ${spread.unit}, Effective LOI=${telemetry.effectiveLoiPercent.toFixed(1)}% (margin ${telemetry.loiMarginPercent >= 0 ? '+' : ''}${telemetry.loiMarginPercent.toFixed(1)}%).`,
      `- Mitigation note: At 34% O2, passive Cu-Ni Flame Arrestor mesh (>32% O2 limit) is overwhelmed; deploy Pulse N2 Suppression (-8.0% O2 inert dilution) and HVAC fan isolation. Cited reference: ${exp.id}.`,
    ].join('\n');
  }

  if (/@?saffire-?ii-?03/.test(q)) {
    return [
      `**Reference Scenario: SAFFIRE-II-03 (Nomex HT90-40 Limit)**`,
      `- Literature baseline: Self-extinguished immediately after 55 W igniter cutoff at 21.0% O2, 101.3 kPa, and 20.0 cm/s opposed flow in 0g (42 mm char, 0.00 mm/s steady spread).`,
      `- Current chamber delta (${mat.shortName} @ ${params.o2Percent.toFixed(1)}% O2, ${vel.text} ${vel.unit}): Effective LOI is ${telemetry.effectiveLoiPercent.toFixed(1)}% with margin ${telemetry.loiMarginPercent >= 0 ? '+' : ''}${telemetry.loiMarginPercent.toFixed(1)}% and spread ${spread.text} ${spread.unit}.`,
      `- Closest reference scenario (adapted): ${exp.id} (${exp.psiCitation}).`,
    ].join('\n');
  }

  if (/@?saffire/.test(q)) {
    return [
      `**Reference Scenario: ${exp.id.startsWith('SAFFIRE-') ? exp.id : 'SAFFIRE Campaign (PSI-98 / PSI-99)'}**`,
      `- Campaign baseline: Large-scale Cygnus 40 cm duct microgravity concurrent-flow tests (Urban et al., ASGSR 2017, NASA NTRS 20180005168 Table 1). Cotton-fiberglass (SIBAL) spread at 1.80–2.60 mm/s across 20–25 cm/s flow, while thin-sheet Nomex (SAFFIRE-II-07) and Silicone (SAFFIRE-II-01) self-extinguished at 22.1% O2.`,
      `- Live chamber comparison (${mat.shortName} @ ${params.o2Percent.toFixed(1)}% O2, ${vel.text} ${vel.unit}): Spread=${spread.text} ${spread.unit}, Effective LOI=${telemetry.effectiveLoiPercent.toFixed(1)}% (margin ${telemetry.loiMarginPercent >= 0 ? '+' : ''}${telemetry.loiMarginPercent.toFixed(1)}%), Da*=${telemetry.damkohlerNumber.toFixed(2)}.`,
      `- Active reference match: ${exp.id} (${exp.psiCitation}).`,
    ].join('\n');
  }

  if (/@?bass-?ii-?14|@?bass-?ii\b|@?bass\b/.test(q)) {
    return [
      `**Reference Scenario: BASS-II-14 (PMMA ISS Nominal Baseline)**`,
      `- Literature baseline: 6.35 mm cast PMMA rod burned 112 mm at 1.22 mm/s steady opposed-flow spread under 21.0% O2, 101.3 kPa, and 15.0 cm/s in 0g.`,
      `- Live chamber comparison: Current material ${mat.shortName} spreads at ${spread.text} ${spread.unit} (Da=${telemetry.damkohlerNumber.toFixed(2)}, Re=${Math.round(telemetry.reynoldsDuct)}, Peak=${temp.text}${temp.unit}).`,
      `- Closest reference scenario (adapted): ${exp.id} (${exp.psiCitation}).`,
    ].join('\n');
  }

  if (/@?flex\b/.test(q)) {
    return [
      `**Reference Scenario: FLEX (Quiescent Microgravity Radiative Extinction)**`,
      `- Literature baseline: Near 0 cm/s in 0g, buoyant convection vanishes and radiative CO2/H2O cooling forces cool blue flamelets or extinction below the effective LOI.`,
      `- Current chamber comparison: Gravity=${grav.text} ${grav.unit}, Flow=${vel.text} ${vel.unit}, Radiative flux=${radFlux.text} ${radFlux.unit} vs Convective=${convFlux.text} ${convFlux.unit}.`,
      `- Regime=${telemetry.regime} · Closest reference scenario (adapted)=${exp.id}.`,
    ].join('\n');
  }

  if (/verdict|post-test|analyze completed run|burn length|nasa-std-6001 run/.test(q)) {
    const verdict = telemetry.testVerdict;
    const burnMm = (verdict?.burnLengthMm ?? telemetry.burnLengthMm).toFixed(1);
    const durS = (verdict?.testDuration ?? '60') === 'Continuous' ? 'Continuous' : `${verdict?.testDuration ?? 60}s`;
    const elapS = (verdict?.elapsedTimeS ?? telemetry.elapsedTimeS).toFixed(1);
    const outcomeLine = verdict
      ? `NASA-STD-6001 Verdict: ${verdict.headline} (Test Window: ${durS}, Elapsed: ${elapS}s, Burn Length: ${burnMm} / 300 mm).`
      : `Transient Run Summary: ${telemetry.burnLengthMm.toFixed(1)} / 300 mm burned in ${telemetry.elapsedTimeS.toFixed(1)}s (${telemetry.chamberState}).`;
    const limitNote =
      Number(burnMm) <= 152 && verdict?.outcome === 'PASS'
        ? `Material passed the 152 mm NASA-STD-6001 self-propagation criterion under ${params.o2Percent.toFixed(1)}% O2, ${vel.text} ${vel.unit} (${params.flowMode}), and ${grav.text} ${grav.unit}.`
        : `Material failed the 152 mm / self-extinguishment criterion under ${params.o2Percent.toFixed(1)}% O2, ${vel.text} ${vel.unit} (${params.flowMode}), and ${grav.text} ${grav.unit} (effective LOI ${telemetry.effectiveLoiPercent.toFixed(1)}%, margin ${telemetry.loiMarginPercent >= 0 ? '+' : ''}${telemetry.loiMarginPercent.toFixed(1)}%).`;
    return [
      outcomeLine,
      limitNote,
      `Closest Reference Scenario (Adapted) (${exp.id}): Reference Baseline: ${expBurnClause} ${expSpreadClause}. ${exp.discrepancyNote1gVsUg}`,
    ].join('\n\n');
  }

  if (/0\s*cm\/s|quench|radiative|spherical|stagnant|shutdown|no flow|zero flow/.test(q)) {
    return [
      `At quiescent 0 cm/s in microgravity, natural buoyancy vanishes (${grav.text} ${grav.unit} eliminates density-driven plumes). Oxygen reaches the reaction zone only by slow molecular diffusion.`,
      `Because CO2 and H2O soot/gas radiation continuously drains heat while O2 transport stalls, the flame collapses into a dim blue radiative sphere (${radFlux.text} ${radFlux.unit} radiative vs. ${convFlux.text} ${convFlux.unit} convective) and raises effective LOI above Earth 1g.`,
      `Current state (${mat.shortName}, ${params.o2Percent.toFixed(1)}% O2, ${vel.text} ${vel.unit}): Regime=${telemetry.regime}, Peak=${temp.text} ${temp.unit}. Closest Reference Scenario (Adapted): ${exp.id} (${exp.psiCitation}).`,
    ].join('\n\n');
  }

  if (/0g\s*vs\s*1g|1g\s*vs\s*0g|1g|earth|gravity|buoyan|std-6001|discrepancy|compare|envelope/.test(q)) {
    const deltaLoi = (mat.loi1gPercent - telemetry.effectiveLoiPercent).toFixed(1);
    return [
      `Earth 1g screening (NASA-STD-6001) induces ~35–50 cm/s upward buoyant flow that cools the pyrolysis front and dilutes O2, giving ${mat.shortName} a 1g LOI of ${mat.loi1gPercent.toFixed(1)}%. Whether a 1g screening result transfers to microgravity depends on ventilation flow and O2; compare live margins across regimes.`,
      `Under current conditions (${grav.text} ${grav.unit}, ${vel.text} ${vel.unit} ${params.flowMode}, ${press.text} ${press.unit}), effective LOI shifts to ${telemetry.effectiveLoiPercent.toFixed(1)}% (delta ${deltaLoi}% O2 vs 1g) with spread rate ${spread.text} ${spread.unit}.`,
      `Closest Reference Scenario (Adapted) (${exp.id}): ${exp.discrepancyNote1gVsUg}`,
    ].join('\n\n');
  }

  if (/suppress|hvac|extinguish|protocol|action|damper|co2|n2|inert|mitigat|recommend|arrestor|mesh|baffle/.test(q)) {
    const snap = buildVerifiedSafetySnapshot(params, telemetry, matched, unitSystem);
    const hw = resolveDuctHardware(params);
    const hwNote = `Hardware State: Wake Baffle=${hw.wakeBaffle ? 'IN' : 'OUT'} · Flame Arrestor Mesh=${hw.flameArrestor ? (telemetry.arrestorOverwhelmed ? 'OVERWHELMED (>32% O2)' : 'ARMED (clamps at 280 mm)') : 'OUT'} · N2 Nozzle=${hw.inertNozzle ? (telemetry.n2DischargeActive ? 'PURGING (-8% O2)' : 'ARMED') : 'OUT'}.`;
    return [
      `PROTOCOL [${snap.hazardLevel} — ${telemetry.regime}] for ${mat.shortName} at ${params.o2Percent.toFixed(1)}% O2, ${press.text} ${press.unit}, ${vel.text} ${vel.unit}:`,
      `1. HVAC: ${snap.hvacAction}`,
      `2. ATMOS: ${snap.atmosphereAction}`,
      `3. SUPPRESSION: ${snap.suppressantProtocol}`,
      `4. DUCT MITIGATION: ${hwNote}`,
      `Cited Run: ${exp.id} (${exp.psiCitation}).`,
    ].join('\n');
  }

  if (/blow-?off|high flow|fast|velocity|extinction index|da\*|reynolds/.test(q)) {
    return [
      `Current forced flow is ${vel.text} ${vel.unit} (${params.flowMode}) with Extinction-Proximity Index (Da*) Da=${telemetry.damkohlerNumber.toFixed(2)} and Re=${Math.round(telemetry.reynoldsDuct)}.`,
      `Moderate microgravity ventilation (5–30 cm/s) accelerates flame spread (${spread.text} ${spread.unit} now) by thinning the boundary layer, whereas >38–42 cm/s pushes Da below the critical extinction limit (blow-off).`,
      `Closest Reference Scenario (Adapted) ${exp.id}: Reference Baseline: ${expBurnClause} ${expSpreadClause}.`,
    ].join('\n\n');
  }

  return null;
}

export function buildGroundedChatAnswer(
  question: string,
  params: SimulationParams,
  telemetry: ThermoTelemetry,
  matched: MatchedExperimentResult,
  unitSystem: UnitSystem,
  markers: CadMarker[] = [],
): string {
  const outOfScope = checkOutOfScopeQuery(question, params, telemetry, matched, unitSystem);
  if (outOfScope !== null) {
    return outOfScope;
  }

  const fastMatch = quickRuleMatch(question, params, telemetry, matched, unitSystem, markers);
  if (fastMatch !== null) {
    return fastMatch;
  }

  const mat = MATERIALS[params.materialId];
  const exp = matched.experiment;
  const vel = formatVelocity(params.flowVelocityMs, unitSystem);
  const press = formatPressure(params.pressurePa, unitSystem);
  const spread = formatSpreadRate(telemetry.flameSpreadRateMs, unitSystem);
  const grav = formatGravity(params.gravityMs2, unitSystem);
  const temp = formatTemperature(telemetry.peakFlameTempK, unitSystem);

  // General telemetry-grounded response for any custom engineering query (including @CurrentTelemetry)
  return [
    `**Live Telemetry Assessment (${mat.shortName} · ${telemetry.regime})**`,
    `- Chamber: ${params.o2Percent.toFixed(1)}% O2 at ${press.text} ${press.unit}, Flow=${vel.text} ${vel.unit} (${params.flowMode}), Gravity=${grav.text} ${grav.unit}.`,
    `- Propagation: Spread=${spread.text} ${spread.unit}, Effective LOI=${telemetry.effectiveLoiPercent.toFixed(1)}% (Margin ${telemetry.loiMarginPercent >= 0 ? '+' : ''}${telemetry.loiMarginPercent.toFixed(1)}%), Da=${telemetry.damkohlerNumber.toFixed(2)}, Peak=${temp.text} ${temp.unit}.`,
    `- Closest Reference Scenario (Adapted): ${exp.id} (${exp.psiCitation}) — ${exp.discrepancyNote1gVsUg}`,
  ].join('\n');
}

export interface InlineSegment {
  text: string;
  isMetricPill: boolean;
}

const METRIC_TOKEN_REGEX =
  /(@[A-Za-z0-9_.-]+|\b(?:TC-[1-6]|P-\d+|D-\d+|SAFFIRE-(?:I|II|III)-\d+|BASS-II-\d+|FLEX-\d+|STD-6001[A-Z0-9-]*)\b|[+-]?\d+(?:\.\d+)?\s*(?:mm\/s|cm\/s|m\/s²|m\/s2|m\/s|ft\/min|in\/min|W\/cm²|W\/cm2|kW\/m²|kW\/m2|W\/m²|W\/m2|BTU\/hr·ft²|BTU\/hr|kPa|Pa|psi|atm|μg|°C|°F|mm|cm|s|W|K|%)(?![A-Za-z])|\b(?:Da|Re)=\d+(?:\.\d+)?)/g;

/**
 * Pure tokenizer splitting text into plain prose and inline monospace metric/citation pills.
 */
export function tokenizeInlineMetricPills(line: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let lastIdx = 0;
  METRIC_TOKEN_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null = METRIC_TOKEN_REGEX.exec(line);
  while (match !== null) {
    if (match.index > lastIdx) {
      segments.push({ text: line.slice(lastIdx, match.index), isMetricPill: false });
    }
    segments.push({ text: match[0], isMetricPill: true });
    lastIdx = match.index + match[0].length;
    match = METRIC_TOKEN_REGEX.exec(line);
  }
  if (lastIdx < line.length) {
    segments.push({ text: line.slice(lastIdx), isMetricPill: false });
  }
  return segments.length > 0 ? segments : [{ text: line, isMetricPill: false }];
}


