import test from 'node:test';
import assert from 'node:assert/strict';
import experimentsJson from '../data/nasaPsiExperiments.json';
import {
  ALPHA_REF_M2_S,
  ALPHA_TEMP_EXPONENT,
  AMBIENT_CHAMBER_TEMP_K,
  computeGasThermalDiffusivityM2S,
  computeIgniterCharLengthMm,
  computeThermoTelemetry,
  CONCURRENT_THIN_SHEET_SPREAD_FACTOR,
  DA_CRIT,
  dischargeNitrogen,
  extinguishChamber,
  FLAME_ARRESTOR_X_MM,
  getInitialChamberForParams,
  IGNITER_JOULE_POWER_W,
  L_DIFF_M,
  matchClosestExperiment,
  MISSION_PRESETS,
  N2_DISCHARGE_DURATION_S,
  N2_O2_DROP_PERCENT,
  P_REF_PA,
  resetChamberToStandby,
  stepChamberTransient,
  T_REF_K,
  triggerIgniterPulse,
  type MaterialId,
  type NasaPsiExperiment,
} from './thermoCore';
import { STANDARD_GRAVITY_MS2 } from './units';

const experiments = experimentsJson as NasaPsiExperiment[];

test('microgravity quiescent flow (< 2 cm/s) enters radiative spherical or quenched regime', () => {
  const res = computeThermoTelemetry({
    o2Percent: 21.0,
    pressurePa: 101325,
    flowVelocityMs: 0.0,
    gravityMs2: 0.0,
    materialId: 'cellulose',
    flowMode: 'opposed',
  });
  assert.equal(res.regime, 'Radiative Spherical');
  assert.ok(res.flameGeometry.blueZoneRatio > 0.85);
  assert.ok(res.flameSpreadRateMs < 0.001);
});

test('moderate microgravity ventilation (15 cm/s) accelerates spread vs quiescent 0 cm/s', () => {
  const quiescent = computeThermoTelemetry({
    o2Percent: 21.0,
    pressurePa: 101325,
    flowVelocityMs: 0.0,
    gravityMs2: 0.0,
    materialId: 'pmma',
    flowMode: 'opposed',
  });
  const moderate = computeThermoTelemetry({
    o2Percent: 21.0,
    pressurePa: 101325,
    flowVelocityMs: 0.15,
    gravityMs2: 0.0,
    materialId: 'pmma',
    flowMode: 'opposed',
  });
  assert.equal(moderate.regime, 'Ventilation-Driven Spread');
  assert.ok(moderate.flameSpreadRateMs > quiescent.flameSpreadRateMs);
});

test('high forced ventilation (> 42 cm/s) induces blow-off extinction at marginal O2', () => {
  const blowoff = computeThermoTelemetry({
    o2Percent: 19.5,
    pressurePa: 101325,
    flowVelocityMs: 0.45,
    gravityMs2: 0.0,
    materialId: 'pmma',
    flowMode: 'opposed',
  });
  assert.equal(blowoff.regime, 'Blow-Off Extinction');
  assert.equal(blowoff.flameSpreadRateMs, 0);
  assert.equal(blowoff.isBurning, false);
});

test('Earth 1g screening self-extinguishes Nomex at 21% O2 whereas Artemis 34% O2 triggers Critical Runaway', () => {
  const earth1g = computeThermoTelemetry(MISSION_PRESETS[3].params);
  assert.equal(earth1g.regime, 'Quenched');
  assert.ok(earth1g.buoyantVelocityMs > 0.4);
  assert.ok(earth1g.flameGeometry.buoyancyTiltRad > 1.0);

  const artemis = computeThermoTelemetry(MISSION_PRESETS[1].params);
  assert.equal(artemis.regime, 'Critical Runaway');
  assert.equal(artemis.isBurning, true);
  assert.ok(artemis.flameSpreadRateMs > 0.004);
});

test('NASA PSI experiment matcher selects exact or nearest flight run for each mission preset', () => {
  const issMatch = matchClosestExperiment(MISSION_PRESETS[0].params, experiments);
  assert.equal(issMatch.experiment.id, 'BASS-II-14');
  assert.ok(issMatch.similarityScore >= 85);

  const artemisMatch = matchClosestExperiment(MISSION_PRESETS[1].params, experiments);
  assert.equal(artemisMatch.experiment.id, 'BASS-II-45');
  assert.ok(artemisMatch.similarityScore >= 90);

  const shutdownMatch = matchClosestExperiment(MISSION_PRESETS[2].params, experiments);
  assert.equal(shutdownMatch.experiment.id, 'FLEX-09');

  const earthMatch = matchClosestExperiment(
    {
      o2Percent: 21.0,
      pressurePa: 101325,
      flowVelocityMs: 0.10,
      gravityMs2: STANDARD_GRAVITY_MS2,
      materialId: 'nomex',
      flowMode: 'opposed',
    },
    experiments,
  );
  assert.equal(earthMatch.experiment.id, 'STD-6001-1G-NOMEX');
});

test('STANDBY -> IGNITING (80W + last-1s kernel 0..0.35) -> SUSTAINED_BURN (0.35..1.0) without TC reset', () => {
  const issParams = MISSION_PRESETS[0].params;
  let chamber = resetChamberToStandby();
  const standbyTel = computeThermoTelemetry(issParams, chamber);
  assert.equal(standbyTel.chamberState, 'STANDBY');
  assert.equal(standbyTel.flameScale, 0);
  assert.equal(standbyTel.flameSpreadRateMs, 0);
  assert.equal(standbyTel.peakFlameTempK, AMBIENT_CHAMBER_TEMP_K);
  assert.equal(standbyTel.totalHeatFluxWm2, 0);

  chamber = triggerIgniterPulse(chamber);
  chamber = stepChamberTransient(chamber, 2.0, issParams);
  const midIgnTel = computeThermoTelemetry(issParams, chamber);
  assert.equal(midIgnTel.chamberState, 'IGNITING');
  assert.equal(midIgnTel.igniterPowerW, IGNITER_JOULE_POWER_W);
  assert.equal(midIgnTel.flameScale, 0);
  const tc1Delta = midIgnTel.thermocoupleTempsK[0] - AMBIENT_CHAMBER_TEMP_K;
  assert.ok(tc1Delta >= 450 && tc1Delta <= 650, `Expected TC-1 spike 450..650 K, got ${tc1Delta}`);
  assert.ok(midIgnTel.totalHeatFluxWm2 > 15000);
  assert.ok(midIgnTel.pyrolysisFactor > 0.2);

  // During final 1.0s of IGNITING (t = 3.1s), blue ignition kernel grows smoothly toward 0.35
  chamber = stepChamberTransient(chamber, 1.1, issParams);
  assert.equal(chamber.state, 'IGNITING');
  assert.ok(
    chamber.flameScale > 0.1 && chamber.flameScale < 0.35,
    `Expected kernel flameScale 0.1..0.35 at t=3.1s, got ${chamber.flameScale}`,
  );
  const preTransitionTcs = [...chamber.thermocoupleTempsK];

  // Advance past 3.5s ignition pulse -> SUSTAINED_BURN with continuous TCs & >=0.35 flameScale
  chamber = stepChamberTransient(chamber, 0.5, issParams);
  assert.equal(chamber.state, 'SUSTAINED_BURN');
  assert.ok(chamber.flameScale >= 0.35 && chamber.flameScale < 0.5);
  for (let i = 0; i < 6; i++) {
    assert.ok(
      chamber.thermocoupleTempsK[i] >= preTransitionTcs[i] - 1,
      `TC-${i + 1} dropped across IGNITING->SUSTAINED_BURN: ${preTransitionTcs[i]} -> ${chamber.thermocoupleTempsK[i]}`,
    );
  }

  // Ease flameScale smoothly to 1.0 over 1.2s and climb downstream TCs
  const earlyBurn = computeThermoTelemetry(issParams, chamber);
  const grownChamber = stepChamberTransient(chamber, 1.25, issParams);
  assert.equal(grownChamber.flameScale, 1.0);
  const laterBurn = computeThermoTelemetry(issParams, stepChamberTransient(grownChamber, 2.5, issParams));
  assert.equal(laterBurn.chamberState, 'SUSTAINED_BURN');
  assert.ok(laterBurn.flameSpreadRateMs > earlyBurn.flameSpreadRateMs);
  assert.ok(laterBurn.thermocoupleTempsK[4] > earlyBurn.thermocoupleTempsK[4]);

  // Extinguish to STANDBY shrinks flameScale smoothly over 0.8s rather than snapping to 0
  const extStart = resetChamberToStandby(grownChamber);
  assert.equal(extStart.state, 'STANDBY');
  assert.equal(extStart.flameScale, 1.0);
  const extMid = stepChamberTransient(extStart, 0.4, issParams);
  assert.ok(extMid.flameScale > 0.4 && extMid.flameScale < 0.6);
  const extDone = stepChamberTransient(extMid, 0.5, issParams);
  assert.equal(extDone.flameScale, 0);
});

test('IGNITING transitions to SELF_EXTINGUISHED with smooth 0.8s shrink and TC decay', () => {
  const earthParams = MISSION_PRESETS[3].params; // Nomex 21% O2 1g (below LOI)
  let chamber = triggerIgniterPulse(resetChamberToStandby());
  for (let i = 0; i < 36; i++) {
    chamber = stepChamberTransient(chamber, 0.1, earthParams);
  }
  assert.equal(chamber.state, 'SELF_EXTINGUISHED');
  const extEarly = computeThermoTelemetry(earthParams, chamber);
  assert.equal(extEarly.flameSpreadRateMs, 0);
  assert.equal(extEarly.isBurning, false);
  assert.ok(extEarly.flameScale > 0 && extEarly.flameScale <= 0.35);

  const extCooled = computeThermoTelemetry(earthParams, stepChamberTransient(chamber, 6.0, earthParams));
  assert.equal(extCooled.flameScale, 0);
  assert.ok(extCooled.thermocoupleTempsK[0] < extEarly.thermocoupleTempsK[0]);

  // Preset initializers: ISS -> SUSTAINED_BURN, Vent Shutdown (0 cm/s) -> SELF_EXTINGUISHED
  assert.equal(getInitialChamberForParams(MISSION_PRESETS[0].params).state, 'SUSTAINED_BURN');
  assert.equal(getInitialChamberForParams(MISSION_PRESETS[2].params).state, 'SELF_EXTINGUISHED');
});

test('Pulse Igniter during SUSTAINED_BURN injects +80W thermal overload surge that decays back to steady state', () => {
  const issParams = MISSION_PRESETS[0].params;
  const steadyChamber = getInitialChamberForParams(issParams);
  const steadyTel = computeThermoTelemetry(issParams, steadyChamber);

  const surgeStart = triggerIgniterPulse(steadyChamber);
  const surgeStep = stepChamberTransient(surgeStart, 0.6, issParams);
  const surgeTel = computeThermoTelemetry(issParams, surgeStep);
  assert.equal(surgeTel.chamberState, 'SUSTAINED_BURN');
  assert.equal(surgeTel.overloadActive, true);
  assert.ok(surgeTel.igniterPowerW > 50);
  assert.ok(surgeTel.thermocoupleTempsK[0] > steadyTel.thermocoupleTempsK[0] + 150);
  assert.ok(surgeTel.thermocoupleTempsK[1] > steadyTel.thermocoupleTempsK[1] + 50);
  assert.ok(surgeTel.totalHeatFluxWm2 > steadyTel.totalHeatFluxWm2 + 15000);
  assert.ok(surgeTel.flameSpreadRateMs > steadyTel.flameSpreadRateMs);

  let recovered = surgeStep;
  for (let i = 0; i < 60; i++) {
    recovered = stepChamberTransient(recovered, 0.1, issParams);
  }
  const recoveredTel = computeThermoTelemetry(issParams, recovered);
  assert.equal(recoveredTel.overloadActive, false);
  assert.equal(recoveredTel.igniterPowerW, 0);
  assert.ok(Math.abs(recoveredTel.totalHeatFluxWm2 - steadyTel.totalHeatFluxWm2) < 200);
});

test('Chronometer and burnLengthMm integrate during SUSTAINED_BURN and auto-conclude on TIME_LIMIT, FULL_BURNOUT, or SELF_EXTINGUISHED', () => {
  // 1. Self-extinguish after ignition pulse -> PASS verdict on 60s NASA-STD run with physically scaled igniter char length
  const earthParams = MISSION_PRESETS[3].params;
  let extRun = triggerIgniterPulse(resetChamberToStandby());
  for (let i = 0; i < 36; i++) {
    extRun = stepChamberTransient(extRun, 0.1, earthParams, 60);
  }
  assert.equal(extRun.state, 'SELF_EXTINGUISHED');
  assert.ok(extRun.testVerdict !== null);
  assert.equal(extRun.testVerdict?.outcome, 'PASS');
  assert.equal(extRun.testVerdict?.reason, 'SELF_EXTINGUISHED');
  assert.ok(extRun.burnLengthMm >= 2 && extRun.burnLengthMm <= 30);
  assert.ok(
    extRun.testVerdict?.headline.includes(
      `PASS — Self-Extinguished at ${Math.round(extRun.burnLengthMm)} mm`,
    ),
  );

  // Chronometer remains frozen once testVerdict is reached
  const frozenRun = stepChamberTransient(extRun, 2.0, earthParams, 60);
  assert.equal(frozenRun.elapsedTimeS, extRun.elapsedTimeS);
  assert.equal(frozenRun.burnLengthMm, extRun.burnLengthMm);

  // 2. Timed 30s run concludes cleanly at 30.0s with FAIL verdict when flame stays lit
  const issParams = MISSION_PRESETS[0].params;
  let timedRun = getInitialChamberForParams(issParams);
  for (let i = 0; i < 320; i++) {
    timedRun = stepChamberTransient(timedRun, 0.1, issParams, 30);
  }
  assert.equal(timedRun.elapsedTimeS, 30);
  assert.ok(timedRun.burnLengthMm > 40 && timedRun.burnLengthMm < 100);
  assert.equal(timedRun.testVerdict?.outcome, 'FAIL');
  assert.equal(timedRun.testVerdict?.reason, 'TIME_LIMIT');

  // 3. High O2 Artemis runaway reaches 300 mm full specimen burnout before 180s -> FAIL Full Burnout
  const artemisParams = MISSION_PRESETS[1].params;
  let burnoutRun = getInitialChamberForParams(artemisParams);
  for (let i = 0; i < 600; i++) {
    burnoutRun = stepChamberTransient(burnoutRun, 0.1, artemisParams, 180);
    if (burnoutRun.testVerdict) break;
  }
  assert.equal(burnoutRun.burnLengthMm, 300);
  assert.equal(burnoutRun.testVerdict?.outcome, 'FAIL');
  assert.equal(burnoutRun.testVerdict?.reason, 'FULL_BURNOUT');
  assert.ok(burnoutRun.testVerdict?.headline.includes('Full Burnout'));

  // 4. Continuous mode never auto-concludes on time or self-extinguish
  let contRun = triggerIgniterPulse(resetChamberToStandby());
  for (let i = 0; i < 40; i++) {
    contRun = stepChamberTransient(contRun, 0.1, earthParams, 'Continuous');
  }
  assert.equal(contRun.state, 'SELF_EXTINGUISHED');
  assert.equal(contRun.testVerdict, null);

  // 5. Reset Specimen clears elapsedTimeS, burnLengthMm, and testVerdict
  const reset = resetChamberToStandby(burnoutRun, true);
  assert.equal(reset.state, 'STANDBY');
  assert.equal(reset.elapsedTimeS, 0);
  assert.equal(reset.burnLengthMm, 0);
  assert.equal(reset.testVerdict, null);
});

test('Hypergravity (1.800 g) and custom 2.2s Drop Tower duration behave cleanly', () => {
  const oneG = computeThermoTelemetry({ ...MISSION_PRESETS[0].params, gravityMs2: STANDARD_GRAVITY_MS2 });
  const hyperG = computeThermoTelemetry({ ...MISSION_PRESETS[0].params, gravityMs2: 1.8 * STANDARD_GRAVITY_MS2 });
  assert.ok(hyperG.buoyantVelocityMs > oneG.buoyantVelocityMs);
  assert.ok(hyperG.effectiveLoiPercent > oneG.effectiveLoiPercent);

  let dropRun = getInitialChamberForParams(MISSION_PRESETS[0].params);
  for (let i = 0; i < 25; i++) {
    dropRun = stepChamberTransient(dropRun, 0.1, MISSION_PRESETS[0].params, 2.2);
  }
  assert.equal(dropRun.elapsedTimeS, 2.2);
  assert.equal(dropRun.testVerdict?.reason, 'TIME_LIMIT');
  assert.equal(dropRun.testVerdict?.testDuration, 2.2);
});

test('extinguishChamber aborts mid-ignition immediately and quenches sustained burn smoothly', () => {
  const issParams = MISSION_PRESETS[0].params;

  // 1. Abort mid-IGNITING -> immediate 0W igniter, SELF_EXTINGUISHED, continuous TCs, smooth kernel fade
  let ignRun = triggerIgniterPulse(resetChamberToStandby());
  ignRun = stepChamberTransient(ignRun, 3.0, issParams);
  assert.equal(ignRun.state, 'IGNITING');
  const tc1MidIgn = ignRun.thermocoupleTempsK[0];
  assert.ok(ignRun.flameScale > 0);

  const aborted = extinguishChamber(ignRun);
  assert.equal(aborted.state, 'SELF_EXTINGUISHED');
  assert.equal(aborted.thermocoupleTempsK[0], tc1MidIgn);
  const abortedTel = computeThermoTelemetry(issParams, aborted);
  assert.equal(abortedTel.igniterPowerW, 0);
  assert.equal(abortedTel.chamberState, 'SELF_EXTINGUISHED');

  const abortedFaded = stepChamberTransient(aborted, 0.9, issParams);
  assert.equal(abortedFaded.flameScale, 0);

  // 2. Quench SUSTAINED_BURN -> SELF_EXTINGUISHED with flameScale easing cleanly from 1.0 to 0.0
  const burning = getInitialChamberForParams(issParams);
  assert.equal(burning.state, 'SUSTAINED_BURN');
  assert.equal(burning.flameScale, 1.0);

  const quenched = extinguishChamber(burning);
  assert.equal(quenched.state, 'SELF_EXTINGUISHED');
  assert.equal(quenched.flameScale, 1.0);
  const quenchedMid = stepChamberTransient(quenched, 0.4, issParams);
  assert.ok(quenchedMid.flameScale > 0.4 && quenchedMid.flameScale < 0.6);
  const quenchedDone = stepChamberTransient(quenchedMid, 0.5, issParams);
  assert.equal(quenchedDone.flameScale, 0);

  // 3. Re-igniting after extinguishChamber starts a fresh ignition pulse cleanly
  const reignited = triggerIgniterPulse(quenchedDone);
  assert.equal(reignited.state, 'IGNITING');
  assert.equal(reignited.elapsedTimeS, 0);
  assert.equal(reignited.burnLengthMm, 0);
});

test('Specimen geometries adjust LOI, spread rate, radiative heat flux, and droplet cool-flame regime', () => {
  const base = MISSION_PRESETS[0].params;
  const rod = computeThermoTelemetry({ ...base, specimenGeometry: 'rod' });
  const sheet = computeThermoTelemetry({ ...base, specimenGeometry: 'sheet' });
  const channel = computeThermoTelemetry({ ...base, specimenGeometry: 'channel' });

  // Parallel Avionics Channel lowers effective LOI by ~2%, raises spread rate >= 1.25x, elevates rad flux & peak temp
  assert.ok(
    Math.abs(channel.effectiveLoiPercent - (rod.effectiveLoiPercent - 2.0)) < 0.05,
    `Expected channel LOI ~2% below rod (${rod.effectiveLoiPercent}), got ${channel.effectiveLoiPercent}`,
  );
  assert.ok(channel.flameSpreadRateMs >= rod.flameSpreadRateMs * 1.25);
  assert.ok(channel.radiativeHeatFluxWm2 > rod.radiativeHeatFluxWm2);
  assert.ok(channel.peakFlameTempK > rod.peakFlameTempK);

  // Thin Sheet spreads faster than rod
  assert.ok(sheet.flameSpreadRateMs > rod.flameSpreadRateMs);

  // Suspended Droplet enters Radiative Spherical cool-flame halo in low 0g flow (e.g. 5 cm/s)
  const dropletLowFlow = computeThermoTelemetry({
    ...base,
    flowVelocityMs: 0.05,
    specimenGeometry: 'droplet',
  });
  assert.equal(dropletLowFlow.regime, 'Radiative Spherical');
  assert.ok(dropletLowFlow.flameGeometry.blueZoneRatio > 0.85);
});

test('Upstream Wake Baffle prevents high-flow blow-off extinction where bare rod blows off', () => {
  const bareHighFlow = computeThermoTelemetry({
    o2Percent: 19.5,
    pressurePa: 101325,
    flowVelocityMs: 0.44,
    gravityMs2: 0.0,
    materialId: 'pmma',
    flowMode: 'opposed',
    specimenGeometry: 'rod',
    hardware: { wakeBaffle: false, flameArrestor: false, inertNozzle: false },
  });
  assert.equal(bareHighFlow.regime, 'Blow-Off Extinction');
  assert.equal(bareHighFlow.isBurning, false);

  const baffledHighFlow = computeThermoTelemetry({
    o2Percent: 19.5,
    pressurePa: 101325,
    flowVelocityMs: 0.44,
    gravityMs2: 0.0,
    materialId: 'pmma',
    flowMode: 'opposed',
    specimenGeometry: 'rod',
    hardware: { wakeBaffle: true, flameArrestor: false, inertNozzle: false },
  });
  assert.notEqual(baffledHighFlow.regime, 'Blow-Off Extinction');
  assert.equal(baffledHighFlow.isBurning, true);
  assert.ok(baffledHighFlow.flameSpreadRateMs > 0);
});

test('Flame Arrestor Mesh quenches at 280 mm for <=32% O2 but is overwhelmed at 34% O2', () => {
  const cappedParams = {
    ...MISSION_PRESETS[0].params,
    o2Percent: 30.0,
    flowMode: 'concurrent' as const,
    hardware: { wakeBaffle: false, flameArrestor: true, inertNozzle: false },
  };
  let cappedRun = getInitialChamberForParams(cappedParams);
  for (let i = 0; i < 900; i++) {
    cappedRun = stepChamberTransient(cappedRun, 0.1, cappedParams, 120);
    if (cappedRun.state === 'SELF_EXTINGUISHED') break;
  }
  assert.equal(cappedRun.state, 'SELF_EXTINGUISHED');
  assert.equal(cappedRun.burnLengthMm, FLAME_ARRESTOR_X_MM);
  assert.equal(cappedRun.testVerdict?.reason, 'SELF_EXTINGUISHED');
  assert.equal(cappedRun.testVerdict?.outcome, 'FAIL'); // 280 mm > 152 mm NASA-STD limit

  const overwhelmedParams = {
    ...MISSION_PRESETS[1].params, // 34% O2 Artemis
    hardware: { wakeBaffle: false, flameArrestor: true, inertNozzle: false },
  };
  let overwhelmedRun = getInitialChamberForParams(overwhelmedParams);
  const overwhelmedTel = computeThermoTelemetry(overwhelmedParams, overwhelmedRun);
  assert.equal(overwhelmedTel.arrestorActive, true);
  assert.equal(overwhelmedTel.arrestorOverwhelmed, true);

  for (let i = 0; i < 600; i++) {
    overwhelmedRun = stepChamberTransient(overwhelmedRun, 0.1, overwhelmedParams, 180);
    if (overwhelmedRun.testVerdict) break;
  }
  assert.equal(overwhelmedRun.burnLengthMm, 300);
  assert.equal(overwhelmedRun.testVerdict?.reason, 'FULL_BURNOUT');
});

test('dischargeNitrogen drops effective O2 by 8%, extinguishes burn, and decays over 5.0s', () => {
  const issWithNozzle = {
    ...MISSION_PRESETS[0].params,
    hardware: { wakeBaffle: false, flameArrestor: false, inertNozzle: true },
  };
  const burning = getInitialChamberForParams(issWithNozzle);
  assert.equal(burning.state, 'SUSTAINED_BURN');

  const discharged = dischargeNitrogen(burning);
  assert.equal(discharged.state, 'SELF_EXTINGUISHED');
  assert.equal(discharged.n2DischargeRemainingS, N2_DISCHARGE_DURATION_S);

  const midTel = computeThermoTelemetry(issWithNozzle, discharged);
  assert.equal(midTel.n2DischargeActive, true);
  assert.equal(midTel.effectiveO2Percent, issWithNozzle.o2Percent - N2_O2_DROP_PERCENT);

  const stepped = stepChamberTransient(discharged, 2.5, issWithNozzle);
  assert.ok(Math.abs((stepped.n2DischargeRemainingS ?? 0) - 2.5) < 0.05);

  const expired = stepChamberTransient(stepped, 2.6, issWithNozzle);
  assert.equal(expired.n2DischargeRemainingS, 0);
  const recoveredTel = computeThermoTelemetry(issWithNozzle, expired);
  assert.equal(recoveredTel.n2DischargeActive, false);
  assert.equal(recoveredTel.effectiveO2Percent, issWithNozzle.o2Percent);
});

test('Task 1.2a: Boundary sweep across O2, flow, gravity, and pressure per material verifies Da crosses Da_crit at loiMarginPercent = 0', () => {
  const materials: MaterialId[] = ['pmma', 'nomex', 'silicone', 'cellulose'];
  const flowsMs = [0.0, 0.05, 0.15, 0.30];
  const gravitiesMs2 = [0.0, STANDARD_GRAVITY_MS2];
  const pressuresPa = [56537, 101325];

  let maxO2MismatchPctPts = 0;
  let boundarySweepsChecked = 0;
  let totalGridStatesChecked = 0;

  for (const materialId of materials) {
    for (const flowVelocityMs of flowsMs) {
      for (const gravityMs2 of gravitiesMs2) {
        for (const pressurePa of pressuresPa) {
          boundarySweepsChecked += 1;
          let firstDaCrossO2: number | null = null;
          let firstLoiCrossO2: number | null = null;

          for (let o2Step = 140; o2Step <= 360; o2Step += 1) {
            totalGridStatesChecked += 1;
            const o2Percent = o2Step / 10;
            const tel = computeThermoTelemetry({
              o2Percent,
              pressurePa,
              flowVelocityMs,
              gravityMs2,
              materialId,
              flowMode: 'opposed',
            });

            if (tel.isBurning) {
              assert.ok(
                tel.damkohlerNumber >= DA_CRIT,
                `Expected Da >= ${DA_CRIT} when burning (${materialId}, O2=${o2Percent}%, V=${flowVelocityMs}m/s), got ${tel.damkohlerNumber}`,
              );
            } else {
              assert.ok(
                tel.damkohlerNumber < DA_CRIT,
                `Expected Da < ${DA_CRIT} when extinguished (${materialId}, O2=${o2Percent}%, V=${flowVelocityMs}m/s), got ${tel.damkohlerNumber}`,
              );
            }

            if (firstDaCrossO2 === null && tel.damkohlerNumber >= DA_CRIT) {
              firstDaCrossO2 = o2Percent;
            }
            if (firstLoiCrossO2 === null && tel.loiMarginPercent >= 0 && tel.isBurning) {
              firstLoiCrossO2 = o2Percent;
            }
          }

          if (firstDaCrossO2 !== null && firstLoiCrossO2 !== null) {
            const mismatch = Math.abs(firstDaCrossO2 - firstLoiCrossO2);
            if (mismatch > maxO2MismatchPctPts) {
              maxO2MismatchPctPts = mismatch;
            }
          }
        }
      }
    }
  }

  console.info(
    `[Task 1.2a Boundary Sweep] sweeps=${boundarySweepsChecked} | states=${totalGridStatesChecked} | Da_crit=${DA_CRIT.toFixed(2)} | max |delta_O2| = ${maxO2MismatchPctPts.toFixed(4)} percentage points`,
  );

  assert.equal(
    maxO2MismatchPctPts,
    0,
    `Expected 0.00 percentage-point O2 mismatch between Da >= Da_crit and loiMarginPercent >= 0, got ${maxO2MismatchPctPts}`,
  );
});

test('Task 1.2b: Regression test proving quenched V=0 cm/s case never exhibits higher Da than burning V=15 cm/s case', () => {
  // Reproduces the legacy bug where V=0 cm/s quenched showed Da = 7.77 while V=15 cm/s burning showed Da = 1.70
  const ventShutdownQuenched = computeThermoTelemetry(MISSION_PRESETS[2].params); // Cellulose, 21% O2, 0 cm/s, 0g
  const celluloseBurning15 = computeThermoTelemetry({
    ...MISSION_PRESETS[2].params,
    flowVelocityMs: 0.15,
  });

  assert.equal(ventShutdownQuenched.isBurning, false);
  assert.equal(celluloseBurning15.isBurning, true);
  assert.ok(
    ventShutdownQuenched.damkohlerNumber < 0.15,
    `Expected quenched Da < 0.15 at V=0 cm/s, got ${ventShutdownQuenched.damkohlerNumber}`,
  );
  assert.ok(
    celluloseBurning15.damkohlerNumber > DA_CRIT,
    `Expected burning Da > ${DA_CRIT} at V=15 cm/s, got ${celluloseBurning15.damkohlerNumber}`,
  );
  assert.ok(
    ventShutdownQuenched.damkohlerNumber < celluloseBurning15.damkohlerNumber,
    `Quenched Da (${ventShutdownQuenched.damkohlerNumber}) must be strictly lower than burning Da (${celluloseBurning15.damkohlerNumber})`,
  );

  // Also verify for PMMA at 21% O2 (0 cm/s quenched vs 15 cm/s ISS Nominal burning)
  const pmmaQuenched0 = computeThermoTelemetry({
    ...MISSION_PRESETS[0].params,
    flowVelocityMs: 0.0,
  });
  const pmmaBurning15 = computeThermoTelemetry(MISSION_PRESETS[0].params);
  assert.equal(pmmaQuenched0.isBurning, false);
  assert.equal(pmmaBurning15.isBurning, true);
  assert.ok(pmmaQuenched0.damkohlerNumber < pmmaBurning15.damkohlerNumber);
});

test('Task 1.2c: Asymptotic limit tests for Da as V_eff -> large (blow-off) and finite behavior at V = 0', () => {
  // 1. At V = 0 in 0g (V_eff = 0), radial diffusive velocity floor V_diff = alpha_g / L_diff keeps tau_flow and Da finite
  const zeroFlow = computeThermoTelemetry(MISSION_PRESETS[2].params);
  assert.equal(zeroFlow.effectiveVelocityMs, 0);
  assert.ok(zeroFlow.characteristicVelocityMs > 0);
  assert.ok(Number.isFinite(zeroFlow.tauFlowS) && zeroFlow.tauFlowS > 0);
  assert.ok(Number.isFinite(zeroFlow.tauChemS) && zeroFlow.tauChemS > 0);
  assert.ok(Number.isFinite(zeroFlow.damkohlerNumber) && zeroFlow.damkohlerNumber > 0);

  // 2. As forced velocity increases into the blow-off regime, tau_flow -> 0 and Da -> 0 monotonically
  const v38 = computeThermoTelemetry({
    o2Percent: 19.5,
    pressurePa: 101325,
    flowVelocityMs: 0.38,
    gravityMs2: 0.0,
    materialId: 'pmma',
    flowMode: 'opposed',
  });
  const v48 = computeThermoTelemetry({
    o2Percent: 19.5,
    pressurePa: 101325,
    flowVelocityMs: 0.48,
    gravityMs2: 0.0,
    materialId: 'pmma',
    flowMode: 'opposed',
  });
  const v60 = computeThermoTelemetry({
    o2Percent: 19.5,
    pressurePa: 101325,
    flowVelocityMs: 0.60,
    gravityMs2: 0.0,
    materialId: 'pmma',
    flowMode: 'opposed',
  });

  assert.ok(v60.tauFlowS < v48.tauFlowS && v48.tauFlowS < v38.tauFlowS);
  assert.ok(v60.damkohlerNumber < v48.damkohlerNumber && v48.damkohlerNumber < v38.damkohlerNumber);
  assert.ok(v60.damkohlerNumber < 0.05);
});

test('Task 1.2d: Dimensional-analysis verification of alpha_g, tau_flow, tau_chem, and Extinction-Proximity Index (Da*)', () => {
  const params = MISSION_PRESETS[0].params;
  const tel = computeThermoTelemetry(params);

  // 1. Film temperature T_film = 0.5 * (T_flame + T_amb) [K]
  const expectedFilmTempK = 0.5 * (tel.peakFlameTempK + AMBIENT_CHAMBER_TEMP_K);
  assert.ok(Math.abs(tel.filmTempK - expectedFilmTempK) < 1e-9);

  // 2. Gas thermal diffusivity alpha_g(T_film, P) = alpha_ref * (T_film/T_ref)^n * (P_ref/P) [m^2/s]
  const expectedAlphaM2S =
    ALPHA_REF_M2_S *
    Math.pow(expectedFilmTempK / T_REF_K, ALPHA_TEMP_EXPONENT) *
    (P_REF_PA / params.pressurePa);
  assert.ok(Math.abs(tel.thermalDiffusivityM2S - expectedAlphaM2S) < 1e-12);
  assert.equal(computeGasThermalDiffusivityM2S(T_REF_K, P_REF_PA), ALPHA_REF_M2_S);

  // 3. Characteristic velocity V_char = sqrt(V_eff^2 + (alpha_g / L_diff)^2) [m/s]
  const vDiffMs = expectedAlphaM2S / L_DIFF_M;
  const expectedVCharMs = Math.sqrt(
    tel.effectiveVelocityMs * tel.effectiveVelocityMs + vDiffMs * vDiffMs,
  );
  assert.ok(Math.abs(tel.characteristicVelocityMs - expectedVCharMs) < 1e-12);

  // 4. Flow residence time tau_flow = alpha_g / V_char^2 [s]
  const expectedTauFlowS = expectedAlphaM2S / (expectedVCharMs * expectedVCharMs);
  assert.ok(Math.abs(tel.tauFlowS - expectedTauFlowS) < 1e-12);

  // 5. Extinction-Proximity Index Da* = exp(f(LOI Margin, Flow Strain)) [-]
  const posMargin = Math.max(0, tel.loiMarginPercent);
  const expectedDaStar =
    DA_CRIT * Math.exp(Math.max(1e-9, 0.46 * Math.log(1 + posMargin) + 0.075 * posMargin));
  assert.ok(Math.abs(tel.damkohlerNumber - expectedDaStar) < 1e-12);

  // 6. Implied reaction timescale tau_chem = tau_flow / Da* [s]
  const expectedTauChemS = expectedTauFlowS / expectedDaStar;
  assert.ok(Math.abs(tel.tauChemS - expectedTauChemS) < 1e-12);
});

test('Dynamic igniter-zone pyrolysis char length scales with ignition duration, O2, and material thermal inertia', () => {
  // Early 1.0s abort vs full 3.5s pulse on PMMA at 21% O2
  const charEarly = computeIgniterCharLengthMm(1.0, MISSION_PRESETS[0].params);
  const charFull = computeIgniterCharLengthMm(3.5, MISSION_PRESETS[0].params);
  assert.ok(charEarly < charFull);
  assert.ok(Math.abs(charFull - 19.0) < 0.05); // (3.5/3.5)*(8+11*1)*1.0 = 19.0 mm

  // Thermally thin cellulose chars longer than dense PMMA during a 3.5s quenched pulse
  const charCellulose = computeIgniterCharLengthMm(3.5, MISSION_PRESETS[2].params);
  assert.ok(charCellulose > charFull && charCellulose <= 30.0);
});

test('matchClosestExperiment penalizes specimenGeometry and burning-vs-quenched outcome mismatches', () => {
  const bass14Params = {
    o2Percent: 21.0,
    pressurePa: 101325,
    flowVelocityMs: 0.15,
    gravityMs2: 0.0,
    materialId: 'pmma' as const,
    flowMode: 'opposed' as const,
    specimenGeometry: 'rod' as const,
  };
  const exactRodMatch = matchClosestExperiment(bass14Params, experiments);
  const mismatchedGeomMatch = matchClosestExperiment(
    { ...bass14Params, specimenGeometry: 'channel' },
    experiments,
  );
  assert.ok(
    mismatchedGeomMatch.similarityScore < exactRodMatch.similarityScore,
    `Expected geometry mismatch score (${mismatchedGeomMatch.similarityScore}) < rod match (${exactRodMatch.similarityScore})`,
  );

  // BASS-II-31 (nomex, 24% O2, 1.5 cm/s, 0g, opposed) has recorded spread rate 0.12 mm/s but quenches in solver
  const bass31Exp = experiments.find((e) => e.id === 'BASS-II-31')!;
  const bass31Match = matchClosestExperiment(
    {
      o2Percent: bass31Exp.o2Percent,
      pressurePa: bass31Exp.pressurePa,
      flowVelocityMs: bass31Exp.flowVelocityMs,
      gravityMs2: bass31Exp.gravityMs2,
      materialId: bass31Exp.materialId,
      flowMode: bass31Exp.flowMode,
      specimenGeometry: 'rod',
    },
    experiments,
  );
  assert.ok(
    bass31Match.similarityScore < 75,
    `Expected outcome mismatch penalty on BASS-II-31 (< 75%), got ${bass31Match.similarityScore}%`,
  );
  assert.equal(bass31Match.scoreBreakdown.outcomePenalty, 1.8);
  assert.ok(bass31Match.scoreBreakdown.totalDistance >= bass31Match.scoreBreakdown.outcomePenalty);
});

test('Task 2: Dataset provenance metadata, Urban et al. (2017) Table 1 Saffire rows, out-of-scope quarantine, and Calibration vs. Held-Out split', () => {
  assert.equal(experiments.length, 15);
  for (const exp of experiments) {
    assert.ok(exp.provenance, `Missing provenance object on ${exp.id}`);
    assert.ok(exp.provenanceTag, `Missing provenanceTag on ${exp.id}`);
    assert.ok(exp.psiInvestigationId, `Missing psiInvestigationId on ${exp.id}`);
    assert.ok(exp.doi && exp.doi.startsWith('10.60555/'), `Invalid or missing DOI on ${exp.id}`);
    assert.equal(exp.license, 'CC0-1.0', `Expected CC0-1.0 license on ${exp.id}`);
    assert.ok(exp.observedBurnLengthMm !== 15, `Invented 15 mm burn length must not appear on ${exp.id}`);
    assert.ok(
      !exp.psiCitation.includes('PSI-125') && !exp.psiCitation.includes('PSI-107'),
      `Placeholder PSI ID found on ${exp.id}`,
    );
    assert.ok(
      exp.scopeStatus === 'in_scope_solid' || exp.scopeStatus === 'out_of_scope',
      `Invalid scopeStatus on ${exp.id}`,
    );
    if (exp.id.startsWith('SAFFIRE-')) {
      assert.equal(exp.sourceTable, 'Table 1, Urban et al. 2017');
      assert.equal(
        exp.sourceCitation,
        'Urban et al., ASGSR 2017 (NASA NTRS 20180005168, Table 1, pp. 30–31)',
      );
      assert.equal(exp.verificationStatus, 'verified_ntrs_20180005168');
      assert.equal(exp.provenanceTag, 'Measured (NASA Published Summary)');
      assert.equal(exp.provenance.fields.o2Percent, 'midpoint of published range');
      assert.equal(exp.provenance.fields.pressurePa, 'assumed 101.3 kPa');
    } else if (exp.program === 'BASS-II') {
      assert.equal(exp.psiInvestigationId, 'PSI-25');
      assert.equal(exp.doi, '10.60555/4qc4-de67');
      assert.equal(exp.provenanceTag, 'Adapted Reference');
      assert.equal(exp.verificationStatus, 'pending_verification');
    } else if (exp.program === 'FLEX') {
      assert.equal(exp.psiInvestigationId, 'PSI-69');
      assert.equal(exp.doi, '10.60555/mbq8-0451');
      assert.equal(exp.provenanceTag, 'Droplet Surrogate');
      assert.equal(exp.verificationStatus, 'pending_verification');
    } else if (exp.program === 'NASA-STD-6001') {
      assert.equal(exp.provenanceTag, 'STD-6001 Criterion');
      assert.equal(exp.verificationStatus, 'pending_verification');
      assert.equal(
        exp.observedSpreadRateMmS,
        null,
        `NASA-STD-6001 Test 1 (${exp.id}) is a pass/fail screening criterion and must not claim a measured spread rate`,
      );
    }
  }

  // Verify exact Urban et al. (2017) Table 1 Saffire rows
  const saffireI01 = experiments.find((e) => e.id === 'SAFFIRE-I-01')!;
  assert.equal(saffireI01.o2Percent, 21.6);
  assert.equal(saffireI01.flowVelocityMs, 0.20);
  assert.equal(saffireI01.observedSpreadRateMmS, 1.8);
  assert.equal(saffireI01.observedBurnLengthMm, 840);
  assert.equal(saffireI01.durationS, 420);

  const saffireII05 = experiments.find((e) => e.id === 'SAFFIRE-II-05')!;
  assert.equal(saffireII05.o2Percent, 22.1);
  assert.equal(saffireII05.flowVelocityMs, 0.20);
  assert.equal(saffireII05.observedSpreadRateMmS, 2.1);
  assert.equal(saffireII05.observedBurnLengthMm, 290);

  const saffireII06 = experiments.find((e) => e.id === 'SAFFIRE-II-06')!;
  assert.equal(saffireII06.o2Percent, 22.1);
  assert.equal(saffireII06.flowVelocityMs, 0.25);
  assert.equal(saffireII06.observedSpreadRateMmS, 2.6);
  assert.equal(saffireII06.observedBurnLengthMm, 290);

  const saffireIII01 = experiments.find((e) => e.id === 'SAFFIRE-III-01')!;
  assert.equal(saffireIII01.o2Percent, 21.1);
  assert.equal(saffireIII01.flowVelocityMs, 0.25);
  assert.equal(saffireIII01.observedSpreadRateMmS, 2.3);
  assert.equal(saffireIII01.observedBurnLengthMm, 840);
  assert.equal(saffireIII01.durationS, 300);

  const saffireII07 = experiments.find((e) => e.id === 'SAFFIRE-II-07')!;
  assert.equal(saffireII07.o2Percent, 22.1);
  assert.equal(saffireII07.observedSpreadRateMmS, 0.0);
  assert.equal(saffireII07.observedBurnLengthMm, 0);
  assert.equal(
    saffireII07.provenance?.notes,
    'Ignited via a PMMA starter piece (~5 cm burned); Nomex sample itself did not spread or burn.',
  );

  const saffireII01 = experiments.find((e) => e.id === 'SAFFIRE-II-01')!;
  assert.equal(saffireII01.sampleThicknessMm, 0.27);
  assert.deepEqual(saffireII01.testedThicknessesMm, [0.27, 0.61, 1.03]);
  assert.equal(saffireII01.observedSpreadRateMmS, 0.0);
  assert.equal(saffireII01.observedBurnLengthMm, 0);
  assert.equal(
    saffireII01.provenance?.notes,
    'Three thicknesses tested (0.27, 0.61, 1.03 mm) at ~22.1% O2 concurrent 20 cm/s; essentially no burn (insignificant).',
  );

  // Verify Calibration set (SAFFIRE-I-01, SAFFIRE-II-05) and Held-Out set (SAFFIRE-II-06, SAFFIRE-III-01) in 40 cm Saffire duct
  assert.equal(CONCURRENT_THIN_SHEET_SPREAD_FACTOR, 0.07756);
  for (const exp of [saffireI01, saffireII05, saffireII06, saffireIII01]) {
    const tel = computeThermoTelemetry({
      o2Percent: exp.o2Percent,
      pressurePa: exp.pressurePa,
      flowVelocityMs: exp.flowVelocityMs,
      gravityMs2: exp.gravityMs2,
      materialId: exp.materialId,
      flowMode: exp.flowMode,
      specimenGeometry: 'sheet',
      ductScale: 'saffire-40cm',
    });
    const simMmS = tel.flameSpreadRateMs * 1000;
    const relErr = Math.abs(simMmS - (exp.observedSpreadRateMmS ?? 0)) / (exp.observedSpreadRateMmS ?? 1);
    assert.ok(
      relErr < 0.15,
      `Expected calibrated/held-out spread rate within 15% on ${exp.id}: sim=${simMmS.toFixed(3)} mm/s vs pub=${exp.observedSpreadRateMmS} mm/s`,
    );
  }

  // Verify two-sided thin-sheet radiative quenching for charring/ash-forming materials (SAFFIRE-II-07 Nomex & SAFFIRE-II-01 Silicone)
  for (const exp of [saffireII07, saffireII01]) {
    const tel = computeThermoTelemetry({
      o2Percent: exp.o2Percent,
      pressurePa: exp.pressurePa,
      flowVelocityMs: exp.flowVelocityMs,
      gravityMs2: exp.gravityMs2,
      materialId: exp.materialId,
      flowMode: exp.flowMode,
      specimenGeometry: 'sheet',
      ductScale: 'saffire-40cm',
    });
    assert.equal(tel.isBurning, false, `Expected ${exp.id} thin charring sheet to self-extinguish at 22.1% O2`);
    assert.equal(tel.flameSpreadRateMs, 0, `Expected 0.00 mm/s spread on ${exp.id}`);
    assert.ok(tel.loiMarginPercent < 0, `Expected negative LOI margin on ${exp.id}, got ${tel.loiMarginPercent}`);
  }

  // Verify DuctScale ('msg-12cm' vs 'saffire-40cm') hydraulic diameter (0.12m vs 0.40m) and 0.88x wall-loss spread scaling
  const msgTel = computeThermoTelemetry({ ...MISSION_PRESETS[0].params, ductScale: 'msg-12cm' });
  const saffireDuctTel = computeThermoTelemetry({ ...MISSION_PRESETS[0].params, ductScale: 'saffire-40cm' });
  assert.ok(Math.abs(saffireDuctTel.reynoldsDuct / msgTel.reynoldsDuct - 0.4 / 0.12) < 1e-6);
  assert.ok(Math.abs(saffireDuctTel.flameSpreadRateMs / msgTel.flameSpreadRateMs - 0.88) < 1e-6);

  // Quarantined records (FLEX-09, FLEX-18, BASS-II-45, STD-6001-1G-NOMEX, STD-6001-1G-PMMA) are excluded when inScopeSolidOnly=true
  const solidOnlyMatchForArtemis = matchClosestExperiment(
    MISSION_PRESETS[1].params,
    experiments,
    undefined,
    { inScopeSolidOnly: true },
  );
  assert.notEqual(solidOnlyMatchForArtemis.experiment.id, 'BASS-II-45');
  assert.equal(solidOnlyMatchForArtemis.experiment.scopeStatus, 'in_scope_solid');
});

test('isOutsideCorrelationRange flags inputs outside calibrated NASA PSI bounds', () => {
  const nominal = computeThermoTelemetry(MISSION_PRESETS[0].params);
  assert.equal(nominal.isOutsideCorrelationRange, false);

  const lowO2 = computeThermoTelemetry({ ...MISSION_PRESETS[0].params, o2Percent: 12.0 });
  assert.equal(lowO2.isOutsideCorrelationRange, true);

  const highO2 = computeThermoTelemetry({ ...MISSION_PRESETS[0].params, o2Percent: 38.0 });
  assert.equal(highO2.isOutsideCorrelationRange, true);

  const highFlow = computeThermoTelemetry({ ...MISSION_PRESETS[0].params, flowVelocityMs: 0.48 });
  assert.equal(highFlow.isOutsideCorrelationRange, true);

  const highGrav = computeThermoTelemetry({
    ...MISSION_PRESETS[0].params,
    gravityMs2: 1.8 * STANDARD_GRAVITY_MS2,
  });
  assert.equal(highGrav.isOutsideCorrelationRange, true);
});



